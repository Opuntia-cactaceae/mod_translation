"""Import / Export Module (#28) — service implementation.

Spec: #28 Import / Export Module

Provides:
    * ZIP-based export/import with manifest.json + JSON data files.
    * API-key safe: secrets are stripped from settings, and warnings are issued.
    * Merge strategies: skip_existing, overwrite_existing, keep_newer, merge.
    * ConfigPresetService stub: if absent, emits a warning and skips.
"""

import io
import json
import os
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from translator_app.import_export.models import (
    ExportManifest,
    ExportRequest,
    ImportExportDiagnostic,
    ImportExportResult,
    ImportRequest,
    MergeStrategy,
    API_KEYS_IGNORED,
    ARCHIVE_NOT_FOUND,
    CORRUPTED_DATA,
    EXPORT_FAILED,
    IMPORT_FAILED,
    INVALID_ARCHIVE,
    INVALID_MANIFEST,
    PARTIAL_IMPORT,
    SUPPORTED_MANIFEST_VERSIONS,
    UNSUPPORTED_FIELDS,
    UNSUPPORTED_VERSION,
    VERSION_MISMATCH,
)
from translator_app.translation.prompt_presets import PromptPresetService
from translator_app.translation.cache import TranslationCache
from translator_app.settings.service import SettingsService
from translator_app.jobs.manager import JobManager


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CURRENT_EXPORT_VERSION = "1.0"
APP_VERSION = "0.1.0"

ZIP_MANIFEST = "manifest.json"
ZIP_PROMPT_PRESETS = "prompt_presets.json"
ZIP_CONFIG_PRESETS = "config_presets.json"
ZIP_CACHE = "cache.json"
ZIP_JOBS = "jobs.json"
ZIP_SETTINGS = "settings.json"


# ---------------------------------------------------------------------------
# ImportExportService
# ---------------------------------------------------------------------------


