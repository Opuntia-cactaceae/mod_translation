"""Scanner/indexer for translated output files.

Discovers translated files on disk for a completed translation job and
indexes them into ``translated_output_files`` via the repository.

Two scanning modes:
    1. **Manifest mode** — reads ``.output_manifest.json`` from the job's
       output root and uses its explicit source→translated file mappings.
    2. **Fallback mode** — walks the output directory tree and uses
       heuristic relative-path matching (legacy behaviour).

Manifest modes (``ManifestMode``):
    - ``AUTHORITATIVE``: manifest exists, non-empty, and matches disk.
    - ``PARTIAL``: manifest exists but is empty/incomplete — fallback
      scan supplements entries.
    - ``FALLBACK``: manifest missing, malformed, or unusable — full
      filesystem walk.

Designed for consistency with the mod discovery scanner
(``translator_app.mods.discovery``) in terms of diagnostic style,
file walking approach, and path normalisation.
"""

from __future__ import annotations

import enum
import hashlib
import logging
import os
import posixpath
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Protocol, Any

from translator_app.outputs.grouping import (
    DefaultPathGroupingStrategy,
    OutputGroupingStrategy,
    OutputGroupingStrategyResolver,
)
from translator_app.outputs.hash_utils import hash_content, read_and_hash
from translator_app.outputs.job_output_resolver import (
    JobOutputLocationResolver,
    JobOutputLocations,
)
from translator_app.outputs.manifest import (
    MANIFEST_FILENAME,
    ManifestIntegrityResult,
    OutputManifest,
    OutputManifestFile,
    OutputManifestReader,
    OutputManifestError,
    find_for_output_root,
    validate_manifest_against_output_root,
)
from translator_app.outputs.models import TranslatedOutputFile
from translator_app.outputs.repository import TranslatedOutputFileRepository

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Manifest mode
# ---------------------------------------------------------------------------


class ManifestMode(str, enum.Enum):
    """Describes how the manifest was used during a scan."""

    AUTHORITATIVE = "authoritative"
    """Manifest exists, non-empty, and is trusted as complete."""

    PARTIAL = "partial"
    """Manifest exists but appears incomplete (empty or missing files);
    fallback scan supplements entries."""

    FALLBACK = "fallback"
    """Manifest missing, malformed, or unusable; full fallback scan."""


# ---------------------------------------------------------------------------
# Diagnostic model
# ---------------------------------------------------------------------------


@dataclass
class ScanDiagnostic:
    """A single diagnostic emitted during a scan."""

    severity: str  # "info" | "warning" | "error"
    code: str
    message: str
    path: Optional[str] = None
    details: Optional[dict] = None


# ---------------------------------------------------------------------------
# Scan request / result
# ---------------------------------------------------------------------------


@dataclass
class TranslatedOutputScanRequest:
    """Parameters for a scan of translated output files."""

    job_id: str
    output_root: Optional[Path] = None
    source_root: Optional[Path] = None
    mod_id: Optional[str] = None
    force: bool = False
    job_scoped: bool = False
    """If True, the scan is performed in job-scoped mode.

    In job-scoped mode the manifest is authoritative for determining
    which files belong to this job.  The filesystem supplement scan
    (which picks up undeclared files from the output directory) is
    skipped so that unrelated files from the same output folder do
    NOT get indexed as belonging to this job.
    """


@dataclass
class TranslatedOutputScanResult:
    """Result of a scan operation."""

    job_id: str
    output_root: str = ""
    scanned_count: int = 0
    indexed_count: int = 0
    updated_count: int = 0
    skipped_count: int = 0
    missing_source_count: int = 0
    errors_count: int = 0
    files: List[TranslatedOutputFile] = field(default_factory=list)
    diagnostics: List[ScanDiagnostic] = field(default_factory=list)
    manifest_found: bool = False  # True if manifest was used
    manifest_mode: ManifestMode = ManifestMode.FALLBACK
    manifest_diagnostics: List[ScanDiagnostic] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Source file matcher
# ---------------------------------------------------------------------------


@dataclass
class SourceMatch:
    """Result of matching a translated file to its source counterpart."""

    source_path: Optional[str] = None
    status: str = "ready"  # "ready" | "missing_source"


