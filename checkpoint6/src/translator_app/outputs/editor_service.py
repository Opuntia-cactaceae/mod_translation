"""Editor service for translated output files.

Provides:
    - ``get_editor_payload()`` — structured editor data for the frontend.
    - ``save_translated_content()`` — persist edited content back to disk.

The service acts as a bridge between the ``TranslatedOutputFileRepository``
and the existing ``FileProcessingService`` (parser / serializer pipeline).
"""

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from translator_app.file_processing.service import FileProcessingService
from translator_app.outputs.hash_utils import hash_content
from translator_app.file_processing.models.file_type import FileCategory, EntryType
from translator_app.file_processing.models.parsed_file import ParsedGameFile
from translator_app.outputs.models import TranslatedOutputFile
from translator_app.outputs.repository import (
    TranslatedOutputFileRepository,
)
from translator_app.outputs.path_security import (
    OutputPathSecurityError,
    is_within_roots,
)


class EditorServiceError(Exception):
    """Base exception for the output editor service."""

    def __init__(self, message: str, code: str = "EDITOR_ERROR", status_code: int = 500):
        self.message = message
        self.code = code
        self.status_code = status_code
        super().__init__(message)


class FileNotFoundError(EditorServiceError):
    """Raised when an output file record is not found."""

    def __init__(self, output_file_id: str):
        super().__init__(
            message=f"Output file not found: {output_file_id}",
            code="NOT_FOUND",
            status_code=404,
        )


class ConflictError(EditorServiceError):
    """Raised on optimistic lock conflict."""

    def __init__(self, expected: str, actual: str):
        super().__init__(
            message=(
                f"Output file has been modified since last load. "
                f"Expected updated_at={expected}, actual updated_at={actual}"
            ),
            code="CONFLICT",
            status_code=409,
        )


class PathTraversalError(EditorServiceError):
    """Raised when a path is outside allowed roots."""

    def __init__(self, path: str):
        super().__init__(
            message="File path is outside allowed output roots",
            code="PATH_TRAVERSAL",
            status_code=403,
        )


class ReadError(EditorServiceError):
    """Raised when a file cannot be read."""

    def __init__(self, path: str):
        super().__init__(
            message=f"Cannot read file: {path}",
            code="FILE_READ_FAILED",
            status_code=500,
        )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_file_size(path: str) -> int:
    try:
        return Path(path).stat().st_size
    except (OSError, RuntimeError):
        return 0


def _read_file(path: str) -> str:
    """Read file content as text (utf-8)."""
    try:
        return Path(path).read_text(encoding="utf-8")
    except (OSError, RuntimeError) as exc:
        raise ReadError(path) from exc


def _safe_read_file(path: str) -> str:
    """Read file content, returning empty string on failure."""
    try:
        return Path(path).read_text(encoding="utf-8")
    except (OSError, RuntimeError):
        return ""


