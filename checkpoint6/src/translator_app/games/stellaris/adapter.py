"""StellarisAdapter — wraps existing Stellaris-specific code behind the GameAdapter interface."""

import os
from typing import List, Optional

from translator_app.games.base import GameAdapter
from translator_app.file_processing.detectors.stellaris_localisation import (
    StellarisLocalisationDetector,
)
from translator_app.file_processing.parsers.stellaris_localisation import (
    StellarisLocalisationParser,
)
from translator_app.file_processing.serializers.stellaris_localisation import (
    StellarisLocalisationSerializer,
)
from translator_app.file_processing.models.file_type import FileType, FileCategory
from translator_app.file_processing.models.parsed_file import (
    ParsedGameFile,
    SerializedFile,
    FileDetectionResult,
)
from translator_app.file_processing.models.translation_unit import TranslationUnit


class StellarisAdapter(GameAdapter):
    """Adapter that wraps existing Stellaris detection/parsing/serialization
    code behind the GameAdapter interface."""

    def __init__(self):
        self.detector = StellarisLocalisationDetector()
        self.parser = StellarisLocalisationParser()
        self.serializer = StellarisLocalisationSerializer()

    # ------------------------------------------------------------------
    # File discovery
    # ------------------------------------------------------------------

    def detect_files(self, path: str) -> List[str]:
        """Recursively find Stellaris localisation files under *path*.

        Returns absolute paths to .yml/.yaml files that are detected as
        stellaris_localisation and have a non-empty language header.
        """
        found: List[str] = []
        if not os.path.isdir(path):
            return found

        for dirpath, _dirnames, filenames in os.walk(path):
            for filename in filenames:
                if not filename.lower().endswith(('.yml', '.yaml')):
                    continue
                full_path = os.path.join(dirpath, filename)
                try:
                    detection = self.detector.detect(full_path)
                    if (detection.file_type.category == FileCategory.STELLARIS_LOCALISATION
                            and detection.detected_language):
                        found.append(full_path)
                except Exception:
                    continue
        return found

    # ------------------------------------------------------------------
    # Detection
    # ------------------------------------------------------------------

    def detect_file(self, path: str) -> FileDetectionResult:
        """Detect whether *path* is a Stellaris localisation file."""
        return self.detector.detect(path)

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------

    def parse_file(self, path: str) -> ParsedGameFile:
        """Parse a Stellaris localisation file.

        Reads the file, runs detection to determine file type, and parses
        the content into a ParsedGameFile.
        """
        detection = self.detector.detect(path)
        content, _encoding, _diags = StellarisLocalisationParser.read_with_encoding(path)
        parsed = self.parser.parse(content, detection.file_type, source_path=path)
        parsed.source_path = path
        parsed.detected_language = parsed.detected_language or detection.detected_language
        return parsed

    # ------------------------------------------------------------------
    # Unit extraction
    # ------------------------------------------------------------------

    def extract_units(
        self,
        parsed: ParsedGameFile,
        src_lang: Optional[str] = None,
        dst_lang: Optional[str] = None,
    ) -> List[TranslationUnit]:
        """Extract translatable entries as TranslationUnit objects."""
        units: List[TranslationUnit] = []
        for entry in parsed.translatable_entries:
            if entry.value:
                units.append(TranslationUnit(
                    source=entry.value,
                    key=entry.key,
                    context=entry.key,
                    file_path=parsed.source_path,
                    line_number=entry.line_number,
                    id=f"unit_{entry.id}" if entry.id else "",
                    entry_id=entry.id,
                    file_id=parsed.id,
                    src_lang=src_lang or parsed.detected_language or "",
                    dst_lang=dst_lang or "",
                ))
        return units

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    def serialize(
        self,
        parsed: ParsedGameFile,
        translations: List[TranslationUnit],
    ) -> SerializedFile:
        """Apply translations and serialize back to Stellaris format.

        Matches units by entry_id first, then falls back to key matching.
        Units without a match keep their original source value.
        """
        translation_map = {}
        for unit in translations:
            if unit.entry_id:
                translation_map[unit.entry_id] = unit.target
            elif unit.key:
                translation_map[unit.key] = unit.target

        for entry in parsed.entries:
            if entry.is_translatable:
                translated = None
                if entry.id and entry.id in translation_map:
                    translated = translation_map[entry.id]
                elif entry.key and entry.key in translation_map:
                    translated = translation_map[entry.key]
                if translated is not None:
                    entry.translated = translated

        target_language = ""
        if translations and translations[0].dst_lang:
            target_language = translations[0].dst_lang
            parsed.metadata['target_language'] = target_language

        return self.serializer.serialize(parsed, target_language=target_language)