class ScanContext:
    """Context available to source matchers during a scan."""

    def __init__(
        self,
        output_root: Path,
        source_root: Path,
        locations: JobOutputLocations,
    ):
        self.output_root = output_root
        self.source_root = source_root
        self.locations = locations


class SourceFileMatcher(Protocol):
    """Protocol for matching translated files to their source files."""

    def match_source(
        self, translated_path: Path, context: ScanContext
    ) -> SourceMatch:
        ...


class DefaultRelativeSourceFileMatcher:
    """Default matcher: source = source_root / relative(translated, output_root).

    If the source file does not exist, returns status ``missing_source``.
    """

    def match_source(
        self, translated_path: Path, context: ScanContext
    ) -> SourceMatch:
        try:
            relative = translated_path.relative_to(context.output_root)
        except ValueError:
            return SourceMatch(status="missing_source")

        source_path = context.source_root / relative
        if source_path.exists():
            return SourceMatch(source_path=str(source_path), status="ready")
        return SourceMatch(status="missing_source")


class ManifestSourceFileMatcher:
    """Matcher that uses manifest file entries for source→translated mapping.

    Translates a manifest file entry into a ``SourceMatch`` by resolving
    the source file path relative to the manifest's source root.
    """

    def __init__(self, manifest_file: OutputManifestFile):
        self._entry = manifest_file

    def match_source(
        self, translated_path: Path, context: ScanContext
    ) -> SourceMatch:
        source_path = self._entry.source_file_path
        if source_path and Path(source_path).exists():
            return SourceMatch(source_path=source_path, status="ready")
        return SourceMatch(status="missing_source")


# ---------------------------------------------------------------------------
# Stable output file ID
# ---------------------------------------------------------------------------


def _make_output_file_id(job_id: str, relative_path: str) -> str:
    """Build a deterministic, stable output file id.

    The id is derived from ``job_id`` and the POSIX-normalised relative
    path of the translated file.  This ensures that repeated scans of the
    same files produce the same ids, avoiding duplicates on reindex.
    """
    # Normalise path separators to POSIX
    normalised = relative_path.replace("\\", "/")
    raw = f"{job_id}|{normalised}"
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    return f"out_{digest}"


# ---------------------------------------------------------------------------
# File ignore predicate
# ---------------------------------------------------------------------------


def _should_ignore(name: str) -> bool:
    """Return True for files that should be skipped during scanning.

    Consistent with the mod discovery scanner's approach: no deep ignore
    rules — just skip hidden files and common non-mod artefacts with
    positive detection.
    """
    if name.startswith("."):
        return True
    # Common OS / editor artefacts
    ignored = frozenset({
        "Thumbs.db", "Desktop.ini", ".DS_Store",
    })
    return name in ignored


# ---------------------------------------------------------------------------
# Main scanner
# ---------------------------------------------------------------------------


