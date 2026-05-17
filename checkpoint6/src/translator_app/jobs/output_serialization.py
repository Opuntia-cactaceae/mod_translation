"""Output Serialization Service — serializes translated files for completed jobs.

Replaces the old ``_serialize_generic_output_files()`` in execution.py
with a proper service that:

1. Groups translated units by source file.
2. Re-parses each source file via ``FileProcessingService``.
3. Selects the correct serializer through ``FileProcessingService``
   (which dispatches by ``FileCategory`` — StellarisLocalisationSerializer
   for ``.yml`` localisation, PlainTextSerializer for plain text, etc.).
4. Resolves the output path through ``OutputNamingService``.
5. Writes the file and registers it in the manifest through
   ``OutputPersistenceService.write_translated_file()``.
6. Returns structured metadata for tracking on the job.

Architectural invariant:
    The serializer used must match the parser that read the source file.
    ``FileProcessingService.serialize_file()`` guarantees this by
    dispatching based on the detected ``FileCategory``.  execution.py
    must never contain game-specific serialization logic.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from translator_app.file_processing.models.translation_unit import TranslationUnit
from translator_app.file_processing.service import FileProcessingService
from translator_app.jobs.models import TranslationJob
from translator_app.output.models import OutputNamingOptions
from translator_app.output.naming import OutputNamingService

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class SerializedOutputFile:
    """Metadata for a single serialized output file.

    Attributes:
        source_file_path: Absolute path to the original source file.
        output_path: Absolute path where the translated file was written.
        relative_source_path: Source path relative to source root.
        relative_output_path: Output path relative to output root.
        parser_id: The parser that read the source (e.g. "stellaris_localisation").
        serializer_id: The serializer that wrote the output (e.g. "stellaris_localisation").
        file_type_name: Category name from the parsed file type.
        entries_count: Total translatable entries in the source.
        translated_entries_count: Entries that had a translated value applied.
        warnings: Human-readable warnings from serialization.
    """
    source_file_path: str = ""
    output_path: str = ""
    relative_source_path: str = ""
    relative_output_path: str = ""
    parser_id: str = ""
    serializer_id: str = ""
    file_type_name: str = ""
    entries_count: int = 0
    translated_entries_count: int = 0
    warnings: List[str] = field(default_factory=list)


@dataclass
class OutputSerializationResult:
    """Result of serializing all output files for a job.

    Attributes:
        output_root_dir: The root output directory (parent of all output files).
        output_files: List of absolute output file paths (for job tracking).
        serialized_files: Detailed metadata per output file.
        warnings: Top-level warnings from the serialization process.
    """
    output_root_dir: str = ""
    output_files: List[str] = field(default_factory=list)
    serialized_files: List[SerializedOutputFile] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class OutputSerializationService:
    """Serializes translated units into output files for completed jobs.

    Orchestrates parsing → translation application → serialization → disk write
    for every source file in a completed translation job.  Does NOT contain
    any game-specific logic — all game-awareness lives in
    ``FileProcessingService`` (parser/serializer dispatch) and
    ``OutputNamingService`` (filename conventions).

    Dependencies are injected (not created internally) so that tests can
    supply mocks or specialised instances.
    """

    def __init__(
        self,
        file_service: FileProcessingService,
        naming_service: Optional[OutputNamingService] = None,
        output_persistence: Optional[Any] = None,
    ):
        self._file_service = file_service
        self._naming = naming_service or OutputNamingService()
        self._output_persistence = output_persistence

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def serialize_job_outputs(
        self,
        job: TranslationJob,
        merged_units: Optional[List[TranslationUnit]] = None,
    ) -> OutputSerializationResult:
        """Serialize all translated output files for a completed job.

        Args:
            job: The completed (or partially completed) translation job.
            merged_units: Optional pre-merged unit list.  When provided,
                used directly; otherwise units are fetched from ``job.units``.
                This supports retry jobs where parent and retry units must
                be merged before serialization.

        Returns:
            An ``OutputSerializationResult`` with paths and metadata.
        """
        if not job.file_paths:
            return OutputSerializationResult()

        all_units = merged_units if merged_units is not None else list(job.units or [])

        result = OutputSerializationResult()
        warnings: List[str] = []

        for source_path in job.file_paths:
            try:
                serialized = self._serialize_single_file(
                    job=job,
                    source_path=source_path,
                    all_units=all_units,
                )
                if serialized is not None:
                    result.serialized_files.append(serialized)
                    result.output_files.append(serialized.output_path)

                    # Track output root from the first file
                    if not result.output_root_dir:
                        result.output_root_dir = os.path.dirname(serialized.output_path)

                    if serialized.warnings:
                        warnings.extend(serialized.warnings)
            except Exception as exc:
                msg = f"Failed to serialize {source_path}: {exc}"
                logger.warning(msg)
                warnings.append(msg)

        result.warnings = warnings
        return result

    # ------------------------------------------------------------------
    # Internal: single-file serialization
    # ------------------------------------------------------------------

    def _serialize_single_file(
        self,
        job: TranslationJob,
        source_path: str,
        all_units: List[TranslationUnit],
    ) -> Optional[SerializedOutputFile]:
        """Serialize one source file's translations and write to disk.

        Steps:
            1. Resolve output path via ``OutputNamingService``.
            2. Re-parse the source file via ``FileProcessingService``.
            3. Filter units belonging to this file.
            4. Serialize via ``FileProcessingService.serialize_file()`` —
               this auto-selects the correct serializer by file category.
            5. Write to disk + register manifest via
               ``OutputPersistenceService.write_translated_file()``.
            6. Collect and return metadata as ``SerializedOutputFile``.

        Returns:
            ``SerializedOutputFile`` metadata, or ``None`` if an error
            prevented serialization (logged, not raised — best-effort).
        """
        # --- Resolve output path ---
        output_path = self._resolve_output_path(job, source_path)
        if not output_path:
            return None

        # --- Re-parse source file ---
        try:
            parsed = self._file_service.parse_file(source_path)
        except Exception as exc:
            logger.warning("Cannot parse source file %s: %s", source_path, exc)
            return None

        # --- Extract parser/serializer info from parsed file ---
        file_type_name = parsed.file_type.category.value if parsed.file_type.category else "unknown"
        entries_count = len(parsed.translatable_entries)

        # --- Filter units for this file ---
        file_units = [
            u for u in all_units
            if self._unit_belongs_to_file(u, source_path)
        ]

        # --- Serialize (apply translations + produce output content) ---
        try:
            # When the file service has no adapter, apply translations
            # first — the registry-based serializer doesn't receive
            # translations and expects them on the parsed entries.
            if self._file_service.adapter is None:
                parsed = self._file_service.apply_translations(parsed, file_units)
                serialized = self._file_service.serialize_file(
                    parsed, output_path=output_path,
                )
            else:
                serialized = self._file_service.serialize_file(
                    parsed,
                    output_path=output_path,
                    translations=file_units,
                )
        except Exception as exc:
            logger.warning("Cannot serialize file %s: %s", source_path, exc)
            return None

        if not serialized.content:
            logger.warning("Serialized content is empty for %s", source_path)
            return None

        if not serialized.output_path:
            serialized.output_path = output_path

        # --- Write through persistence service (write + manifest register) ---
        try:
            self._write_via_persistence(
                job=job,
                source_path=source_path,
                output_path=serialized.output_path,
                content=serialized.content,
                parsed_file=parsed,
                file_units=file_units,
                encoding=serialized.encoding or "utf-8",
            )
        except Exception as exc:
            logger.warning(
                "Cannot write translated file %s: %s",
                serialized.output_path, exc,
            )
            return None

        # --- Compute relative paths ---
        output_root = os.path.dirname(serialized.output_path) if serialized.output_path else ""
        relative_source = self._compute_relative(source_path, output_root)
        relative_output = self._compute_relative(serialized.output_path, output_root)

        # --- Count translated entries ---
        translated_count = len([
            u for u in file_units
            if u.target and u.target.strip()
        ])

        # --- Collect serializer ID ---
        serializer_id = self._resolve_serializer_id(parsed)

        # --- Build warnings ---
        file_warnings = []
        for diag in getattr(serialized, "diagnostics", []):
            msg = getattr(diag, "message", str(diag))
            if msg:
                file_warnings.append(msg)

        return SerializedOutputFile(
            source_file_path=source_path,
            output_path=serialized.output_path,
            relative_source_path=relative_source,
            relative_output_path=relative_output,
            parser_id=file_type_name,
            serializer_id=serializer_id,
            file_type_name=file_type_name,
            entries_count=entries_count,
            translated_entries_count=translated_count,
            warnings=file_warnings,
        )

    # ------------------------------------------------------------------
    # Output path resolution
    # ------------------------------------------------------------------

    def _resolve_output_path(
        self,
        job: TranslationJob,
        source_path: str,
    ) -> Optional[str]:
        """Resolve the output file path for a single source file.

        Uses ``OutputNamingService`` to generate the path.  All naming
        logic (Stellaris ``_l_english`` → ``_l_russian``, generic suffix
        appending, etc.) is delegated to the naming service.

        Returns:
            Absolute output path, or ``None`` if resolution fails.
        """
        config = job.config

        # Determine output directory
        output_dir = ""
        if job.output_root_dir:
            output_dir = job.output_root_dir
        elif config and hasattr(config, "output") and config.output:
            if hasattr(config.output, "output_dir") and config.output.output_dir:
                output_dir = config.output.output_dir
        if not output_dir:
            output_dir = os.path.dirname(os.path.abspath(source_path))

        # Determine destination language
        dst_lang = "ru"
        if config and hasattr(config, "dst_lang") and config.dst_lang:
            dst_lang = config.dst_lang

        # Build naming options
        options = OutputNamingOptions(
            mode="auto",
            overwrite=True,
            backup=False,
        )

        # Apply filename_suffix from config if present (backward compat for generic)
        if config and hasattr(config, "output") and config.output:
            suffix = getattr(config.output, "filename_suffix", None) or ""
            if suffix:
                options.suffix = suffix

        try:
            naming_result = self._naming.generate_name(
                source_path=source_path,
                src_lang="en",
                dst_lang=dst_lang,
                options=options,
                output_dir=output_dir,
            )
            return naming_result.output_path
        except Exception as exc:
            logger.warning("Cannot resolve output path for %s: %s", source_path, exc)
            return None

    # ------------------------------------------------------------------
    # Persistence write
    # ------------------------------------------------------------------

    def _write_via_persistence(
        self,
        job: TranslationJob,
        source_path: str,
        output_path: str,
        content: str,
        parsed_file: Any,
        file_units: List[TranslationUnit],
        encoding: str = "utf-8",
    ) -> None:
        """Write translated content and register in the manifest collector.

        Falls back to direct file write if no persistence service is configured.
        """
        if self._output_persistence is not None:
            self._output_persistence.write_translated_file(
                job_id=job.id,
                output_path=output_path,
                content=content,
                source_path=source_path,
                parsed_file=parsed_file,
                file_units=file_units,
                encoding=encoding,
            )
        else:
            # No persistence service — write directly (should not happen in production)
            output_dir = os.path.dirname(output_path)
            if output_dir:
                os.makedirs(output_dir, exist_ok=True)
            with open(output_path, "w", encoding=encoding) as f:
                f.write(content)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _unit_belongs_to_file(unit: TranslationUnit, file_path: str) -> bool:
        """Check if a translation unit originated from the given source file."""
        if unit.file_path:
            return unit.file_path == file_path
        if unit.file_id and file_path:
            return unit.file_id in file_path
        return True  # single-file fallback: include all units

    @staticmethod
    def _resolve_serializer_id(parsed_file: Any) -> str:
        """Extract the serializer id from a parsed file."""
        try:
            ft = parsed_file.file_type
            if ft is not None:
                cat = ft.category
                if cat is not None:
                    return cat.value if hasattr(cat, "value") else str(cat)
        except Exception:
            pass
        return ""

    @staticmethod
    def _compute_relative(path_str: str, root_str: str) -> str:
        """Compute a relative POSIX path from root to path."""
        if not path_str or not root_str:
            return os.path.basename(path_str) if path_str else ""
        try:
            p = Path(path_str).resolve()
            r = Path(root_str).resolve()
            return p.relative_to(r).as_posix()
        except (ValueError, OSError):
            return os.path.basename(path_str)
