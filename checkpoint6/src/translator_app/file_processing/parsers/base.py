from typing import Protocol

from translator_app.file_processing.models.parsed_file import ParsedGameFile
from translator_app.file_processing.models.file_type import FileType


class FileParser(Protocol):
    """Parses a file's content into a structured representation."""

    def parse(self, content: str, file_type: FileType) -> ParsedGameFile:
        """Parse file content.

        Args:
            content: Raw file content as string.
            file_type: The detected file type.

        Returns:
            ParsedGameFile with extracted entries.
        """
        ...
