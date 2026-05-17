"""Output manifest — explicit source→translated file mapping.

A job manifest (``.output_manifest.json``) is written to the job's
output root after all translated files have been produced.  The scanner
then reads this manifest as the primary source of truth, falling back
to the heuristic relative-path matching only when no manifest exists.

Schema versioning ensures backward compatibility: unknown fields in the
JSON are silently ignored, and the reader will tolerate missing optional
fields through strict field filtering.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MANIFEST_FILENAME = ".output_manifest.json"
MANIFEST_SCHEMA_VERSION = 1

# ---------------------------------------------------------------------------
# Domain models
# ---------------------------------------------------------------------------


@dataclass
class OutputManifestWarning:
    """A warning associated with a manifest file entry."""

    code: str = ""
    message: str = ""
    details: Optional[Dict[str, Any]] = None


@dataclass
class OutputManifestFile:
    """Metadata for a single translated file in the manifest."""

    source_file_path: str
    translated_file_path: str
    relative_source_path: str
    relative_translated_path: str
    file_name: str
    file_ext: str = ""
    game_id: str = ""
    parser_id: str = ""
    serializer_id: str = ""
    aggregation_key: str = ""
    group_key: str = ""
    group_label: str = ""
    entries_count: int = 0
    translated_entries_count: int = 0
    warnings: List[OutputManifestWarning] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class OutputManifestMod:
    """A mod entry in the manifest, grouping its files."""

    mod_id: str = ""
    mod_name: str = ""
    source_root: str = ""
    output_root: str = ""
    files: List[OutputManifestFile] = field(default_factory=list)


@dataclass
class OutputManifest:
    """Top-level manifest for a completed translation job's output."""

    schema_version: int = MANIFEST_SCHEMA_VERSION
    job_id: str = ""
    job_name: str = ""
    created_at: str = ""
    updated_at: str = ""
    source_root: str = ""
    output_root: str = ""
    game_id: str = ""
    files_count: int = 0
    mods: List[OutputManifestMod] = field(default_factory=list)
    _extra_fields: Dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------

_MANIFEST_MODEL_FIELDS = {
    "schema_version",
    "job_id",
    "job_name",
    "created_at",
    "updated_at",
    "source_root",
    "output_root",
    "game_id",
    "files_count",
    "mods",
}

_MANIFEST_MOD_FIELDS = {
    "mod_id",
    "mod_name",
    "source_root",
    "output_root",
    "files",
}

_MANIFEST_FILE_FIELDS = {
    "source_file_path",
    "translated_file_path",
    "relative_source_path",
    "relative_translated_path",
    "file_name",
    "file_ext",
    "game_id",
    "parser_id",
    "serializer_id",
    "aggregation_key",
    "group_key",
    "group_label",
    "entries_count",
    "translated_entries_count",
    "warnings",
    "metadata",
}

_MANIFEST_WARNING_FIELDS = {
    "code",
    "message",
    "details",
}


def _filter_dict(d: Dict[str, Any], allowed: set) -> Dict[str, Any]:
    """Return a new dict containing only keys present in *allowed*."""
    return {k: v for k, v in d.items() if k in allowed}


def _manifest_to_dict(manifest: OutputManifest) -> Dict[str, Any]:
    """Convert an ``OutputManifest`` to a plain JSON-serialisable dict."""
    return {
        "schema_version": manifest.schema_version,
        "job_id": manifest.job_id,
        "job_name": manifest.job_name,
        "created_at": manifest.created_at,
        "updated_at": manifest.updated_at,
        "source_root": manifest.source_root,
        "output_root": manifest.output_root,
        "game_id": manifest.game_id,
        "files_count": manifest.files_count,
        "mods": [
            {
                "mod_id": mod.mod_id,
                "mod_name": mod.mod_name,
                "source_root": mod.source_root,
                "output_root": mod.output_root,
                "files": [
                    {
                        "source_file_path": f.source_file_path,
                        "translated_file_path": f.translated_file_path,
                        "relative_source_path": f.relative_source_path,
                        "relative_translated_path": f.relative_translated_path,
                        "file_name": f.file_name,
                        "file_ext": f.file_ext,
                        "game_id": f.game_id,
                        "parser_id": f.parser_id,
                        "serializer_id": f.serializer_id,
                        "aggregation_key": f.aggregation_key,
                        "group_key": f.group_key,
                        "group_label": f.group_label,
                        "entries_count": f.entries_count,
                        "translated_entries_count": f.translated_entries_count,
                        "warnings": [
                            {
                                "code": w.code,
                                "message": w.message,
                                "details": w.details,
                            }
                            for w in f.warnings
                        ],
                        "metadata": f.metadata,
                    }
                    for f in mod.files
                ],
            }
            for mod in manifest.mods
        ],
    }


