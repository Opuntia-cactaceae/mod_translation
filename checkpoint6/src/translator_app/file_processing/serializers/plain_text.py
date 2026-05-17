from translator_app.file_processing.serializers.base import FileSerializer
from translator_app.file_processing.models.parsed_file import ParsedGameFile, SerializedFile
from translator_app.diagnostics.models import Diagnostic, DiagnosticLevel


class PlainTextSerializer:
    """Serializes plain text: joins translated values back."""

    def serialize(self, parsed_file: ParsedGameFile) -> SerializedFile:
        lines = []
        diagnostics: list = []
        newline = parsed_file.newline_style if parsed_file.newline_style else '\n'

        for entry in parsed_file.entries:
            if entry.is_translatable and entry.translated is not None:
                lines.append(entry.translated)
            elif entry.is_translatable:
                lines.append(entry.value)
            else:
                # Non-translatable entries preserve their raw content
                lines.append(entry.raw.rstrip('\n\r'))

        content = newline.join(lines)
        if not content.endswith("\n") and parsed_file.raw_content.endswith("\n"):
            content += newline

        return SerializedFile(
            content=content,
            encoding=parsed_file.encoding or "utf-8",
            source_path=parsed_file.source_path,
            newline_style=newline,
            diagnostics=diagnostics,
        )
