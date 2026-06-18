from typing import Protocol

from translator_app.file_processing.models.parsed_file import ParsedGameFile, SerializedFile


class FileSerializer(Protocol):
    """Serializes a ParsedGameFile back to a string representation."""

    def serialize(self, parsed_file: ParsedGameFile) -> SerializedFile:
        """Serialize parsed file back to string.

        Args:
            parsed_file: The parsed game file to serialize.

        Returns:
            SerializedFile with the serialized content.
        """
        ...