def _dict_to_manifest(data: Dict[str, Any]) -> OutputManifest:
    """Convert a parsed JSON dict back to an ``OutputManifest``.

    Unknown fields are silently ignored (backward compatibility).
    Missing optional fields are defaulted.
    """
    root = _filter_dict(data, _MANIFEST_MODEL_FIELDS)
    manifest = OutputManifest(
        schema_version=root.get("schema_version", MANIFEST_SCHEMA_VERSION),
        job_id=root.get("job_id", ""),
        job_name=root.get("job_name", ""),
        created_at=root.get("created_at", ""),
        updated_at=root.get("updated_at", ""),
        source_root=root.get("source_root", ""),
        output_root=root.get("output_root", ""),
        game_id=root.get("game_id", ""),
        files_count=root.get("files_count", 0),
        mods=[],
    )

    for mod_data in data.get("mods", []):
        mod = _filter_dict(mod_data, _MANIFEST_MOD_FIELDS)
        manifest_mod = OutputManifestMod(
            mod_id=mod.get("mod_id", ""),
            mod_name=mod.get("mod_name", ""),
            source_root=mod.get("source_root", ""),
            output_root=mod.get("output_root", ""),
            files=[],
        )
        for file_data in mod_data.get("files", []):
            f = _filter_dict(file_data, _MANIFEST_FILE_FIELDS)
            manifest_file = OutputManifestFile(
                source_file_path=f.get("source_file_path", ""),
                translated_file_path=f.get("translated_file_path", ""),
                relative_source_path=f.get("relative_source_path", ""),
                relative_translated_path=f.get("relative_translated_path", ""),
                file_name=f.get("file_name", ""),
                file_ext=f.get("file_ext", ""),
                game_id=f.get("game_id", ""),
                parser_id=f.get("parser_id", ""),
                serializer_id=f.get("serializer_id", ""),
                aggregation_key=f.get("aggregation_key", ""),
                group_key=f.get("group_key", ""),
                group_label=f.get("group_label", ""),
                entries_count=f.get("entries_count", 0),
                translated_entries_count=f.get("translated_entries_count", 0),
                warnings=[],
                metadata=f.get("metadata", {}),
            )
            for w_data in file_data.get("warnings", []):
                w = _filter_dict(w_data, _MANIFEST_WARNING_FIELDS)
                manifest_file.warnings.append(OutputManifestWarning(
                    code=w.get("code", ""),
                    message=w.get("message", ""),
                    details=w.get("details"),
                ))
            manifest_mod.files.append(manifest_file)
        manifest.mods.append(manifest_mod)

    return manifest


# ---------------------------------------------------------------------------
# Reader / Writer
# ---------------------------------------------------------------------------


class OutputManifestError(Exception):
    """Raised when manifest operations fail."""


class OutputManifestReader:
    """Reads an ``OutputManifest`` from a JSON file on disk."""

    @staticmethod
    def read(path: Path) -> OutputManifest:
        """Read and parse a manifest file.

        Args:
            path: Path to ``.output_manifest.json``.

        Returns:
            The parsed ``OutputManifest``.

        Raises:
            OutputManifestError: If the file cannot be read or parsed,
                or if ``schema_version`` is missing.
        """
        if not path.is_file():
            raise OutputManifestError(f"Manifest file not found: {path}")

        try:
            raw = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise OutputManifestError(
                f"Cannot read manifest file {path}: {exc}"
            ) from exc

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise OutputManifestError(
                f"Invalid JSON in manifest file {path}: {exc}"
            ) from exc

        if not isinstance(data, dict):
            raise OutputManifestError(
                f"Manifest file {path} does not contain a JSON object"
            )

        if "schema_version" not in data:
            raise OutputManifestError(
                f"Manifest file {path} is missing required "
                f"\"schema_version\" field"
            )

        return _dict_to_manifest(data)


