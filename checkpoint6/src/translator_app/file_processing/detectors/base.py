from typing import Protocol

from translator_app.file_processing.models.file_type import FileType
from translator_app.file_processing.models.parsed_file import FileDetectionResult


class FileDetector(Protocol):
    """Detects file type from a file path and/or content."""

    def detect(self, file_path: str, content: str = "") -> FileDetectionResult:
        """Detect file type.

        Args:
            file_path: Path to the file.
            content: Optional file content for content-based detection.

        Returns:
            FileDetectionResult with the detected file type and confidence.
        """
        ...
