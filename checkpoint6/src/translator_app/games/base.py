"""GameAdapter interface — abstract layer between translation pipeline and game-specific code."""

from typing import List, Optional

from translator_app.file_processing.models.parsed_file import (
    ParsedGameFile,
    SerializedFile,
    FileDetectionResult,
)
from translator_app.file_processing.models.translation_unit import TranslationUnit


class GameAdapter:
    """Interface for game-specific file handling.

    Each game (Stellaris, HOI4, etc.) implements this interface to
    isolate game-specific parsing, unit extraction, and serialization
    from the core translation pipeline.
    """

    def detect_files(self, path: str) -> List[str]:
        """Discover translatable files in *path* (file or directory).

        Returns a list of absolute file paths.
        """
        raise NotImplementedError

    def detect_file(self, path: str) -> FileDetectionResult:
        """Detect whether a single file is a translatable game file.

        Returns a FileDetectionResult with type/confidence.
        """
        raise NotImplementedError

    def parse_file(self, path: str) -> ParsedGameFile:
        """Parse a game file into a ParsedGameFile."""
        raise NotImplementedError

    def extract_units(
        self,
        parsed: ParsedGameFile,
        src_lang: Optional[str] = None,
        dst_lang: Optional[str] = None,
    ) -> List[TranslationUnit]:
        """Extract translation units from a parsed game file."""
        raise NotImplementedError

    def serialize(
        self,
        parsed: ParsedGameFile,
        translations: List[TranslationUnit],
    ) -> SerializedFile:
        """Apply translated units and serialize back to game format."""
        raise NotImplementedError
