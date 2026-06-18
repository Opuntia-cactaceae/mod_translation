from typing import Protocol

from translator_app.file_processing.models.parsed_file import ParsedGameFile
from translator_app.diagnostics.models import ValidationResult


class FileValidator(Protocol):
    """Validates a parsed file for correctness."""

    def validate(self, parsed_file: ParsedGameFile) -> ValidationResult:
        """Validate parsed file.

        Args:
            parsed_file: The parsed game file to validate.

        Returns:
            ValidationResult with diagnostics.
        """
        ...