def _write_file(path: str, content: str) -> None:
    """Write content to a file (utf-8), ensuring parent directory exists."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


class TranslatedOutputEditorService:
    """Service for editing translated output files.

    Uses ``FileProcessingService`` for parsing/serialization and
    ``TranslatedOutputFileRepository`` for persistence metadata.

    The frontend never receives raw file paths — all operations
    are keyed by ``output_file_id``.

    If ``output_persistence`` is provided, all file writes are routed
    through ``OutputPersistenceService`` to ensure manifest registration.

    Path security validates against *allowed_output_roots* and also
    dynamically resolves the output root from the file's job record,
    so even jobs completed after service startup are handled correctly.
    """

    def __init__(
        self,
        repository: TranslatedOutputFileRepository,
        file_processing: Optional[FileProcessingService] = None,
        allowed_output_roots: Optional[List[str]] = None,
        output_persistence: Optional[Any] = None,
        job_manager: Optional[Any] = None,
    ):
        self._repo = repository
        self._file_processing = file_processing
        self._allowed_roots = list(allowed_output_roots) if allowed_output_roots else []
        self._output_persistence = output_persistence
        self._job_manager = job_manager

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_editor_payload(self, output_file_id: str) -> dict:
        """Build the editor payload for a translated output file.

        Returns a dict matching ``OutputFileEditorPayloadResponse``.
        Falls back to raw text mode when the parser cannot process the
        file or no entries are extracted.
        """
        output_file = self._get_file_or_error(output_file_id)

        source_path = output_file.source_file_path
        translated_path = output_file.translated_file_path

        # Check path security
        self._validate_path(source_path)
        self._validate_path(translated_path)

        source_exists = Path(source_path).exists()
        translated_exists = Path(translated_path).exists()

        source_content = _safe_read_file(source_path) if source_exists else ""
        translated_content = _safe_read_file(translated_path) if translated_exists else ""

        parser_id = output_file.parser_id
        game_id = output_file.game_id

        # Try structured parsing
        entries: List[Dict] = []
        structured = False

        if self._file_processing and translated_exists:
            try:
                parsed_source = self._file_processing.parse(source_path) if source_exists else None
                parsed_translated = self._file_processing.parse(translated_path)

                if parsed_source and parsed_translated:
                    entries = self._build_entry_list(parsed_source, parsed_translated)
                    structured = bool(entries)
                elif parsed_translated and not parsed_source:
                    # Source missing — use translated as structure reference
                    detection = self._file_processing.detect_file(translated_path)
                    if detection.file_type.category != FileCategory.UNKNOWN:
                        entries = [
                            {
                                "key": e.key,
                                "source_text": "",
                                "translated_text": e.translated or e.value,
                                "source_line": 0,
                                "translated_line": e.line_number,
                                "entry_type": "translation_entry" if e.is_translatable else "raw_unknown",
                                "translatable": e.is_translatable,
                                "metadata": {},
                            }
                            for e in parsed_translated.translatable_entries
                        ]
                        structured = bool(entries)
            except Exception:
                # Parser failure — fall back to raw mode
                structured = False
                entries = []
        elif self._file_processing and not translated_exists:
            # No translated file yet — try parsing source only
            try:
                if source_exists:
                    parsed_source = self._file_processing.parse(source_path)
                    entries = [
                        {
                            "key": e.key,
                            "source_text": e.value,
                            "translated_text": None,
                            "source_line": e.line_number,
                            "translated_line": 0,
                            "entry_type": "translation_entry" if e.is_translatable else "raw_unknown",
                            "translatable": e.is_translatable,
                            "metadata": {},
                        }
                        for e in parsed_source.translatable_entries
                    ]
                    structured = bool(entries)
            except Exception:
                structured = False
                entries = []

        return {
            "output_file_id": output_file.id,
            "job_id": output_file.job_id,
            "source_file": {
                "path": source_path,
                "relative_path": output_file.relative_source_path,
                "exists": source_exists,
            },
            "translated_file": {
                "path": translated_path,
                "relative_path": output_file.relative_translated_path,
                "exists": translated_exists,
            },
            "parser_id": parser_id,
            "game_id": game_id,
            "source_content": source_content,
            "translated_content": translated_content,
            "structured": structured,
            "entries": entries,
            "metadata": {
                "file_name": output_file.file_name,
                "file_ext": output_file.file_ext or "",
                "source_size_bytes": output_file.source_size_bytes or 0,
                "translated_size_bytes": output_file.translated_size_bytes or 0,
                "updated_at": output_file.updated_at,
                "status": output_file.status,
                "analysis_stale": bool(output_file.analysis_stale),
                "latest_analysis_state": TranslatedOutputFileRepository.get_analysis_state(output_file),
            },
        }

    def save_translated_content(
        self,
        output_file_id: str,
        translated_content: str,
        expected_updated_at: Optional[str] = None,
    ) -> dict:
        """Save edited translated content to disk and update metadata.

        Steps:
            1. Look up the output file record.
            2. Validate path security.
            3. Check optimistic lock if *expected_updated_at* provided.
            4. If a serializer is available for this file type, use the
               parser+serializer pipeline (preserves structure).
            5. Otherwise, write raw translated content.
            6. Update ``updated_at``, ``translated_size_bytes``, and
               set ``analysis_stale = 1``.

        Returns:
            Dict with ``success``, ``updated_at``,
            ``translated_size_bytes``, ``status``, ``analysis_stale``.

        Raises:
            APIError: If file not found, path traversal, or save fails.
        """
        output_file = self._get_file_or_error(output_file_id)
        translated_path = output_file.translated_file_path

        # Path security
        self._validate_path(translated_path)

        # Optimistic lock check
        if expected_updated_at is not None and output_file.updated_at != expected_updated_at:
            raise ConflictError(expected=expected_updated_at, actual=output_file.updated_at)

        # Try serializer path first (structure-preserving save)
        saved_via_serializer = False
        content_to_write = translated_content
        if self._file_processing and Path(output_file.source_file_path).exists():
            try:
                content_to_write = self._save_via_serializer(output_file, translated_content)
                saved_via_serializer = True
            except Exception:
                # Fall through to raw save
                pass

        if not saved_via_serializer:
            content_to_write = translated_content

        # Write via persistence service if available.
        # Uses write_existing_output_file() — NOT write_translated_file() —
        # so the in-memory manifest collector is NOT updated.  The
        # .output_manifest.json on disk is a job-completion snapshot and
        # must remain unchanged by editor saves.
        if self._output_persistence is not None:
            self._output_persistence.write_existing_output_file(
                job_id=output_file.job_id,
                output_path=translated_path,
                content=content_to_write,
            )
        else:
            _write_file(translated_path, content_to_write)

        # Update file size
        new_size = _get_file_size(translated_path)
        now = _now()

        # Compute hash of the saved translated content
        saved_hash = hash_content(content_to_write)

        # Update DB metadata with current hash
        self._repo.update_after_save(
            output_file_id=output_file_id,
            updated_at=now,
            translated_size_bytes=new_size,
            current_translated_hash=saved_hash,
        )

        return {
            "success": True,
            "updated_at": now,
            "translated_size_bytes": new_size,
            "status": "ready",
            "analysis_stale": True,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_file_or_error(self, output_file_id: str) -> TranslatedOutputFile:
        """Fetch file from repo, raising FileNotFoundError if not found."""
        file = self._repo.get_by_id(output_file_id)
        if not file:
            raise FileNotFoundError(output_file_id)
        return file

    def _validate_path(self, file_path: str) -> None:
        """Validate a file path against path security rules.

        Uses ``Path.resolve()`` and checks against allowed roots.
        Also dynamically resolves output roots from completed jobs,
        so paths from jobs completed after service startup are valid.
        """
        if not self._allowed_roots:
            return  # No roots configured — skip check

        try:
            resolved = Path(file_path).resolve()
        except (OSError, RuntimeError) as exc:
            raise EditorServiceError(
                message=f"Cannot resolve path: {file_path}",
                code="INVALID_PATH",
                status_code=400,
            ) from exc

        # First check against static allowed roots
        if is_within_roots(resolved, self._allowed_roots):
            return

        # Dynamic fallback: check against all jobs' output roots.
        # This catches jobs whose roots were not known at service init time.
        if self._job_manager is not None:
            try:
                for j in self._job_manager.list_jobs():
                    if j.output_root_dir:
                        root = Path(j.output_root_dir).resolve()
                        if resolved == root or root in resolved.parents:
                            return
            except Exception:
                pass

        raise PathTraversalError(path=file_path)

    @staticmethod
    def _build_entry_list(
        parsed_source: ParsedGameFile,
        parsed_translated: ParsedGameFile,
    ) -> List[Dict]:
        """Build editor entries by aligning source and translated entries by key.

        Strategy:
        1. Build a ``translated_by_key`` dict of translatable translated entries
           keyed by ``entry.key``.
        2. Iterate source entries in their original order:
           - **Translation entries**: look up translated value by key.
             ``entry_type`` is taken from the source entry (always
             ``translation_entry``).  Never produces ``raw_unknown`` for a
             source translation entry.
           - **Non-translatable entries** (comments, headers, raw_unknown,
             empty lines): included as non-editable.  ``entry_type`` comes
             from the source entry.
        3. Extra translated entries not found in source are appended at the
           end as orphan rows.

        This avoids impossible states like ``entry_type=raw_unknown`` with
        ``translatable=true``.
        """
        TRANSLATION_ENTRY = EntryType.TRANSLATION_ENTRY.value

        # 1. Build lookup by key for translatable translated entries
        translated_by_key: Dict[str, FileEntry] = {}
        for te in parsed_translated.entries:
            if te.is_translatable and te.key:
                translated_by_key[te.key] = te

        entries: List[Dict] = []
        matched_keys: set = set()

        # 2. Iterate source entries in order
        for src_entry in parsed_source.entries:
            key = src_entry.key or ""
            source_text = src_entry.value
            source_line = src_entry.line_number

            if src_entry.is_translatable:
                # Translation entry — look up by key in translated
                tgt_entry = translated_by_key.get(src_entry.key)
                translated_text: Optional[str] = None
                translated_line = 0
                if tgt_entry:
                    translated_text = (
                        tgt_entry.translated
                        if tgt_entry.translated is not None
                        else tgt_entry.value
                    )
                    translated_line = tgt_entry.line_number
                    matched_keys.add(src_entry.key)
                else:
                    # Key missing in translated — empty translation
                    translated_text = src_entry.translated

                entries.append({
                    "key": key,
                    "source_text": source_text,
                    "translated_text": translated_text,
                    "source_line": source_line,
                    "translated_line": translated_line,
                    "entry_type": TRANSLATION_ENTRY,
                    "translatable": True,
                    "metadata": {},
                })
            else:
                # Non-translatable — included as-is (non-editable)
                entries.append({
                    "key": key,
                    "source_text": source_text,
                    "translated_text": None,
                    "source_line": source_line,
                    "translated_line": 0,
                    "entry_type": src_entry.entry_type or "raw_unknown",
                    "translatable": False,
                    "metadata": {},
                })

        # 3. Orphan translated entries not found in source
        for te in parsed_translated.entries:
            if te.is_translatable and te.key and te.key not in matched_keys:
                entries.append({
                    "key": te.key,
                    "source_text": "",
                    "translated_text": te.translated if te.translated is not None else te.value,
                    "source_line": 0,
                    "translated_line": te.line_number,
                    "entry_type": TRANSLATION_ENTRY,
                    "translatable": True,
                    "metadata": {},
                })

        return entries

    def _save_via_serializer(
        self, output_file: TranslatedOutputFile, translated_content: str
    ) -> str:
        """Save translated content using the parser+serializer pipeline.

        Parses the source file, replaces translated text with new content
        (re-parsing the new content to extract translations), then
        serializes to preserve file structure.

        Returns:
            The serialized content string (caller is responsible for writing).
        """
        source_path = output_file.source_file_path
        translated_path = output_file.translated_file_path

        # Parse source to get structure
        parsed_source = self._file_processing.parse(source_path)

        # Parse the new translated content to extract translations
        detection = self._file_processing.detect_file(translated_path)
        parser = self._file_processing.registry.get_parser(detection.file_type.category.value)
        if parser:
            new_parsed = parser.parse(translated_content, detection.file_type)
            # Merge translated values into source structure
            for new_entry in new_parsed.translatable_entries:
                for src_entry in parsed_source.entries:
                    if src_entry.is_translatable and (
                        (src_entry.id and src_entry.id == new_entry.id)
                        or (src_entry.key and src_entry.key == new_entry.key)
                    ):
                        src_entry.translated = new_entry.translated or new_entry.value
                        break

        # Serialize using the registry serializer
        serialized = self._file_processing.serialize_file(
            parsed_source, output_path=translated_path
        )

        return serialized.content
