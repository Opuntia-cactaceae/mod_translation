from pathlib import Path
from typing import List, Optional

from translator_app.file_processing.registry import FileProcessingRegistry, get_default_registry
from translator_app.file_processing.models.file_type import FileType, FileCategory
from translator_app.file_processing.models.parsed_file import ParsedGameFile, FileDetectionResult, SerializedFile
from translator_app.file_processing.models.translation_unit import TranslationUnit
from translator_app.diagnostics.models import ValidationResult, Diagnostic, DiagnosticLevel
from translator_app.games.base import GameAdapter


class FileProcessingService:
    """Orchestrates detection, parsing, serialization, and validation.

    Public methods (TZ-specified API):
        detect_file(path) -> FileDetectionResult
        parse_file(path) -> ParsedGameFile
        validate_file(parsed_file) -> ValidationResult
        extract_translation_units(parsed_file, src_lang, dst_lang) -> list[TranslationUnit]
        apply_translations(parsed_file, translated_units) -> ParsedGameFile
        serialize_file(parsed_file) -> SerializedFile

    Legacy methods (backward-compatible):
        detect(path) -> FileDetectionResult
        parse(path) -> ParsedGameFile
        serialize(parsed_file) -> str
        file_to_units(file_path) -> list[TranslationUnit]
    """

    def __init__(self, registry: Optional[FileProcessingRegistry] = None, adapter: Optional[GameAdapter] = None):
        self.registry = registry or get_default_registry()
        self.adapter = adapter

    # --- Legacy API (backward-compatible) ---

    def detect(self, file_path: str) -> FileDetectionResult:
        """Detect file type using registered detectors. Legacy API."""
        return self.detect_file(file_path)

    def parse(self, file_path: str) -> ParsedGameFile:
        """Detect and parse a file. Legacy API."""
        return self.parse_file(file_path)

    def serialize(self, parsed_file: ParsedGameFile) -> str:
        """Serialize a parsed file back to string. Legacy API."""
        return self.serialize_file(parsed_file).content

    def file_to_units(self, file_path: str) -> List[TranslationUnit]:
        """Parse a file and extract translation units. Legacy API."""
        parsed = self.parse_file(file_path)
        return self.extract_translation_units(parsed)

    # --- New TZ-specified API ---

    def detect_file(self, file_path: str) -> FileDetectionResult:
        """Detect file type using registered detectors.

        When a GameAdapter is configured, its own detect_file result is
        also considered and takes priority when confidence is >= that of
        the best registered detector.
        """
        path = Path(file_path)
        content = ""
        if path.exists():
            content = self._read_file_safe(path)

        best = FileDetectionResult(
            file_type=FileType.UNKNOWN,
            confidence=0.0,
            path=file_path,
        )
        for name in self.registry.detector_names:
            detector = self.registry.get_detector(name)
            if detector:
                result = detector.detect(file_path, content)
                if result.confidence > best.confidence:
                    best = result

        # Let the adapter's detection take priority when it is at least
        # as confident as the best registered detector.
        if self.adapter:
            adapter_result = self.adapter.detect_file(file_path)
            if adapter_result.confidence >= best.confidence:
                best = adapter_result

        return best

    def parse_file(self, file_path: str) -> ParsedGameFile:
        """Detect and parse a file.

        Uses the GameAdapter when available for game-specific types;
        falls back to registry-based dispatch for other types (plain_text, etc.).
        """
        detection = self.detect_file(file_path)

        # Use adapter for game-specific parsing if available
        if self.adapter and detection.file_type.category in (
            FileCategory.STELLARIS_LOCALISATION,
            FileCategory.GENERIC_PLAIN_TEXT,
            FileCategory.GENERIC_JSON,
            FileCategory.GENERIC_YAML,
        ):
            parsed = self.adapter.parse_file(file_path)
            parsed.source_path = file_path
            parsed.detected_language = parsed.detected_language or detection.detected_language
            return parsed

        parser_name = detection.file_type.category.value
        parser = self.registry.get_parser(parser_name)
        if not parser:
            raise ValueError(f"No parser registered for: {parser_name}")

        path = Path(file_path)
        content = self._read_file_safe(path) if path.exists() else ""

        parsed = parser.parse(content, detection.file_type, source_path=file_path)
        parsed.source_path = file_path
        parsed.detected_language = parsed.detected_language or detection.detected_language
        return parsed

    def validate_file(self, parsed_file: ParsedGameFile) -> ValidationResult:
        """Validate a parsed file using its registered validator."""
        validator_name = parsed_file.file_type.category.value
        validator = self.registry.get_validator(validator_name)
        if not validator:
            return ValidationResult(is_valid=True)
        return validator.validate(parsed_file)

    def extract_translation_units(
        self,
        parsed_file: ParsedGameFile,
        src_lang: Optional[str] = None,
        dst_lang: Optional[str] = None,
    ) -> List[TranslationUnit]:
        """Extract translation units from a parsed file for translation.

        Uses the GameAdapter when available; falls back to built-in logic.
        """
        if self.adapter:
            cat = parsed_file.file_type.category
            if cat in (
                FileCategory.STELLARIS_LOCALISATION,
                FileCategory.GENERIC_PLAIN_TEXT,
                FileCategory.GENERIC_JSON,
                FileCategory.GENERIC_YAML,
            ):
                return self.adapter.extract_units(parsed_file, src_lang, dst_lang)

        units = []
        for entry in parsed_file.translatable_entries:
            if entry.value:
                units.append(TranslationUnit(
                    source=entry.value,
                    key=entry.key,
                    context=entry.key,
                    file_path=parsed_file.source_path,
                    line_number=entry.line_number,
                    id=f"unit_{entry.id}" if entry.id else "",
                    entry_id=entry.id,
                    file_id=parsed_file.id,
                    src_lang=src_lang or parsed_file.detected_language or "",
                    dst_lang=dst_lang or "",
                ))
        return units

    def apply_translations(
        self,
        parsed_file: ParsedGameFile,
        translated_units: List[TranslationUnit],
    ) -> ParsedGameFile:
        """Apply translated units back to the parsed file entries.

        Matches by entry_id first, then falls back to key matching.
        Missing translations are left as-is (keep source).
        """
        # Build translation map: entry_id -> translated_text, key -> translated_text
        translation_map = {}
        for unit in translated_units:
            if unit.entry_id:
                translation_map[unit.entry_id] = unit.target
            elif unit.key:
                translation_map[unit.key] = unit.target

        for entry in parsed_file.entries:
            if entry.is_translatable:
                translated = None
                if entry.id and entry.id in translation_map:
                    translated = translation_map[entry.id]
                elif entry.key and entry.key in translation_map:
                    translated = translation_map[entry.key]
                if translated is not None:
                    entry.translated = translated
                # else: keep source (no translation found)

        # Update target language if available
        if translated_units and translated_units[0].dst_lang:
            parsed_file.metadata['target_language'] = translated_units[0].dst_lang

        return parsed_file

    def serialize_file(
        self,
        parsed_file: ParsedGameFile,
        output_path: Optional[str] = None,
        translations: Optional[List[TranslationUnit]] = None,
    ) -> SerializedFile:
        """Serialize a parsed file back to a SerializedFile.

        When *translations* are provided and a GameAdapter is available,
        the adapter handles both translation application and serialization
        in one step. Otherwise falls back to registry-based dispatch.
        """
        # Use adapter for combined apply+serialize when translations given
        if self.adapter and translations is not None:
            cat = parsed_file.file_type.category
            if cat in (
                FileCategory.STELLARIS_LOCALISATION,
                FileCategory.GENERIC_PLAIN_TEXT,
                FileCategory.GENERIC_JSON,
                FileCategory.GENERIC_YAML,
            ):
                result = self.adapter.serialize(parsed_file, translations)
                result.source_path = parsed_file.source_path
                result.source_file_id = parsed_file.id
                if output_path:
                    result.output_path = output_path
                return result

        serializer_name = parsed_file.file_type.category.value
        serializer = self.registry.get_serializer(serializer_name)
        if not serializer:
            raise ValueError(f"No serializer registered for: {serializer_name}")

        target_language = parsed_file.metadata.get('target_language', '')

        # Try passing target_language if serializer supports it
        try:
            result = serializer.serialize(parsed_file, target_language=target_language)
        except TypeError:
            # Serializer doesn't accept target_language parameter (e.g. PlainTextSerializer)
            result = serializer.serialize(parsed_file)

        result.source_path = parsed_file.source_path
        result.source_file_id = parsed_file.id
        if output_path:
            result.output_path = output_path
        return result

    # --- Private helpers ---

    @staticmethod
    def _read_file_safe(path: Path) -> str:
        """Read file with encoding detection. Tries utf-8-sig, then utf-8."""
        for enc in ('utf-8-sig', 'utf-8'):
            try:
                return path.read_text(encoding=enc)
            except (UnicodeDecodeError, LookupError):
                continue
        # Fallback with error replacement
        try:
            return path.read_text(encoding='utf-8', errors='replace')
        except Exception:
            return ""