class TranslatedOutputScanner:
    """Scans a job's output directory and indexes translated files.

    Three-phase architecture:
        1. Resolve output_root / source_root.
        2. Try to read ``.output_manifest.json``.
           a. If found with entries → authoritative or partial.
           b. If missing → fallback to ``os.walk`` + relative-path matching.
        3. Collect diagnostics.

    Manifest mode is preferred because it provides exact source→translated
    mappings, mod metadata, parser/serializer info, and aggregation keys
    — none of which can be reliably recovered from heuristics.

    However, the scanner no longer silently trusts an incomplete manifest.
    If the manifest exists but has no file entries while files exist on
    disk, the scanner emits ``MANIFEST_INCOMPLETE`` and falls back to
    filesystem scanning.
    """

    def __init__(
        self,
        repository: TranslatedOutputFileRepository,
        location_resolver: JobOutputLocationResolver,
        grouping_strategy: Optional[OutputGroupingStrategy] = None,
        grouping_resolver: Optional[OutputGroupingStrategyResolver] = None,
        source_matcher: Optional[SourceFileMatcher] = None,
        event_persister: Optional[Callable[[TranslatedOutputScanResult], None]] = None,
    ):
        self._repo = repository
        self._resolver = location_resolver
        self._grouping = grouping_strategy or DefaultPathGroupingStrategy()
        self._grouping_resolver = grouping_resolver or OutputGroupingStrategyResolver()
        self._source_matcher = source_matcher or DefaultRelativeSourceFileMatcher()
        self._event_persister = event_persister

    def scan_job_outputs(
        self, request: TranslatedOutputScanRequest
    ) -> TranslatedOutputScanResult:
        """Scan and index translated output files for a job.

        Steps:
            1. Resolve output_root / source_root via the location resolver.
            2. Attempt to read ``.output_manifest.json``.
            3. If manifest found with entries → authoritative (with
               integrity check) or partial + fallback supplement.
            4. If manifest empty but files exist → partial + fallback.
            5. If manifest missing → fallback to filesystem walk.
            6. Collect diagnostics for missing sources, errors, etc.
        """
        result = TranslatedOutputScanResult(job_id=request.job_id)

        # --- Resolve roots ---
        try:
            locations = self._resolve_locations(request)
        except Exception as exc:
            result.diagnostics.append(
                ScanDiagnostic(
                    severity="error",
                    code="LOCATION_RESOLUTION_FAILED",
                    message=str(exc),
                )
            )
            result.errors_count = 1
            return result

        output_root = Path(locations.output_root).resolve()
        result.output_root = str(output_root)
        source_root = (
            Path(locations.source_root).resolve()
            if locations.source_root
            else output_root
        )

        if not output_root.is_dir():
            result.diagnostics.append(
                ScanDiagnostic(
                    severity="error",
                    code="OUTPUT_ROOT_NOT_FOUND",
                    message=f"Output directory does not exist: {output_root}",
                    path=str(output_root),
                )
            )
            result.errors_count = 1
            return result

        context = ScanContext(
            output_root=output_root,
            source_root=source_root,
            locations=locations,
        )

        # Resolve grouping strategy from context (if no explicit strategy
        # was provided at construction time, the resolver may upgrade from
        # the default based on game_id / parser_id / manifest metadata).
        if self._grouping_resolver is not None and isinstance(
            self._grouping, DefaultPathGroupingStrategy
        ):
            resolved = self._grouping_resolver.resolve(
                game_id=context.locations.game_id,
            )
            if not isinstance(resolved, DefaultPathGroupingStrategy):
                self._grouping = resolved

        # --- Try manifest first ---
        manifest = self._try_read_manifest(output_root, result)
        if manifest is not None:
            self._handle_manifest_mode(
                result, manifest, context, request, output_root
            )
        else:
            # --- Fallback: walk filesystem ---
            result.manifest_mode = ManifestMode.FALLBACK
            if output_root.is_dir():
                result.diagnostics.append(
                    ScanDiagnostic(
                        severity="info",
                        code="MANIFEST_NOT_FOUND",
                        message=(
                            f"No {MANIFEST_FILENAME} found in {output_root}; "
                            f"using fallback filesystem scan"
                        ),
                        path=str(output_root / MANIFEST_FILENAME),
                    )
                )

            self._scan_from_filesystem(result, context, request)

        # --- Global diagnostics ---
        if result.missing_source_count > 0:
            result.diagnostics.append(
                ScanDiagnostic(
                    severity="info",
                    code="MISSING_SOURCES",
                    message=(
                        f"{result.missing_source_count} translated file(s) "
                        f"have no corresponding source file"
                    ),
                )
            )

        logger.info(
            "Scanned job %s: %d scanned, %d indexed, %d updated, "
            "%d skipped, %d missing source, %d errors (manifest=%s, mode=%s)",
            request.job_id,
            result.scanned_count,
            result.indexed_count,
            result.updated_count,
            result.skipped_count,
            result.missing_source_count,
            result.errors_count,
            "yes" if result.manifest_found else "no",
            result.manifest_mode.value,
        )

        # Persist scan event (debug observability)
        if self._event_persister is not None:
            try:
                self._event_persister(result)
            except Exception as exc:
                logger.warning(
                    "Failed to persist scan event for job %s: %s",
                    request.job_id, exc,
                )

        return result

    # ------------------------------------------------------------------
    # Manifest handling
    # ------------------------------------------------------------------

    def _handle_manifest_mode(
        self,
        result: TranslatedOutputScanResult,
        manifest: OutputManifest,
        context: ScanContext,
        request: TranslatedOutputScanRequest,
        output_root: Path,
    ) -> None:
        """Determine manifest mode and index accordingly.

        Three outcomes:
        - Manifest non-empty → index from manifest, then run integrity
          check. If integrity reveals undeclared files, emit diagnostic
          and supplement with fallback scan (partial mode).
        - Manifest empty but files on disk → partial mode: emit
          MANIFEST_INCOMPLETE, fallback scan.
        - Manifest empty and no files on disk → authoritative empty.
        """
        total_declared = sum(
            len(mod.files) for mod in manifest.mods
        )

        if total_declared > 0:
            # Index from manifest first
            self._index_from_manifest(result, manifest, context, request)

            # Validate integrity: check for undeclared files
            integrity = validate_manifest_against_output_root(manifest, output_root)

            if integrity.undeclared_files:
                if request.job_scoped:
                    # Job-scoped mode: manifest is authoritative.
                    # Undeclared files in the output folder belong to
                    # OTHER jobs — do NOT supplement them.
                    result.manifest_mode = ManifestMode.AUTHORITATIVE
                    result.manifest_diagnostics.append(
                        ScanDiagnostic(
                            severity="info",
                            code="MANIFEST_JOB_SCOPED",
                            message=(
                                f"Job-scoped scan: manifest declares "
                                f"{total_declared} file(s); "
                                f"{len(integrity.undeclared_files)} unrelated "
                                f"file(s) in output folder are not indexed for "
                                f"this job"
                            ),
                            path=str(output_root / MANIFEST_FILENAME),
                            details={
                                "files_declared": total_declared,
                                "files_found": integrity.files_found,
                                "undeclared": integrity.undeclared_files[:20],
                            },
                        )
                    )
                else:
                    # Global scan: manifest is partial — supplement
                    # undeclared files from the filesystem.
                    result.manifest_mode = ManifestMode.PARTIAL
                    result.manifest_diagnostics.append(
                        ScanDiagnostic(
                            severity="warning",
                            code="MANIFEST_PARTIAL",
                            message=(
                                f"Manifest declares {total_declared} file(s) but "
                                f"{len(integrity.undeclared_files)} file(s) on disk "
                                f"are undeclared; supplementing with fallback scan"
                            ),
                            path=str(output_root / MANIFEST_FILENAME),
                            details={
                                "files_declared": total_declared,
                                "files_found": integrity.files_found,
                                "undeclared": integrity.undeclared_files[:20],
                                "is_complete": integrity.is_complete,
                            },
                        )
                    )

                    # Collect source file relative paths from manifest entries
                    # so the supplement can skip files that are known sources.
                    source_rel_paths = self._collect_source_rel_paths(manifest)

                    # Supplement with fallback scan (avoids re-indexing existing)
                    self._scan_from_filesystem(result, context, request,
                                               skip_known=True,
                                               skip_source_paths=source_rel_paths)

                    result.diagnostics.append(
                        ScanDiagnostic(
                            severity="info",
                            code="MANIFEST_SUPPLEMENTED",
                            message=(
                                f"Fallback scan supplemented "
                                f"{integrity.files_found - total_declared} "
                                f"undeclared file(s)"
                            ),
                        )
                    )
            else:
                # Manifest is authoritative
                result.manifest_mode = ManifestMode.AUTHORITATIVE
        else:
            # Manifest has zero file entries — check disk
            disk_files = _count_output_files(output_root)
            if disk_files > 0:
                # Manifest exists but is empty/incomplete while files exist
                result.manifest_mode = ManifestMode.PARTIAL
                result.manifest_diagnostics.append(
                    ScanDiagnostic(
                        severity="warning",
                        code="MANIFEST_EMPTY",
                        message=(
                            f"Manifest found at {output_root / MANIFEST_FILENAME} "
                            f"but contains 0 file entries while {disk_files} "
                            f"translated file(s) exist on disk; "
                            f"using fallback filesystem scan"
                        ),
                        path=str(output_root / MANIFEST_FILENAME),
                        details={
                            "files_declared": 0,
                            "files_found": disk_files,
                        },
                    )
                )
                result.diagnostics.append(
                    ScanDiagnostic(
                        severity="warning",
                        code="MANIFEST_INCOMPLETE",
                        message=(
                            f"Manifest is empty but {disk_files} translated "
                            f"file(s) exist on disk"
                        ),
                        path=str(output_root / MANIFEST_FILENAME),
                    )
                )
                self._scan_from_filesystem(result, context, request)
            else:
                # No files on disk either — empty is correct
                result.manifest_mode = ManifestMode.AUTHORITATIVE
                logger.debug(
                    "Empty manifest for job %s with no files on disk",
                    request.job_id,
                )

    @staticmethod
    def _collect_source_rel_paths(manifest: OutputManifest) -> set:
        """Collect source file relative paths from all manifest entries.

        Returns a set of POSIX relative paths that correspond to source
        files declared in the manifest.  Used to filter the fallback
        supplement so that source files are not re-indexed as translated
        output files.
        """
        paths: set = set()
        for mod in manifest.mods:
            for f in mod.files:
                if f.relative_source_path:
                    paths.add(f.relative_source_path)
                if f.relative_translated_path:
                    # Also add the translated path — it is already indexed
                    # and should not be re-added by the supplement.
                    pass
        # Also add source file basenames for extra coverage
        for mod in manifest.mods:
            for f in mod.files:
                if f.source_file_path:
                    name = Path(f.source_file_path).name
                    paths.add(name)
        return paths

    # ------------------------------------------------------------------
    # Manifest path
    # ------------------------------------------------------------------

    def _try_read_manifest(
        self, output_root: Path, result: TranslatedOutputScanResult
    ) -> Optional[OutputManifest]:
        """Try to read the output manifest. Returns ``None`` on any failure.

        Failures are recorded as diagnostics so the caller can fall back
        to filesystem scanning.
        """
        manifest_path = find_for_output_root(output_root)
        if manifest_path is None:
            return None

        try:
            manifest = OutputManifestReader.read(manifest_path)
            result.manifest_found = True
            logger.debug("Read manifest from %s", manifest_path)
            return manifest
        except OutputManifestError as exc:
            result.diagnostics.append(
                ScanDiagnostic(
                    severity="warning",
                    code="MANIFEST_READ_ERROR",
                    message=str(exc),
                    path=str(manifest_path),
                )
            )
            return None

    # ------------------------------------------------------------------
    # Manifest-based indexing
    # ------------------------------------------------------------------

    def _index_from_manifest(
        self,
        result: TranslatedOutputScanResult,
        manifest: OutputManifest,
        context: ScanContext,
        request: TranslatedOutputScanRequest,
    ) -> None:
        """Index files from manifest entries."""
        manifest_output_root = Path(manifest.output_root).resolve() if manifest.output_root else context.output_root
        manifest_source_root = Path(manifest.source_root).resolve() if manifest.source_root else context.source_root

        for mod_entry in manifest.mods:
            mod_id = mod_entry.mod_id if mod_entry.mod_id else (request.mod_id or "")
            mod_name = mod_entry.mod_name if mod_entry.mod_name else mod_id

            for file_entry in mod_entry.files:
                try:
                    file_record, is_new = self._index_manifest_file(
                        file_entry=file_entry,
                        mod_id=mod_id,
                        mod_name=mod_name,
                        manifest=manifest,
                        manifest_output_root=manifest_output_root,
                        manifest_source_root=manifest_source_root,
                        context=context,
                        request=request,
                    )
                    if is_new:
                        result.indexed_count += 1
                    else:
                        result.updated_count += 1
                    if file_record.status == "missing_source":
                        result.missing_source_count += 1

                    result.scanned_count += 1
                    result.files.append(file_record)
                except Exception as exc:
                    logger.warning(
                        "Error indexing manifest entry %s for job %s: %s",
                        file_entry.relative_translated_path,
                        request.job_id,
                        exc,
                    )
                    result.diagnostics.append(
                        ScanDiagnostic(
                            severity="warning",
                            code="INDEX_ERROR",
                            message=(
                                f"Failed to index "
                                f"{file_entry.relative_translated_path}: {exc}"
                            ),
                            path=file_entry.translated_file_path,
                        )
                    )
                    result.errors_count += 1

    def _index_manifest_file(
        self,
        file_entry: OutputManifestFile,
        mod_id: str,
        mod_name: str,
        manifest: OutputManifest,
        manifest_output_root: Path,
        manifest_source_root: Path,
        context: ScanContext,
        request: TranslatedOutputScanRequest,
    ) -> tuple:
        """Index a single file from a manifest entry."""
        # Resolve translated file path
        translated_path_str = file_entry.translated_file_path
        if translated_path_str:
            translated_path = Path(translated_path_str)
            if not translated_path.is_absolute():
                translated_path = manifest_output_root / translated_path
        else:
            # Build from relative path + output root
            relative = file_entry.relative_translated_path
            translated_path = manifest_output_root / relative

        translated_path = translated_path.resolve()
        relative_posix = file_entry.relative_translated_path

        if not relative_posix:
            try:
                relative_posix = translated_path.relative_to(manifest_output_root).as_posix()
            except ValueError:
                relative_posix = translated_path.name

        file_id = _make_output_file_id(request.job_id, relative_posix)

        # Check existing
        existing = self._repo.get_by_id(file_id)
        is_new = existing is None

        # Source matching
        source_path_str = file_entry.source_file_path
        if source_path_str:
            source_path = Path(source_path_str)
            if not source_path.is_absolute():
                source_path = manifest_source_root / source_path
            source_path = source_path.resolve()
        else:
            # Fallback: source_root + relative_translated_path
            source_path = manifest_source_root / relative_posix

        source_exists = source_path.exists()
        status = "ready" if source_exists else "missing_source"

        if not source_exists:
            # Try at source root if it's relative
            if file_entry.relative_source_path:
                alt_source = manifest_source_root / file_entry.relative_source_path
                if alt_source.exists():
                    source_path = alt_source
                    source_exists = True
                    status = "ready"

        # Use manifest grouping if available, else compute.
        # Pass file-entry metadata to the strategy for aggregation-based
        # grouping strategies that need metadata hints.
        grouping_metadata: Dict[str, Any] = {}
        if file_entry.metadata:
            grouping_metadata.update(file_entry.metadata)
        if file_entry.aggregation_key:
            grouping_metadata["aggregation_key"] = file_entry.aggregation_key

        group_key = file_entry.group_key or self._grouping.get_group_key(
            relative_posix, metadata=grouping_metadata if grouping_metadata else None,
        )
        group_label = file_entry.group_label or self._grouping.get_group_label(
            relative_posix, metadata=grouping_metadata if grouping_metadata else None,
        )

        # File sizes
        try:
            translated_size = translated_path.stat().st_size
        except OSError:
            translated_size = 0

        source_size = None
        if source_exists:
            try:
                source_size = source_path.stat().st_size
            except OSError:
                pass

        # Compute current content hashes from disk
        current_source_hash = read_and_hash(str(source_path)) if source_exists else None
        current_translated_hash = read_and_hash(str(translated_path))

        # Detect external modification: if the translated hash changed
        # relative to the DB record, mark analysis stale.
        analysis_stale = existing.analysis_stale if existing else False
        if existing is not None and current_translated_hash is not None:
            if existing.current_translated_hash is not None and existing.current_translated_hash != current_translated_hash:
                analysis_stale = True
                logger.info(
                    "File %s content changed since last scan; marking stale",
                    file_id,
                )

        # Build output metadata from manifest info
        output_metadata: Dict[str, Any] = {}
        if file_entry.serializer_id:
            output_metadata["serializer_id"] = file_entry.serializer_id
        if file_entry.entries_count:
            output_metadata["entries_count"] = file_entry.entries_count
        if file_entry.translated_entries_count:
            output_metadata["translated_entries_count"] = file_entry.translated_entries_count
        if file_entry.metadata:
            # Merge file-level metadata
            for k, v in file_entry.metadata.items():
                output_metadata.setdefault(k, v)
        # Store manifest schema version
        output_metadata["manifest_schema_version"] = manifest.schema_version
        # Store warnings from manifest
        if file_entry.warnings:
            output_metadata["manifest_warnings"] = [
                {"code": w.code, "message": w.message, "details": w.details}
                for w in file_entry.warnings
            ]

        file_record = TranslatedOutputFile(
            id=file_id,
            job_id=request.job_id,
            mod_id=mod_id,
            mod_name=mod_name,
            source_file_path=str(source_path) if source_exists else "",
            translated_file_path=str(translated_path),
            relative_source_path=(
                _make_relative_to(str(source_path), manifest_source_root)
                if source_exists else file_entry.relative_source_path
            ),
            relative_translated_path=relative_posix,
            file_name=translated_path.name,
            file_ext=translated_path.suffix.lstrip(".") or file_entry.file_ext or None,
            game_id=file_entry.game_id or manifest.game_id or context.locations.game_id,
            parser_id=file_entry.parser_id or None,
            aggregation_key=file_entry.aggregation_key or None,
            group_key=group_key,
            group_label=group_label,
            source_size_bytes=source_size,
            translated_size_bytes=translated_size,
            status=status,
            created_at=existing.created_at if existing else "",
            updated_at=existing.updated_at if existing else "",
            output_metadata=output_metadata if output_metadata else None,
            analysis_stale=analysis_stale,
            current_source_hash=current_source_hash,
            current_translated_hash=current_translated_hash,
        )

        saved = self._repo.create_or_update(file_record)
        return saved, is_new

    # ------------------------------------------------------------------
    # Filesystem-based indexing (fallback)
    # ------------------------------------------------------------------

    def _scan_from_filesystem(
        self,
        result: TranslatedOutputScanResult,
        context: ScanContext,
        request: TranslatedOutputScanRequest,
        skip_known: bool = False,
        skip_source_paths: Optional[set] = None,
    ) -> None:
        """Fallback: walk the output directory and index discovered files.

        If *skip_known* is True, files whose IDs already exist in the
        repository are skipped (used when supplementing partial manifests).

        If *skip_source_paths* is provided (a set of relative paths or
        basenames), any file whose relative path or name is in the set
        is skipped.  This prevents source files that happen to reside
        in the output directory from being indexed as translated outputs.
        """
        scanned: List[Path] = []

        for dirpath, dirnames, filenames in os.walk(str(context.output_root)):
            # Filter hidden directories in-place (os.walk convention)
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]

            for filename in sorted(filenames):
                if _should_ignore(filename):
                    result.skipped_count += 1
                    continue

                file_path = Path(dirpath) / filename
                if not file_path.is_file():
                    continue

                # If skip_source_paths is provided, check if this file
                # matches a known source file (basename or relative path).
                if skip_source_paths:
                    try:
                        rel = file_path.relative_to(context.output_root)
                        rel_posix = rel.as_posix()
                    except ValueError:
                        rel_posix = filename
                    if rel_posix in skip_source_paths or filename in skip_source_paths:
                        result.skipped_count += 1
                        continue

                scanned.append(file_path)

        result.scanned_count = len(scanned)

        for translated_path in scanned:
            # Compute the stable ID
            try:
                relative = translated_path.relative_to(context.output_root)
            except ValueError:
                relative = Path(translated_path.name)
            relative_posix = relative.as_posix()

            if skip_known:
                file_id = _make_output_file_id(request.job_id, relative_posix)
                if self._repo.get_by_id(file_id) is not None:
                    # Already indexed from manifest — skip
                    continue

            try:
                file_record, is_new = self._index_file(
                    translated_path, context, request
                )
                if is_new:
                    result.indexed_count += 1
                else:
                    result.updated_count += 1

                if file_record.status == "missing_source":
                    result.missing_source_count += 1

                result.files.append(file_record)
            except Exception as exc:
                logger.warning(
                    "Error indexing %s for job %s: %s",
                    translated_path, request.job_id, exc,
                )
                result.diagnostics.append(
                    ScanDiagnostic(
                        severity="warning",
                        code="INDEX_ERROR",
                        message=f"Failed to index {translated_path}: {exc}",
                        path=str(translated_path),
                    )
                )
                result.errors_count += 1

    # ------------------------------------------------------------------
    # Location resolution
    # ------------------------------------------------------------------

    def _resolve_locations(
        self, request: TranslatedOutputScanRequest
    ) -> JobOutputLocations:
        """Resolve output and source root directories."""
        locations = self._resolver.resolve(request.job_id)

        # Override from request if explicitly provided
        if request.output_root is not None:
            locations.output_root = str(request.output_root.resolve())
        if request.source_root is not None:
            locations.source_root = str(request.source_root.resolve())

        return locations

    # ------------------------------------------------------------------
    # Single-file indexing (fallback mode)
    # ------------------------------------------------------------------

    def _index_file(
        self,
        translated_path: Path,
        context: ScanContext,
        request: TranslatedOutputScanRequest,
    ) -> tuple:
        """Index a single translated file, returning (TranslatedOutputFile, is_new)."""
        try:
            relative = translated_path.relative_to(context.output_root)
        except ValueError:
            relative = Path(translated_path.name)

        relative_posix = relative.as_posix()
        file_id = _make_output_file_id(request.job_id, relative_posix)

        # Check if this is a new or existing record
        existing = self._repo.get_by_id(file_id)
        is_new = existing is None

        # Source matching
        source_match = self._source_matcher.match_source(
            translated_path, context
        )

        # Grouping
        group_key = self._grouping.get_group_key(relative_posix)
        group_label = self._grouping.get_group_label(relative_posix)

        # File metadata
        try:
            translated_size = translated_path.stat().st_size
        except OSError:
            translated_size = 0

        source_size = None
        if source_match.source_path:
            try:
                source_size = os.path.getsize(source_match.source_path)
            except OSError:
                pass

        # Mod info
        mod_id = request.mod_id
        if mod_id is None and source_match.source_path:
            # Attempt to infer mod_id from the relative path structure
            parts = relative.parts
            mod_id = parts[0] if len(parts) > 1 else ""
        if mod_id is None:
            mod_id = ""
        mod_name = mod_id or ""

        # Compute current content hashes from disk
        current_source_hash = (
            read_and_hash(source_match.source_path)
            if source_match.source_path and source_match.status == "ready"
            else None
        )
        current_translated_hash = read_and_hash(str(translated_path))

        # Detect external modification
        analysis_stale = existing.analysis_stale if existing else False
        if existing is not None and current_translated_hash is not None:
            if existing.current_translated_hash is not None and existing.current_translated_hash != current_translated_hash:
                analysis_stale = True
                logger.info(
                    "File %s content changed since last scan; marking stale",
                    file_id,
                )

        file_record = TranslatedOutputFile(
            id=file_id,
            job_id=request.job_id,
            mod_id=mod_id,
            mod_name=mod_name,
            source_file_path=source_match.source_path or "",
            translated_file_path=str(translated_path),
            relative_source_path=(
                _make_relative_to(source_match.source_path, context.source_root)
                if source_match.source_path else None
            ),
            relative_translated_path=relative_posix,
            file_name=translated_path.name,
            file_ext=translated_path.suffix.lstrip(".") or None,
            game_id=context.locations.game_id or None,
            group_key=group_key,
            group_label=group_label,
            source_size_bytes=source_size,
            translated_size_bytes=translated_size,
            status=source_match.status,
            created_at=existing.created_at if existing else "",
            updated_at=existing.updated_at if existing else "",
            analysis_stale=analysis_stale,
            current_source_hash=current_source_hash,
            current_translated_hash=current_translated_hash,
        )

        # Upsert via repository
        saved = self._repo.create_or_update(file_record)

        return saved, is_new


def _count_output_files(output_root: Path) -> int:
    """Count non-hidden, non-manifest files in *output_root*."""
    count = 0
    if not output_root.is_dir():
        return 0
    for dirpath, dirnames, filenames in os.walk(str(output_root)):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for filename in filenames:
            if filename.startswith(".") or filename == MANIFEST_FILENAME:
                continue
            file_path = Path(dirpath) / filename
            if file_path.is_file():
                count += 1
    return count


def _make_relative_to(path_str: Optional[str], root: Path) -> Optional[str]:
    """Compute a POSIX-style relative path from *root* to *path_str*."""
    if not path_str:
        return None
    try:
        p = Path(path_str).resolve()
        r = p.relative_to(root)
        return r.as_posix()
    except (ValueError, OSError):
        return posixpath.basename(path_str)
