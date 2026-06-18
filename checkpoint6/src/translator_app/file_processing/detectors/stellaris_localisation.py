import os
import re

from translator_app.file_processing.detectors.base import FileDetector
from translator_app.file_processing.models.file_type import FileType
from translator_app.file_processing.models.parsed_file import FileDetectionResult
from translator_app.diagnostics.models import Diagnostic, DiagnosticLevel


class StellarisLocalisationDetector:
    """Detects Stellaris localisation files by extension and content.

    Recognises .yml/.yaml files with l_<language>: header.
    If the header is found but path does not contain 'localisation'/'localization',
    a warning diagnostic is added.
    """

    LANGUAGE_HEADER_RE = re.compile(r'^\s*l_([a-z]+(?:_[a-z]+)?)\s*:\s*$')

    def detect(self, file_path: str, content: str = "") -> FileDetectionResult:
        diagnostics: list = []
        ext = os.path.splitext(file_path)[1].lower()
        if ext not in FileType.STELLARIS_LOCALISATION.extensions:
            return FileDetectionResult(
                file_type=FileType.UNKNOWN,
                confidence=0.0,
                matched_by="",
                path=file_path,
                supported=False,
                diagnostics=[Diagnostic(
                    level=DiagnosticLevel.INFO,
                    message=f"Extension '{ext}' does not match stellaris_localisation",
                    code="UNSUPPORTED_FILE_TYPE",
                )],
            )

        confidence = 0.7
        matched_by = "extension"
        detected_language = ""

        if content:
            # Try to detect binary/unreadable content
            if self._is_binary(content):
                return FileDetectionResult(
                    file_type=FileType.UNKNOWN,
                    confidence=0.0,
                    matched_by="",
                    path=file_path,
                    supported=False,
                    diagnostics=[Diagnostic(
                        level=DiagnosticLevel.ERROR,
                        message="Binary file is not supported",
                        code="BINARY_FILE_NOT_SUPPORTED",
                    )],
                )

            for line in content.splitlines():
                match = self.LANGUAGE_HEADER_RE.match(line)
                if match:
                    detected_language = match.group(1)
                    confidence = 1.0
                    matched_by = "extension + language_header"
                    break

        if detected_language:
            has_localisation_path = "localisation" in file_path.lower() or "localization" in file_path.lower()
            if not has_localisation_path:
                diagnostics.append(Diagnostic(
                    level=DiagnosticLevel.WARNING,
                    message="File contains Stellaris language header, but path does not include localisation directory",
                    code="LANGUAGE_HEADER_FOUND_BUT_PATH_NOT_LOCALISATION",
                ))

        return FileDetectionResult(
            file_type=FileType.STELLARIS_LOCALISATION,
            confidence=confidence,
            matched_by=matched_by,
            path=file_path,
            supported=True,
            detected_language=detected_language,
            parser_name="stellaris_localisation",
            serializer_name="stellaris_localisation",
            validator_name="stellaris_localisation",
            diagnostics=diagnostics,
        )

    def _is_binary(self, content: str) -> bool:
        """Check if content appears to be binary."""
        if not content:
            return False
        null_count = content.count('\0')
        total = len(content)
        if total == 0:
            return False
        return (null_count / total) > 0.3