class OutputManifestWriter:
    """Writes an ``OutputManifest`` to disk atomically."""

    @staticmethod
    def write(manifest: OutputManifest, path: Path) -> None:
        """Write a manifest file atomically.

        Uses a temporary file + ``Path.replace()`` so that partial writes
        never produce a visible manifest file.  The temp file is created
        in the same directory as the target for cross-device safety.

        Args:
            manifest: The manifest to write.
            path: Destination path (typically ``<output_root>/.output_manifest.json``).

        Raises:
            OutputManifestError: If writing fails.
        """
        directory = path.parent
        try:
            directory.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise OutputManifestError(
                f"Cannot create directory for manifest {path}: {exc}"
            ) from exc

        data = _manifest_to_dict(manifest)

        try:
            content = json.dumps(data, indent=2, ensure_ascii=False)
        except (TypeError, ValueError) as exc:
            raise OutputManifestError(
                f"Cannot serialise manifest to JSON: {exc}"
            ) from exc

        try:
            fd, tmp_path = tempfile.mkstemp(
                suffix=".tmp",
                prefix=".output_manifest_",
                dir=str(directory),
            )
            try:
                os.write(fd, content.encode("utf-8"))
                os.fsync(fd)
            finally:
                os.close(fd)

            # Atomic replace
            tmp = Path(tmp_path)
            tmp.replace(path)
        except OSError as exc:
            raise OutputManifestError(
                f"Cannot write manifest file {path}: {exc}"
            ) from exc

        logger.debug("Wrote manifest (%d bytes) to %s", len(content), path)


# ---------------------------------------------------------------------------
# Finder utility
# ---------------------------------------------------------------------------


def find_for_output_root(output_root: Path) -> Optional[Path]:
    """Return the path to ``.output_manifest.json`` inside *output_root*,
    or ``None`` if no manifest exists.
    """
    candidate = output_root / MANIFEST_FILENAME
    if candidate.is_file():
        return candidate.resolve()
    return None


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------


