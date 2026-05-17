import os

from translator_app.file_processing.detectors.base import FileDetector
from translator_app.file_processing.models.file_type import FileType
from translator_app.file_processing.models.parsed_file import FileDetectionResult
from translator_app.diagnostics.models import Diagnostic, DiagnosticLevel


class PlainTextDetector:
    """Detects plain text files by .txt extension.

    Falls back to text-like content detection with lower confidence.
    """

    def detect(self, file_path: str, content: str = "") -> FileDetectionResult:
        ext = os.path.splitext(file_path)[1].lower()
        if ext in FileType.PLAIN_TEXT.extensions:
            return FileDetectionResult(
                file_type=FileType.PLAIN_TEXT,
                confidence=1.0,
                matched_by="extension",
                path=file_path,
                supported=True,
                parser_name="plain_text",
                serializer_name="plain_text",
                validator_name="plain_text",
            )

        # Content-based fallback for text-like content
        if content and self._looks_like_text(content):
            return FileDetectionResult(
                file_type=FileType.PLAIN_TEXT,
                confidence=0.5,
                matched_by="content_heuristic",
                path=file_path,
                supported=True,
                parser_name="plain_text",
                serializer_name="plain_text",
                validator_name="plain_text",
            )

        return FileDetectionResult(
            file_type=FileType.UNKNOWN,
            confidence=0.0,
            matched_by="",
            path=file_path,
            supported=False,
        )

    def _looks_like_text(self, content: str) -> bool:
        """Heuristic check if content looks like readable text."""
        if not content:
            return False
        null_count = content.count('\0')
        total = len(content)
        if total == 0:
            return False
        if (null_count / total) > 0.3:
            return False
        return True