class ImportExportService:
    """Service for exporting and importing user data between installations.

    Integrates with:
        * PromptPresetService — prompt presets
        * TranslationCache — translation cache entries
        * SettingsService — application settings (API-key safe)
        * JobManager — job history (optional)
        * ConfigPresetService — if available (stub/skip with warning otherwise)
    """

    def __init__(
        self,
        prompt_presets: Optional[PromptPresetService] = None,
        cache: Optional[TranslationCache] = None,
        settings_service: Optional[SettingsService] = None,
        job_manager: Optional[JobManager] = None,
    ):
        self._prompt_presets = prompt_presets
        self._cache = cache
        self._settings_service = settings_service
        self._job_manager = job_manager

    # ======================================================================
    # Public API
    # ======================================================================

    def export_data(self, request: ExportRequest) -> ImportExportResult:
        """Export requested data to a ZIP archive.

        Steps (spec #28):
            1. Collect data from services
            2. Serialize to JSON
            3. Build manifest
            4. Package into ZIP archive
            5. Save file
        """
        result = ImportExportResult()
        contents: List[str] = []
        files: Dict[str, bytes] = {}
        warnings: List[ImportExportDiagnostic] = []

        # --- prompt presets ---
        if request.include_prompt_presets:
            try:
                data = self._export_prompt_presets()
                if data:
                    files[ZIP_PROMPT_PRESETS] = json.dumps(
                        data, indent=2, ensure_ascii=False
                    ).encode("utf-8")
                    contents.append("prompt_presets")
            except Exception as exc:
                result.errors.append(ImportExportDiagnostic(
                    level="error",
                    code=EXPORT_FAILED,
                    message=f"Failed to export prompt presets: {exc}",
                ))

        # --- config presets ---
        if request.include_config_presets:
            try:
                data, diags = self._export_config_presets()
                if data:
                    files[ZIP_CONFIG_PRESETS] = json.dumps(
                        data, indent=2, ensure_ascii=False
                    ).encode("utf-8")
                    contents.append("config_presets")
                warnings.extend(diags)
            except Exception as exc:
                result.errors.append(ImportExportDiagnostic(
                    level="error",
                    code=EXPORT_FAILED,
                    message=f"Failed to export config presets: {exc}",
                ))

        # --- cache ---
        if request.include_cache:
            try:
                data = self._export_cache()
                if data is not None:
                    files[ZIP_CACHE] = json.dumps(
                        data, indent=2, ensure_ascii=False
                    ).encode("utf-8")
                    contents.append("cache")
            except Exception as exc:
                result.errors.append(ImportExportDiagnostic(
                    level="error",
                    code=EXPORT_FAILED,
                    message=f"Failed to export cache: {exc}",
                ))

        # --- jobs ---
        if request.include_jobs:
            try:
                data = self._export_jobs()
                if data is not None:
                    files[ZIP_JOBS] = json.dumps(
                        data, indent=2, ensure_ascii=False
                    ).encode("utf-8")
                    contents.append("jobs")
            except Exception as exc:
                result.errors.append(ImportExportDiagnostic(
                    level="error",
                    code=EXPORT_FAILED,
                    message=f"Failed to export jobs: {exc}",
                ))

        # --- settings (API-key safe) ---
        if request.include_settings:
            try:
                data, diags = self._export_settings_safe()
                if data is not None:
                    files[ZIP_SETTINGS] = json.dumps(
                        data, indent=2, ensure_ascii=False
                    ).encode("utf-8")
                    contents.append("settings")
                warnings.extend(diags)
            except Exception as exc:
                result.errors.append(ImportExportDiagnostic(
                    level="error",
                    code=EXPORT_FAILED,
                    message=f"Failed to export settings: {exc}",
                ))

        if result.errors:
            result.success = False
            return result

        # --- build manifest ---
        manifest = self.build_manifest(contents)
        files[ZIP_MANIFEST] = json.dumps(
            {
                "version": manifest.version,
                "exported_at": manifest.exported_at,
                "app_version": manifest.app_version,
                "contents": manifest.contents,
            },
            indent=2,
            ensure_ascii=False,
        ).encode("utf-8")

        # --- package into ZIP ---
        try:
            output_path = self._write_zip(files, request.output_path)
        except Exception as exc:
            result.errors.append(ImportExportDiagnostic(
                level="error",
                code=EXPORT_FAILED,
                message=f"Failed to write archive: {exc}",
            ))
            result.success = False
            return result

        result.warnings = warnings
        result.items_processed = len(contents)

        # Store output path for caller convenience
        result.output_path = output_path  # type: ignore[attr-defined]
        return result

    def import_data(self, request: ImportRequest) -> ImportExportResult:
        """Import data from a ZIP archive.

        Steps (spec #28):
            1. Unpack archive
            2. Read manifest
            3. Check version compatibility
            4. Load data
            5. Apply merge_strategy
            6. Save to services
        """
        result = ImportExportResult()

        # --- 1. Validate archive exists ---
        archive_path = Path(request.archive_path)
        if not archive_path.exists():
            result.success = False
            result.errors.append(ImportExportDiagnostic(
                level="error",
                code=ARCHIVE_NOT_FOUND,
                message=f"Archive not found: {request.archive_path}",
            ))
            return result

        # --- 2. Unpack ---
        try:
            files = self._read_zip(str(archive_path))
        except Exception as exc:
            result.success = False
            result.errors.append(ImportExportDiagnostic(
                level="error",
                code=INVALID_ARCHIVE,
                message=f"Failed to read archive: {exc}",
            ))
            return result

        # --- 3. Read manifest ---
        if ZIP_MANIFEST not in files:
            result.success = False
            result.errors.append(ImportExportDiagnostic(
                level="error",
                code=INVALID_MANIFEST,
                message="Archive is missing manifest.json",
            ))
            return result

        try:
            manifest = json.loads(files[ZIP_MANIFEST].decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            result.success = False
            result.errors.append(ImportExportDiagnostic(
                level="error",
                code=INVALID_MANIFEST,
                message=f"Invalid manifest.json: {exc}",
            ))
            return result

        # --- 4. Check version ---
        manifest_version = manifest.get("version", "")
        if manifest_version not in SUPPORTED_MANIFEST_VERSIONS:
            result.success = False
            result.errors.append(ImportExportDiagnostic(
                level="error",
                code=UNSUPPORTED_VERSION,
                message=(
                    f"Unsupported manifest version: {manifest_version}. "
                    f"Supported: {sorted(SUPPORTED_MANIFEST_VERSIONS)}"
                ),
            ))
            return result

        # --- 5. Import each content type ---
        merge_strategy = request.merge_strategy
        processed = 0
        skipped = 0
        warnings: List[ImportExportDiagnostic] = []

        contents = manifest.get("contents", [])

        if "prompt_presets" in contents and ZIP_PROMPT_PRESETS in files:
            try:
                data = json.loads(files[ZIP_PROMPT_PRESETS].decode("utf-8"))
                p, s, diags = self._import_prompt_presets(data, merge_strategy)
                processed += p
                skipped += s
                warnings.extend(diags)
            except Exception as exc:
                result.errors.append(ImportExportDiagnostic(
                    level="error",
                    code=IMPORT_FAILED,
                    message=f"Failed to import prompt presets: {exc}",
                ))

        if "config_presets" in contents and ZIP_CONFIG_PRESETS in files:
            try:
                data = json.loads(files[ZIP_CONFIG_PRESETS].decode("utf-8"))
                p, s, diags = self._import_config_presets(data, merge_strategy)
                processed += p
                skipped += s
                warnings.extend(diags)
            except Exception as exc:
                result.errors.append(ImportExportDiagnostic(
                    level="error",
                    code=IMPORT_FAILED,
                    message=f"Failed to import config presets: {exc}",
                ))

        if "cache" in contents and ZIP_CACHE in files:
            try:
                data = json.loads(files[ZIP_CACHE].decode("utf-8"))
                p, s, diags = self._import_cache(data, merge_strategy)
                processed += p
                skipped += s
                warnings.extend(diags)
            except Exception as exc:
                result.errors.append(ImportExportDiagnostic(
                    level="error",
                    code=IMPORT_FAILED,
                    message=f"Failed to import cache: {exc}",
                ))

        if "jobs" in contents and ZIP_JOBS in files:
            try:
                data = json.loads(files[ZIP_JOBS].decode("utf-8"))
                p, s, diags = self._import_jobs(data, merge_strategy)
                processed += p
                skipped += s
                warnings.extend(diags)
            except Exception as exc:
                result.errors.append(ImportExportDiagnostic(
                    level="error",
                    code=IMPORT_FAILED,
                    message=f"Failed to import jobs: {exc}",
                ))

        if "settings" in contents and ZIP_SETTINGS in files:
            try:
                data = json.loads(files[ZIP_SETTINGS].decode("utf-8"))
                p, s, diags = self._import_settings(data, merge_strategy)
                processed += p
                skipped += s
                warnings.extend(diags)
            except Exception as exc:
                result.errors.append(ImportExportDiagnostic(
                    level="error",
                    code=IMPORT_FAILED,
                    message=f"Failed to import settings: {exc}",
                ))

        # --- version mismatch warning ---
        exported_app_version = manifest.get("app_version", "")
        if exported_app_version and exported_app_version != APP_VERSION:
            warnings.append(ImportExportDiagnostic(
                level="warning",
                code=VERSION_MISMATCH,
                message=(
                    f"Archive was created by app version {exported_app_version}, "
                    f"current version is {APP_VERSION}"
                ),
            ))

        result.items_processed = processed
        result.items_skipped = skipped
        result.warnings = warnings
        result.success = len(result.errors) == 0

        if result.errors and processed > 0:
            result.warnings.append(ImportExportDiagnostic(
                level="warning",
                code=PARTIAL_IMPORT,
                message=f"Import completed with errors. Processed: {processed}, skipped: {skipped}",
            ))

        return result

    def preview_import(self, archive_path: str) -> ImportExportResult:
        """Preview what would be imported from an archive (read-only).

        Returns the manifest contents and validates structure without
        actually importing any data.
        """
        result = ImportExportResult()

        path = Path(archive_path)
        if not path.exists():
            result.success = False
            result.errors.append(ImportExportDiagnostic(
                level="error",
                code=ARCHIVE_NOT_FOUND,
                message=f"Archive not found: {archive_path}",
            ))
            return result

        try:
            files = self._read_zip(str(path))
        except Exception as exc:
            result.success = False
            result.errors.append(ImportExportDiagnostic(
                level="error",
                code=INVALID_ARCHIVE,
                message=f"Failed to read archive: {exc}",
            ))
            return result

        if ZIP_MANIFEST not in files:
            result.success = False
            result.errors.append(ImportExportDiagnostic(
                level="error",
                code=INVALID_MANIFEST,
                message="Archive is missing manifest.json",
            ))
            return result

        try:
            manifest = json.loads(files[ZIP_MANIFEST].decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            result.success = False
            result.errors.append(ImportExportDiagnostic(
                level="error",
                code=INVALID_MANIFEST,
                message=f"Invalid manifest.json: {exc}",
            ))
            return result

        manifest_version = manifest.get("version", "")
        if manifest_version not in SUPPORTED_MANIFEST_VERSIONS:
            result.success = False
            result.errors.append(ImportExportDiagnostic(
                level="error",
                code=UNSUPPORTED_VERSION,
                message=(
                    f"Unsupported manifest version: {manifest_version}. "
                    f"Supported: {sorted(SUPPORTED_MANIFEST_VERSIONS)}"
                ),
            ))
            return result

        # Verify referenced files exist
        contents = manifest.get("contents", [])
        file_map = {
            "prompt_presets": ZIP_PROMPT_PRESETS,
            "config_presets": ZIP_CONFIG_PRESETS,
            "cache": ZIP_CACHE,
            "jobs": ZIP_JOBS,
            "settings": ZIP_SETTINGS,
        }
        for content_type in contents:
            expected_file = file_map.get(content_type)
            if expected_file and expected_file not in files:
                result.errors.append(ImportExportDiagnostic(
                    level="error",
                    code=CORRUPTED_DATA,
                    message=f"Manifest references '{content_type}' but {expected_file} is missing",
                ))

        if result.errors:
            result.success = False
            return result

        result.items_processed = len(contents)
        result.warnings.append(ImportExportDiagnostic(
            level="info",
            code="PREVIEW",
            message=f"Archive contains: {', '.join(contents)}",
            details={"manifest": manifest, "contents": contents},
        ))
        return result

    # ======================================================================
    # Manifest builder
    # ======================================================================

    def build_manifest(self, contents: List[str]) -> ExportManifest:
        """Build an ExportManifest with current timestamp and app version."""
        return ExportManifest(
            version=CURRENT_EXPORT_VERSION,
            exported_at=datetime.now(timezone.utc).isoformat(),
            app_version=APP_VERSION,
            contents=sorted(contents),
        )

    # ======================================================================
    # Internal: Export helpers
    # ======================================================================

    def _export_prompt_presets(self) -> List[Dict[str, Any]]:
        """Export all user prompt presets as serializable dicts."""
        if self._prompt_presets is None:
            return []
        presets = []
        for preset in self._prompt_presets.list_presets():
            # System presets are recreated by the app, skip them
            if preset.is_system:
                continue
            presets.append({
                "id": preset.id,
                "name": preset.name,
                "description": preset.description,
                "profile_name": preset.profile_name,
                "batch_system_prompt": preset.batch_system_prompt,
                "batch_user_template": preset.batch_user_template,
                "single_system_prompt": preset.single_system_prompt,
                "single_user_template": preset.single_user_template,
                "log_prompts": preset.log_prompts,
                "created_at": preset.created_at,
                "updated_at": preset.updated_at,
                "version": preset.version,
            })
        return presets

    def _export_config_presets(self) -> tuple:
        """Export config presets. Stub — ConfigPresetService does not exist yet.

        Returns:
            Tuple of (data_list, warnings_list).
        """
        warnings = []
        warnings.append(ImportExportDiagnostic(
            level="warning",
            code=UNSUPPORTED_FIELDS,
            message="ConfigPresetService is not available. Config presets export is not supported.",
        ))
        return [], warnings

    def _export_cache(self) -> Optional[List[Dict[str, Any]]]:
        """Export all translation cache entries."""
        if self._cache is None:
            return None
        return self._cache.export_cache()

    def _export_jobs(self) -> Optional[List[Dict[str, Any]]]:
        """Export all job history as serializable dicts."""
        if self._job_manager is None:
            return None
        try:
            raw = self._job_manager._repo.to_json()
            return json.loads(raw)
        except Exception:
            return None

    def _export_settings_safe(self) -> tuple:
        """Export settings with API keys / secrets stripped.

        Returns:
            Tuple of (settings_dict, warnings_list).
        """
        if self._settings_service is None:
            return None, []

        warnings: List[ImportExportDiagnostic] = []
        settings = self._settings_service.export_settings()

        # Strip known secret/API-key fields
        sanitized = self._strip_secrets(settings, warnings)

        if warnings:
            # At least one secret was stripped
            pass

        return sanitized, warnings

    # ======================================================================
    # Internal: Import helpers
    # ======================================================================

    def _import_prompt_presets(
        self,
        data: List[Dict[str, Any]],
        merge_strategy: MergeStrategy,
    ) -> tuple:
        """Import prompt presets with the given merge strategy."""
        if self._prompt_presets is None or not isinstance(data, list):
            return 0, 0, []

        imported = 0
        skipped = 0
        warnings: List[ImportExportDiagnostic] = []

        for item in data:
            name = item.get("name", "")
            if not name:
                skipped += 1
                continue

            existing = None
            for p in self._prompt_presets.list_presets():
                if p.name == name:
                    existing = p
                    break

            if existing:
                if merge_strategy == MergeStrategy.SKIP_EXISTING:
                    skipped += 1
                    continue
                elif merge_strategy == MergeStrategy.KEEP_NEWER:
                    existing_ts = existing.updated_at or existing.created_at
                    incoming_ts = item.get("updated_at", item.get("created_at", ""))
                    if existing_ts >= incoming_ts:
                        skipped += 1
                        continue
                    # Update existing
                    try:
                        self._prompt_presets.update_preset(
                            preset_id=existing.id,
                            name=item.get("name"),
                            description=item.get("description"),
                            profile_name=item.get("profile_name"),
                            batch_system_prompt=item.get("batch_system_prompt"),
                            batch_user_template=item.get("batch_user_template"),
                            single_system_prompt=item.get("single_system_prompt"),
                            single_user_template=item.get("single_user_template"),
                            log_prompts=item.get("log_prompts"),
                        )
                        imported += 1
                    except Exception:
                        skipped += 1
                    continue
                elif merge_strategy in (MergeStrategy.OVERWRITE_EXISTING, MergeStrategy.MERGE):
                    # Overwrite existing
                    try:
                        self._prompt_presets.update_preset(
                            preset_id=existing.id,
                            name=item.get("name"),
                            description=item.get("description"),
                            profile_name=item.get("profile_name"),
                            batch_system_prompt=item.get("batch_system_prompt"),
                            batch_user_template=item.get("batch_user_template"),
                            single_system_prompt=item.get("single_system_prompt"),
                            single_user_template=item.get("single_user_template"),
                            log_prompts=item.get("log_prompts"),
                        )
                        imported += 1
                    except Exception:
                        skipped += 1
                    continue

            # New preset — create it
            try:
                self._prompt_presets.create_preset(
                    name=item.get("name", ""),
                    profile_name=item.get("profile_name", ""),
                    description=item.get("description", ""),
                    batch_system_prompt=item.get("batch_system_prompt", ""),
                    batch_user_template=item.get("batch_user_template", ""),
                    single_system_prompt=item.get("single_system_prompt", ""),
                    single_user_template=item.get("single_user_template", ""),
                    log_prompts=item.get("log_prompts", False),
                )
                imported += 1
            except Exception:
                skipped += 1

        return imported, skipped, warnings

    def _import_config_presets(
        self,
        data: Any,
        merge_strategy: MergeStrategy,
    ) -> tuple:
        """Import config presets. Stub — ConfigPresetService is not available."""
        warnings = [ImportExportDiagnostic(
            level="warning",
            code=UNSUPPORTED_FIELDS,
            message="ConfigPresetService is not available. Config presets import is not supported.",
        )]
        return 0, 0, warnings

    def _import_cache(
        self,
        data: Any,
        merge_strategy: MergeStrategy,
    ) -> tuple:
        """Import cache entries."""
        if self._cache is None or not isinstance(data, list):
            return 0, 0, []

        # Map MergeStrategy enum to cache's string format
        strategy_map = {
            MergeStrategy.SKIP_EXISTING: "skip_existing",
            MergeStrategy.OVERWRITE_EXISTING: "overwrite_existing",
            MergeStrategy.KEEP_NEWER: "keep_newer",
        }
        cache_strategy = strategy_map.get(
            merge_strategy, "overwrite_existing"
        )

        imported = self._cache.import_cache(data, cache_strategy)
        skipped = len(data) - imported
        return imported, max(0, skipped), []

    def _import_jobs(
        self,
        data: Any,
        merge_strategy: MergeStrategy,
    ) -> tuple:
        """Import jobs from serialized data."""
        if self._job_manager is None or not isinstance(data, list):
            return 0, 0, []

        imported = 0
        skipped = 0
        warnings: List[ImportExportDiagnostic] = []

        for item in data:
            job_id = item.get("id", "")
            if not job_id:
                skipped += 1
                continue

            existing = self._job_manager.get_job(job_id)
            if existing:
                if merge_strategy == MergeStrategy.SKIP_EXISTING:
                    skipped += 1
                    continue
                elif merge_strategy == MergeStrategy.KEEP_NEWER:
                    existing_ts = existing.updated_at or existing.created_at
                    incoming_ts = item.get("updated_at", "")
                    if existing_ts and incoming_ts:
                        if isinstance(existing_ts, datetime):
                            existing_ts = existing_ts.isoformat()
                        if existing_ts >= incoming_ts:
                            skipped += 1
                            continue
                # Overwrite or merge: delete and re-add
                try:
                    self._job_manager._repo.delete(job_id)
                except Exception:
                    pass

            # Import via from_json-like mechanism
            try:
                from translator_app.jobs.manager import _dict_to_job
                from translator_app.jobs.models import TranslationJob

                job = _dict_to_job(item)
                if job is not None:
                    self._job_manager._repo.save(job)
                    imported += 1
                else:
                    skipped += 1
            except Exception:
                skipped += 1

        return imported, skipped, warnings

    def _import_settings(
        self,
        data: Dict[str, Any],
        merge_strategy: MergeStrategy,
    ) -> tuple:
        """Import settings from dict."""
        if self._settings_service is None or not isinstance(data, dict):
            return 0, 0, []

        # For settings, overwrite is the only sensible strategy
        try:
            self._settings_service.import_settings(data)
            return 1, 0, []
        except Exception:
            return 0, 1, []

    # ======================================================================
    # Internal: ZIP handling
    # ======================================================================

    @staticmethod
    def _write_zip(
        files: Dict[str, bytes],
        output_path: Optional[str] = None,
    ) -> str:
        """Write a ZIP archive containing the given files.

        Args:
            files: Dict of filename -> bytes content.
            output_path: Optional output path. If None, writes to a temp file.

        Returns:
            Path to the created ZIP file.
        """
        if output_path is None:
            fd, output_path = tempfile.mkstemp(
                suffix=".zip",
                prefix="translator_export_",
            )
            os.close(fd)

        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, content in files.items():
                zf.writestr(name, content)

        return output_path

    @staticmethod
    def _read_zip(archive_path: str) -> Dict[str, bytes]:
        """Read a ZIP archive and return a dict of filename -> bytes."""
        files: Dict[str, bytes] = {}
        with zipfile.ZipFile(archive_path, "r") as zf:
            bad_files = zf.namelist()
            for name in zf.namelist():
                # Skip directories
                if name.endswith("/"):
                    continue
                files[name] = zf.read(name)
        return files

    # ======================================================================
    # Internal: Safety helpers
    # ======================================================================

    @staticmethod
    def _strip_secrets(
        settings: Dict[str, Any],
        warnings: List[ImportExportDiagnostic],
    ) -> Dict[str, Any]:
        """Strip secret/API-key fields from settings dict.

        Returns a sanitized copy of the settings dict. Adds warnings for
        any secrets that were stripped.
        """
        result = dict(settings)

        # Known secret-bearing field paths (dot-separated)
        secret_paths = [
            ("runtime_defaults",),
            ("secrets",),
            ("api_keys",),
            ("api_key",),
        ]

        # Top-level key removal
        removed_keys = []
        for key in list(result.keys()):
            key_lower = key.lower()
            if any(
                key_lower == sp[0].lower() or key_lower.endswith("key")
                for sp in secret_paths
            ):
                removed_keys.append(key)
                del result[key]

        # Nested stripping: runtime_defaults -> default_provider, etc.
        # but don't strip provider settings — only API keys
        for key in list(result.keys()):
            val = result[key]
            if isinstance(val, dict):
                cleaned = dict(val)
                for sub_key in list(cleaned.keys()):
                    sk_lower = sub_key.lower()
                    if "key" in sk_lower or "secret" in sk_lower or "token" in sk_lower:
                        removed_keys.append(f"{key}.{sub_key}")
                        del cleaned[sub_key]
                result[key] = cleaned

        if removed_keys:
            warnings.append(ImportExportDiagnostic(
                level="warning",
                code=API_KEYS_IGNORED,
                message=f"API keys/secrets were excluded from export: {', '.join(sorted(removed_keys))}",
                details={"stripped_fields": sorted(removed_keys)},
            ))

        return result