class OutputManifestBuilder:
    """Accumulates manifest data and builds an ``OutputManifest``.

    Usage::

        builder = OutputManifestBuilder()
        builder.set_job_info(job_id="...", job_name="...")
        builder.add_file(mod_id="...", mod_name="...", ...)
        manifest = builder.build()

    The builder is designed to be used during output file serialisation
    — each call to ``add_file()`` records one translated file.  After all
    files have been added, call ``build()`` to produce the final manifest.
    """

    def __init__(self):
        self.job_id: str = ""
        self.job_name: str = ""
        self.source_root: str = ""
        self.output_root: str = ""
        self.game_id: str = ""
        self.created_at: str = ""
        self._mods: Dict[str, OutputManifestMod] = {}

    def set_job_info(
        self,
        job_id: str,
        job_name: str = "",
        source_root: str = "",
        output_root: str = "",
        game_id: str = "",
    ) -> None:
        """Set top-level job metadata."""
        self.job_id = job_id
        self.job_name = job_name
        self.source_root = source_root
        self.output_root = output_root
        self.game_id = game_id
        if not self.created_at:
            self.created_at = _now_iso()

    def set_mod(
        self,
        mod_id: str,
        mod_name: str = "",
        source_root: str = "",
        output_root: str = "",
    ) -> None:
        """Ensure a mod entry exists with the given metadata."""
        if mod_id not in self._mods:
            self._mods[mod_id] = OutputManifestMod(
                mod_id=mod_id,
                mod_name=mod_name or mod_id,
                source_root=source_root,
                output_root=output_root,
                files=[],
            )

    def add_file(
        self,
        mod_id: str = "",
        mod_name: str = "",
        source_file_path: str = "",
        translated_file_path: str = "",
        relative_source_path: str = "",
        relative_translated_path: str = "",
        file_name: str = "",
        file_ext: str = "",
        game_id: str = "",
        parser_id: str = "",
        serializer_id: str = "",
        aggregation_key: str = "",
        group_key: str = "",
        group_label: str = "",
        entries_count: int = 0,
        translated_entries_count: int = 0,
        warnings: Optional[List[OutputManifestWarning]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Add a single file entry to the manifest under the given mod."""
        # Ensure mod exists
        effective_mod_id = mod_id or ""
        self.set_mod(
            mod_id=effective_mod_id,
            mod_name=mod_name or effective_mod_id,
        )

        file_entry = OutputManifestFile(
            source_file_path=source_file_path,
            translated_file_path=translated_file_path,
            relative_source_path=relative_source_path,
            relative_translated_path=relative_translated_path,
            file_name=file_name,
            file_ext=file_ext,
            game_id=game_id or self.game_id,
            parser_id=parser_id,
            serializer_id=serializer_id,
            aggregation_key=aggregation_key,
            group_key=group_key,
            group_label=group_label,
            entries_count=entries_count,
            translated_entries_count=translated_entries_count,
            warnings=warnings or [],
            metadata=metadata or {},
        )
        self._mods[effective_mod_id].files.append(file_entry)

    def build(self) -> OutputManifest:
        """Build and return the final ``OutputManifest``.

        Computes ``files_count`` as the total number of file entries
        across all mods.

        After calling ``build()``, the builder can continue to be used
        (calling ``add_file()`` again would not affect the returned manifest).
        """
        mods = list(self._mods.values())
        total_files = sum(len(m.files) for m in mods)
        now = _now_iso()
        return OutputManifest(
            schema_version=MANIFEST_SCHEMA_VERSION,
            job_id=self.job_id,
            job_name=self.job_name,
            created_at=self.created_at or now,
            updated_at=now,
            source_root=self.source_root,
            output_root=self.output_root,
            game_id=self.game_id,
            files_count=total_files,
            mods=mods,
        )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Collector — accumulates manifest entries during job execution
# ---------------------------------------------------------------------------


class OutputManifestCollector:
    """Collects manifest file entries during job execution.

    Each serialization path registers written files via ``register_file()``.
    At job completion, ``build_manifest()`` produces the final
    ``OutputManifest``, and ``write()`` writes it to disk atomically.

    Duplicate ``relative_translated_path`` entries are silently ignored
    (the first registration wins), which prevents duplicates when
    serialization is called multiple times.
    """

    def __init__(self):
        self.job_id: str = ""
        self.job_name: str = ""
        self.source_root: str = ""
        self.output_root: str = ""
        self.game_id: str = ""
        self.created_at: str = ""
        # mod_id -> {mod_name, files_by_relative_path}
        self._mods: Dict[str, Dict[str, Any]] = {}

    def set_job_info(
        self,
        job_id: str,
        job_name: str = "",
        source_root: str = "",
        output_root: str = "",
        game_id: str = "",
    ) -> None:
        self.job_id = job_id
        self.job_name = job_name
        self.source_root = source_root
        self.output_root = output_root
        self.game_id = game_id
        if not self.created_at:
            self.created_at = _now_iso()

    def register_file(
        self,
        source_file_path: str,
        translated_file_path: str,
        relative_source_path: str = "",
        relative_translated_path: str = "",
        file_name: str = "",
        file_ext: str = "",
        parser_id: str = "",
        serializer_id: str = "",
        game_id: str = "",
        mod_id: str = "",
        mod_name: str = "",
        aggregation_key: str = "",
        group_key: str = "",
        group_label: str = "",
        entries_count: int = 0,
        translated_entries_count: int = 0,
        warnings: Optional[List[OutputManifestWarning]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Register a single translated file.

        If *relative_translated_path* has already been registered, this
        call is a no-op (first registration wins — prevents duplicates).
        Files are grouped by mod_id within the collector.
        """
        key = relative_translated_path or file_name
        if not key:
            return

        effective_mod_id = mod_id or ""
        # Check for duplicate within this mod's files
        mod_entry = self._mods.get(effective_mod_id)
        if mod_entry is not None and key in mod_entry["files"]:
            return

        file_entry = OutputManifestFile(
            source_file_path=source_file_path,
            translated_file_path=translated_file_path,
            relative_source_path=relative_source_path,
            relative_translated_path=relative_translated_path,
            file_name=file_name,
            file_ext=file_ext,
            game_id=game_id or self.game_id,
            parser_id=parser_id,
            serializer_id=serializer_id,
            aggregation_key=aggregation_key,
            group_key=group_key,
            group_label=group_label,
            entries_count=entries_count,
            translated_entries_count=translated_entries_count,
            warnings=warnings or [],
            metadata=metadata or {},
        )

        if effective_mod_id not in self._mods:
            self._mods[effective_mod_id] = {
                "mod_name": mod_name or effective_mod_id or "",
                "files": {},
            }
        self._mods[effective_mod_id]["files"][key] = file_entry

    def file_count(self) -> int:
        return sum(len(m["files"]) for m in self._mods.values())

    def build_manifest(self) -> OutputManifest:
        """Build the final ``OutputManifest`` from all collected entries.

        Files are grouped by mod_id, preserving mod metadata from
        ``register_file()`` calls.  If no mod_id was provided, files
        are placed under a single mod with empty metadata.
        """
        now = _now_iso()
        mods: List[OutputManifestMod] = []
        for mod_id, mod_data in self._mods.items():
            files = list(mod_data["files"].values())
            mod_name = mod_data["mod_name"] or mod_id or ""
            mods.append(OutputManifestMod(
                mod_id=mod_id,
                mod_name=mod_name,
                source_root=self.source_root,
                output_root=self.output_root,
                files=files,
            ))

        total_files = sum(len(m.files) for m in mods)
        return OutputManifest(
            schema_version=MANIFEST_SCHEMA_VERSION,
            job_id=self.job_id,
            job_name=self.job_name,
            created_at=self.created_at or now,
            updated_at=now,
            source_root=self.source_root,
            output_root=self.output_root,
            game_id=self.game_id,
            files_count=total_files,
            mods=mods,
        )

    def write(self, output_root_path: Path) -> None:
        """Build and atomically write the manifest to ``output_root_path``."""
        manifest = self.build_manifest()
        if not output_root_path:
            return
        manifest_path = output_root_path / MANIFEST_FILENAME
        OutputManifestWriter.write(manifest, manifest_path)
        logger.debug("Wrote manifest via collector to %s", manifest_path)


# ---------------------------------------------------------------------------
# Manifest integrity validation
# ---------------------------------------------------------------------------


@dataclass
class ManifestIntegrityResult:
    """Result of validating a manifest against the actual output directory."""

    files_declared: int = 0
    files_found: int = 0
    missing_files: List[str] = field(default_factory=list)
    undeclared_files: List[str] = field(default_factory=list)
    is_complete: bool = True
    diagnostics: List[str] = field(default_factory=list)


def _collect_output_files(output_root: Path) -> List[str]:
    """Walk *output_root* and return list of relative POSIX paths for all
    non-hidden, non-manifest files."""
    result: List[str] = []
    if not output_root.is_dir():
        return result
    for dirpath, dirnames, filenames in os.walk(str(output_root)):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for filename in sorted(filenames):
            if filename.startswith("."):
                continue
            # Skip manifest itself
            if filename == MANIFEST_FILENAME:
                continue
            file_path = Path(dirpath) / filename
            if not file_path.is_file():
                continue
            try:
                rel = file_path.relative_to(output_root).as_posix()
            except ValueError:
                rel = filename
            result.append(rel)
    return result


def _collect_manifest_paths(manifest: OutputManifest) -> List[str]:
    """Collect all relative translated paths declared in the manifest."""
    paths: List[str] = []
    for mod in manifest.mods:
        for f in mod.files:
            if f.relative_translated_path:
                paths.append(f.relative_translated_path)
    return paths


def validate_manifest_against_output_root(
    manifest: OutputManifest,
    output_root: Path,
) -> ManifestIntegrityResult:
    """Validate a manifest against the actual files on disk.

    Compares files declared in the manifest with files actually present
    in *output_root*. Detects:
    - Missing files (declared but not on disk)
    - Undeclared files (on disk but not in manifest)
    - Total file count mismatch

    Args:
        manifest: The parsed ``OutputManifest``.
        output_root: Resolved path to the output directory.

    Returns:
        A ``ManifestIntegrityResult`` with full diagnostics.
    """
    result = ManifestIntegrityResult()

    manifest_paths = set(_collect_manifest_paths(manifest))
    disk_paths = set(_collect_output_files(output_root))

    result.files_declared = len(manifest_paths)
    result.files_found = len(disk_paths)

    # Missing: in manifest but not on disk
    result.missing_files = sorted(manifest_paths - disk_paths)
    # Undeclared: on disk but not in manifest
    result.undeclared_files = sorted(disk_paths - manifest_paths)

    if result.missing_files:
        result.diagnostics.append(
            f"{len(result.missing_files)} file(s) declared in manifest "
            f"but missing from disk: {result.missing_files}"
        )

    if result.undeclared_files:
        result.diagnostics.append(
            f"{len(result.undeclared_files)} file(s) on disk "
            f"but not declared in manifest: {result.undeclared_files}"
        )

    result.is_complete = (
        not result.missing_files
        and not result.undeclared_files
        and (result.files_declared == 0 or result.files_declared == result.files_found)
    )

    return result
