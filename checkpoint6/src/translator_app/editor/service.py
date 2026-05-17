"""Editor Service — data layer for the comparison editor.

Builds EditorData from ParsedGameFile + TranslationUnits + diagnostics,
accepts manual edits, and prepares data for serialization.
"""

import os
import shutil
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from translator_app.editor.models import EditorData, EditorRow, EditorStats, EditorState
from translator_app.file_processing.models.entries import FileEntry
from translator_app.file_processing.models.parsed_file import ParsedGameFile
from translator_app.file_processing.models.translation_unit import TranslationUnit
from translator_app.diagnostics.models import Diagnostic, DiagnosticLevel
from translator_app.output.models import OutputNameResult, OutputNamingOptions


class EditorService:
    """Prepares and manages editor data for the comparison view.

    Sources:
        - ParsedGameFile / FileEntry (file structure)
        - TranslationUnit (translations)
        - DiagnosticsRepository (warnings/errors)
        - In-memory edit cache (user edits during the session)

    Dependencies (all optional, fallback to in-memory-only mode):
        file_processing: FileProcessingService  — parse / serialize
        db_service: DatabaseService              — storage-backed repos
    """

    # Status constants
    STATUS_NON_EDITABLE = "non_editable"
    STATUS_UNTRANSLATED = "untranslated"
    STATUS_TRANSLATED = "translated"
    STATUS_EDITED = "edited"
    STATUS_FROM_CACHE = "from_cache"
    STATUS_ERROR = "error"

    # Entry type constants
    TYPE_TRANSLATION = "translation_entry"
    TYPE_COMMENT = "comment"
    TYPE_EMPTY = "empty"
    TYPE_RAW_UNKNOWN = "raw_unknown"

    def __init__(self, file_processing=None, db_service=None, output_naming=None,
                 logging_service=None):
        self.state = EditorState()
        self._file_processing = file_processing
        self._db_service = db_service
        self._output_naming = output_naming
        self._log = logging_service

        # In-memory edit cache: file_id -> dict[row_id -> translated_text]
        self._edit_cache: Dict[str, Dict[str, str]] = {}

        # In-memory editor data cache: file_id -> EditorData
        self._data_cache: Dict[str, EditorData] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_editor_data(
        self,
        file_id: Optional[str] = None,
        job_id: Optional[str] = None,
        path: Optional[str] = None,
    ) -> EditorData:
        """Build or retrieve editor data for a file.

        Args:
            file_id: Unique file identifier (usually file path or DB id).
            job_id: Optional job id to scope translation units.
            path:  File path on disk (fallback if file_id is not a path).
        """
        # Resolve file path
        source_path = path or file_id or ""

        # If cached, return cached data (with live edits merged)
        if file_id and file_id in self._data_cache:
            return self._apply_cached_edits(self._data_cache[file_id])

        # Build fresh editor data
        return self._build_editor_data(file_id=file_id, source_path=source_path, job_id=job_id)

    def update_entry(self, file_id: str, entry_id: str, translated_text: str) -> EditorRow:
        """Update a single entry's translation.

        Mutates in-memory cache and persists to storage if available.
        Returns the updated EditorRow.
        """
        # Ensure data is loaded
        editor_data = self.get_editor_data(file_id=file_id)

        # Find the row
        row = self._find_row(editor_data, entry_id)
        if row is None:
            raise ValueError(f"Row not found: {entry_id}")

        if not row.editable:
            raise ValueError(f"Entry {entry_id} is not editable")

        # Update in-memory edit cache
        if file_id not in self._edit_cache:
            self._edit_cache[file_id] = {}
        self._edit_cache[file_id][entry_id] = translated_text

        # Persist to storage if available
        self._persist_edit(file_id, entry_id, translated_text)

        # Return updated row
        row.translated_text = translated_text
        row.status = self.STATUS_EDITED

        if self._log is not None:
            self._log.info(
                module="editor",
                message="edit_applied",
                context={"file_id": file_id, "entry_id": entry_id},
                file_id=file_id,
            )

        return row

    def bulk_update(self, file_id: str, changes: List[dict]) -> List[EditorRow]:
        """Apply multiple edits at once.

        Each change: {"row_id": str, "translated_text": str}
        Returns list of updated EditorRow objects.
        """
        results = []
        for change in changes:
            row = self.update_entry(
                file_id=file_id,
                entry_id=change["row_id"],
                translated_text=change["translated_text"],
            )
            results.append(row)
        return results

    def prepare_for_save(self, file_id: str) -> ParsedGameFile:
        """Apply all edits to a freshly-parsed ParsedGameFile.

        Returns the updated ParsedGameFile ready for serialization.
        """
        editor_data = self.get_editor_data(file_id=file_id)

        # Re-parse the source file to get a clean copy
        if self._file_processing and editor_data.source_path:
            fresh = self._file_processing.parse(editor_data.source_path)
        else:
            raise RuntimeError(f"Cannot prepare for save: no file_processing service and no source_path for {file_id}")

        # Build edit map: row_id -> translated_text
        edit_map = {}
        if file_id in self._edit_cache:
            edit_map.update(self._edit_cache[file_id])

        # Also collect translations from editor rows
        for row in editor_data.rows:
            if row.status not in (self.STATUS_NON_EDITABLE,) and row.translated_text is not None:
                if row.row_id not in edit_map:
                    edit_map[row.row_id] = row.translated_text

        # Apply edits matching by entry id, then by key
        for entry in fresh.entries:
            if not entry.is_translatable:
                continue
            translated = None
            if entry.id and entry.id in edit_map:
                translated = edit_map[entry.id]
            elif entry.key and entry.key in edit_map:
                translated = edit_map[entry.key]
            # Also try matching by row_id pattern: "entry_{entry.id}" or "idx_{line_no}"
            row_key = f"idx_{entry.line_number}"
            if row_key in edit_map:
                translated = edit_map[row_key]

            if translated is not None:
                entry.translated = translated

        return fresh

    def validate_before_save(self, file_id: str) -> dict:
        """Validate the file before saving.

        Returns dict with is_valid, errors, warnings.
        """
        if not self._file_processing:
            return {"is_valid": True, "errors": [], "warnings": []}

        try:
            parsed = self.prepare_for_save(file_id)
            validation = self._file_processing.validate_file(parsed)
            return {
                "is_valid": validation.is_valid,
                "errors": [str(d) for d in validation.errors],
                "warnings": [str(d) for d in validation.warnings],
            }
        except Exception as e:
            return {"is_valid": False, "errors": [str(e)], "warnings": []}

    def save_file(
        self,
        file_id: str,
        output_path: str,
        overwrite: bool = False,
        backup: bool = True,
        naming_result: Optional[OutputNameResult] = None,
    ) -> str:
        """Apply edits, serialize, and write to disk.

        Args:
            file_id: File identifier for the editor data.
            output_path: Destination file path.
            overwrite: If False and file exists, raise FileExistsError.
            backup: If True, create a .bak copy of the existing file.
            naming_result: Pre-computed naming result (overrides manual
                overwrite/backup logic when provided).

        Returns:
            The output path where the file was written.

        Raises:
            FileExistsError: If output_path exists and overwrite is False.
            RuntimeError: If serialization fails.
        """
        if not self._file_processing:
            raise RuntimeError("Cannot save: file_processing service is required")

        # Use naming result if provided (new codepath)
        if naming_result is not None:
            output = Path(naming_result.output_path)
            if naming_result.conflict and not naming_result.will_overwrite:
                raise FileExistsError(
                    f"Output path exists and overwrite=False: {naming_result.output_path}"
                )
            if naming_result.backup_path:
                backup_path = Path(naming_result.backup_path)
                if output.exists():
                    shutil.copy2(str(output), str(backup_path))
        else:
            # Legacy codepath (backward compatible)
            output = Path(output_path)
            if output.exists():
                if not overwrite:
                    raise FileExistsError(
                        f"Output path exists and overwrite=False: {output_path}"
                    )
                if backup:
                    backup_path = output.with_suffix(output.suffix + ".bak")
                    shutil.copy2(str(output), str(backup_path))

        # Prepare and serialize
        parsed = self.prepare_for_save(file_id)
        serialized = self._file_processing.serialize_file(parsed, output_path=str(output))

        # Write to disk
        encoding = serialized.encoding or "utf-8"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(serialized.content, encoding=encoding)

        # Re-parse and validate the written file
        try:
            re_parsed = self._file_processing.parse(str(output))
            validation = self._file_processing.validate_file(re_parsed)
            if not validation.is_valid:
                # Store diagnostics but don't fail — just warn
                editor_data = self._data_cache.get(file_id)
                if editor_data:
                    pass  # diagnostics are informational here
        except Exception:
            pass  # Best-effort re-validation

        if self._log is not None:
            self._log.info(
                module="editor",
                message="file_saved",
                context={"file_id": file_id, "output_path": str(output)},
                file_id=file_id,
            )

        return str(output)

    # ------------------------------------------------------------------
    # Internal: build editor data
    # ------------------------------------------------------------------

    def _build_editor_data(
        self,
        file_id: Optional[str],
        source_path: str,
        job_id: Optional[str] = None,
    ) -> EditorData:
        """Build EditorData from ParsedGameFile and TranslationUnits."""
        parsed_file = self._load_parsed_file(source_path)

        # Use file_id from parsed file or fallback
        resolved_file_id = file_id or parsed_file.id or source_path

        # Load translation units from storage or extract from parsed file
        units = self._load_translation_units(resolved_file_id, job_id, parsed_file)

        # Build unit lookup: entry_id -> TranslationUnit, key -> TranslationUnit
        unit_by_entry_id: Dict[str, TranslationUnit] = {}
        unit_by_key: Dict[str, TranslationUnit] = {}
        for unit in units:
            if unit.entry_id:
                unit_by_entry_id[unit.entry_id] = unit
            if unit.key:
                unit_by_key[unit.key] = unit

        # Load diagnostics from storage
        diagnostics = self._load_diagnostics(resolved_file_id)

        # Group diagnostics by entry_id
        diag_by_entry: Dict[str, List[Diagnostic]] = {}
        for d in diagnostics:
            eid = d.entry_id or ""
            if eid not in diag_by_entry:
                diag_by_entry[eid] = []
            diag_by_entry[eid].append(d)

        # Build rows
        rows: List[EditorRow] = []
        for i, entry in enumerate(parsed_file.entries):
            row = self._entry_to_row(
                entry=entry,
                index=i,
                unit_by_entry_id=unit_by_entry_id,
                unit_by_key=unit_by_key,
                diag_by_entry=diag_by_entry,
            )
            rows.append(row)

        # Compute stats
        stats = self._compute_stats(rows)

        editor_data = EditorData(
            file_id=resolved_file_id,
            source_path=parsed_file.source_path or source_path,
            rows=rows,
            stats=stats,
        )

        # Cache the built data
        self._data_cache[resolved_file_id] = editor_data

        return editor_data

    def _entry_to_row(
        self,
        entry: FileEntry,
        index: int,
        unit_by_entry_id: Dict[str, TranslationUnit],
        unit_by_key: Dict[str, TranslationUnit],
        diag_by_entry: Dict[str, List[Diagnostic]],
    ) -> EditorRow:
        """Convert a FileEntry + optional TranslationUnit to an EditorRow."""
        # Determine row_id
        row_id = entry.id or f"idx_{entry.line_number or index}"

        # Determine entry_type
        entry_type = self._classify_entry(entry)

        # Determine translatable status
        if entry_type == self.TYPE_TRANSLATION:
            editable = True
        else:
            editable = False

        # Find translation unit
        unit = None
        if entry.id and entry.id in unit_by_entry_id:
            unit = unit_by_entry_id[entry.id]
        elif entry.key and entry.key in unit_by_key:
            unit = unit_by_key[entry.key]

        # Determine source and translated text
        source_text = entry.value
        translated_text = entry.translated  # from file entry

        if unit is not None:
            # Prefer TranslationUnit's target if available
            if unit.target:
                translated_text = unit.target
            elif unit.target == "" and unit.status == "completed":
                translated_text = ""  # explicitly empty
            # else keep entry.translated or None

        # Determine status
        status = self._compute_status(
            entry_type=entry_type,
            unit=unit,
            translated_text=translated_text,
            entry=entry,
        )

        # Collect warnings and errors from diagnostics and entry
        warnings = []
        errors = []

        # From entry diagnostics
        for d in getattr(entry, "diagnostics", []):
            if isinstance(d, Diagnostic):
                if d.level in (DiagnosticLevel.WARNING, DiagnosticLevel.INFO):
                    warnings.append(d)
                elif d.level in (DiagnosticLevel.ERROR, DiagnosticLevel.CRITICAL):
                    errors.append(d)
            elif isinstance(d, dict):
                if d.get("level") in ("warning", "info"):
                    warnings.append(d)
                elif d.get("level") in ("error", "critical"):
                    errors.append(d)

        # From storage diagnostics
        if entry.id and entry.id in diag_by_entry:
            for d in diag_by_entry[entry.id]:
                if d.level in (DiagnosticLevel.WARNING, DiagnosticLevel.INFO):
                    warnings.append(d)
                elif d.level in (DiagnosticLevel.ERROR, DiagnosticLevel.CRITICAL):
                    errors.append(d)

        # Raw line
        raw_line = entry.raw or entry.raw_line or ""

        return EditorRow(
            row_id=row_id,
            line_no=entry.line_number,
            entry_type=entry_type,
            key=entry.key,
            source_text=source_text,
            translated_text=translated_text,
            status=status,
            warnings=warnings,
            errors=errors,
            raw_line=raw_line,
            editable=editable,
        )

    # ------------------------------------------------------------------
    # Internal: status / classification helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _classify_entry(entry: FileEntry) -> str:
        """Classify a FileEntry into an entry_type string."""
        if not entry.is_translatable:
            if entry.comment is not None:
                return "comment"
            if not entry.value and not entry.key:
                return "empty"
            return "raw_unknown"
        return "translation_entry"

    def _compute_status(
        self,
        entry_type: str,
        unit: Optional[TranslationUnit],
        translated_text: Optional[str],
        entry: FileEntry,
    ) -> str:
        """Compute the display status for a row."""
        # Non-editable rows
        if entry_type != self.TYPE_TRANSLATION:
            return self.STATUS_NON_EDITABLE

        # Check for errors in diagnostics
        for d in getattr(entry, "diagnostics", []):
            if isinstance(d, Diagnostic) and d.level in (DiagnosticLevel.ERROR, DiagnosticLevel.CRITICAL):
                return self.STATUS_ERROR
            if isinstance(d, dict) and d.get("level") in ("error", "critical"):
                return self.STATUS_ERROR

        # Check unit-level diagnostics
        if unit:
            for d in getattr(unit, "diagnostics", []):
                if isinstance(d, Diagnostic) and d.level in (DiagnosticLevel.ERROR, DiagnosticLevel.CRITICAL):
                    return self.STATUS_ERROR

        # From cache
        if unit and unit.from_cache:
            return self.STATUS_FROM_CACHE

        # No translation
        if translated_text is None or translated_text == "":
            return self.STATUS_UNTRANSLATED

        # Has translation -> translated
        return self.STATUS_TRANSLATED

    @staticmethod
    def _compute_stats(rows: List[EditorRow]) -> EditorStats:
        """Compute aggregate statistics from a list of rows."""
        total = len(rows)
        translated = sum(
            1 for r in rows
            if r.status in ("translated", "edited", "from_cache")
            and r.translated_text is not None
        )
        edited = sum(1 for r in rows if r.status == "edited")
        warnings_count = sum(len(r.warnings) for r in rows)
        errors_count = sum(len(r.errors) for r in rows)
        return EditorStats(
            total_rows=total,
            translated_rows=translated,
            edited_rows=edited,
            warnings_count=warnings_count,
            errors_count=errors_count,
        )

    # ------------------------------------------------------------------
    # Internal: data loading
    # ------------------------------------------------------------------

    def _load_parsed_file(self, source_path: str) -> ParsedGameFile:
        """Parse a file on disk. Raises FileNotFoundError if missing."""
        if self._file_processing:
            return self._file_processing.parse(source_path)

        # Fallback: minimal stub ParsedGameFile
        from translator_app.file_processing.models.file_type import FileType
        p = ParsedGameFile(file_type=FileType.UNKNOWN, source_path=source_path)
        return p

    def _load_translation_units(
        self,
        file_id: str,
        job_id: Optional[str],
        parsed_file: ParsedGameFile,
    ) -> List[TranslationUnit]:
        """Load translation units from storage or extract from parsed file."""
        units: List[TranslationUnit] = []

        # Try storage layer first
        if self._db_service:
            try:
                from translator_app.storage.repositories import TranslationUnitRepository
                repo = TranslationUnitRepository(self._db_service)
                if job_id:
                    units = repo.get_units_by_job(job_id)
                elif file_id:
                    units = repo.get_units_by_file(file_id)
            except Exception:
                units = []

        # Fallback: extract from parsed file
        if not units and self._file_processing:
            units = self._file_processing.extract_translation_units(parsed_file)

        return units

    def _load_diagnostics(self, file_id: str) -> List[Diagnostic]:
        """Load diagnostics from storage for the given entity."""
        diagnostics: List[Diagnostic] = []
        if self._db_service:
            try:
                from translator_app.storage.repositories import DiagnosticsRepository
                repo = DiagnosticsRepository(self._db_service)
                raw_diags = repo.list_by_entity(file_id)
                for d in raw_diags:
                    try:
                        level = DiagnosticLevel(d["level"])
                    except ValueError:
                        level = DiagnosticLevel.WARNING
                    diagnostics.append(Diagnostic(
                        level=level,
                        message=d.get("message", ""),
                        code=d.get("code", ""),
                        entry_id=d.get("entity_id", file_id),
                    ))
            except Exception:
                pass
        return diagnostics

    # ------------------------------------------------------------------
    # Internal: edit management
    # ------------------------------------------------------------------

    def _persist_edit(self, file_id: str, entry_id: str, translated_text: str) -> None:
        """Persist an edit to storage if available."""
        if not self._db_service:
            return
        try:
            from translator_app.storage.repositories import TranslationUnitRepository
            repo = TranslationUnitRepository(self._db_service)
            unit = repo.get_unit(entry_id)
            if unit:
                unit.target = translated_text
                unit.status = "completed"
                repo.update_unit(unit)
        except Exception:
            pass

    def _apply_cached_edits(self, editor_data: EditorData) -> EditorData:
        """Merge cached edits into a frozen EditorData copy."""
        file_id = editor_data.file_id
        if file_id not in self._edit_cache:
            return editor_data

        cached = self._edit_cache[file_id]
        if not cached:
            return editor_data

        # Make a shallow copy with updated rows
        updated_rows = []
        for row in editor_data.rows:
            if row.row_id in cached and row.editable:
                # Create a new row with updated translated_text and status
                new_row = EditorRow(
                    row_id=row.row_id,
                    line_no=row.line_no,
                    entry_type=row.entry_type,
                    key=row.key,
                    source_text=row.source_text,
                    translated_text=cached[row.row_id],
                    status=self.STATUS_EDITED,
                    warnings=row.warnings,
                    errors=row.errors,
                    raw_line=row.raw_line,
                    editable=row.editable,
                )
                updated_rows.append(new_row)
            else:
                updated_rows.append(row)

        # Recompute stats
        stats = self._compute_stats(updated_rows)

        return EditorData(
            file_id=editor_data.file_id,
            source_path=editor_data.source_path,
            output_path=editor_data.output_path,
            rows=updated_rows,
            stats=stats,
        )

    @staticmethod
    def _find_row(editor_data: EditorData, entry_id: str) -> Optional[EditorRow]:
        """Find an EditorRow by row_id within editor_data."""
        for row in editor_data.rows:
            if row.row_id == entry_id:
                return row
        return None

    # ------------------------------------------------------------------
    # Legacy API (backward-compatible)
    # ------------------------------------------------------------------

    def open_file(self, file_path: str) -> None:
        """Legacy: open a file and set editor state."""
        self.state.current_file = file_path
        self.state.unsaved_changes = False

    def close_file(self) -> None:
        """Legacy: close the current file."""
        self.state.current_file = None
        self.state.unsaved_changes = False
