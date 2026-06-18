from translator_app.file_processing.validators.base import FileValidator
from translator_app.file_processing.models.parsed_file import ParsedGameFile
from translator_app.diagnostics.models import ValidationResult, Diagnostic, DiagnosticLevel


class PlainTextValidator:
    """Validates plain text files."""

    def validate(self, parsed_file: ParsedGameFile) -> ValidationResult:
        result = ValidationResult(is_valid=True)

        translatable = [e for e in parsed_file.entries if e.is_translatable]
        if not translatable:
            result.add_diagnostic(Diagnostic(
                level=DiagnosticLevel.WARNING,
                message="No translatable entries found",
                code="NO_TRANSLATABLE_ENTRIES",
            ))

        return result
