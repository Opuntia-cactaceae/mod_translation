from translator_app.file_processing.serializers.base import FileSerializer
from translator_app.file_processing.models.parsed_file import ParsedGameFile, SerializedFile
from translator_app.file_processing.models.entries import FileEntry
from translator_app.file_processing.models.file_type import EntryType
from translator_app.diagnostics.models import Diagnostic, DiagnosticLevel


class StellarisLocalisationSerializer:
    """Serializes Stellaris localisation files back to .yml format.

    Preserves language header, entry order, comments, empty lines, raw_unknown lines.
    Replaces only the value of translation_entry entries.
    Supports target language header replacement.
    Handles missing/empty translations with keep_source + warning.

    Language header policy:
    - If ``parsed_file.entries`` already contains a LANGUAGE_HEADER entry,
      ``parsed_file.header`` is NOT written separately (avoids duplicate).
    - If entries do NOT contain a LANGUAGE_HEADER entry, ``parsed_file.header``
      is used as fallback.
    """

    def serialize(self, parsed_file: ParsedGameFile, target_language: str = "") -> SerializedFile:
        lines: list[str] = []
        diagnostics: list = []
        newline = parsed_file.newline_style if parsed_file.newline_style else '\n'

        # Check whether entries already contain a language header entry
        has_header_entry = any(
            e.entry_type == EntryType.LANGUAGE_HEADER.value
            for e in parsed_file.entries
        )

        # Build language header — only write if entries don't already have one
        if not has_header_entry and parsed_file.header:
            if target_language and parsed_file.detected_language:
                new_header = parsed_file.header.replace(
                    f"l_{parsed_file.detected_language}:",
                    f"l_{target_language}:",
                    1,
                )
                if new_header == parsed_file.header:
                    diagnostics.append(Diagnostic(
                        level=DiagnosticLevel.WARNING,
                        message=f"Unknown target language header mapping for '{target_language}', keeping original",
                        code="UNKNOWN_TARGET_LANGUAGE_HEADER",
                    ))
                lines.append(new_header.rstrip('\n\r'))
            else:
                lines.append(parsed_file.header.rstrip('\n\r'))

        for entry in parsed_file.entries:
            if not entry.is_translatable:
                # Preserve non-translatable entries as-is
                raw_line = entry.raw.rstrip('\n\r')
                # If this is a LANGUAGE_HEADER entry and target_language is specified,
                # replace the language in the header text
                if (
                    target_language
                    and parsed_file.detected_language
                    and entry.entry_type == EntryType.LANGUAGE_HEADER.value
                ):
                    new_raw = raw_line.replace(
                        f"l_{parsed_file.detected_language}:",
                        f"l_{target_language}:",
                        1,
                    )
                    if new_raw != raw_line:
                        raw_line = new_raw
                    else:
                        diagnostics.append(Diagnostic(
                            level=DiagnosticLevel.WARNING,
                            message=f"Unknown target language header mapping for '{target_language}' in entry, keeping original",
                            code="UNKNOWN_TARGET_LANGUAGE_HEADER",
                        ))
                lines.append(raw_line)
            elif entry.translated is not None:
                translated = self._escape_value(entry.translated)
                if not entry.translated.strip():
                    diagnostics.append(Diagnostic(
                        level=DiagnosticLevel.WARNING,
                        message=f"Empty translation for key '{entry.key}' at line {entry.line_number}, keeping source",
                        code="EMPTY_TRANSLATION",
                        line_no=entry.line_number,
                        entry_id=entry.id,
                    ))
                    lines.append(f'{entry.indent}{entry.key}:{entry.version or "0"} "{self._escape_value(entry.value)}"')
                else:
                    lines.append(f'{entry.indent}{entry.key}:{entry.version or "0"} "{translated}"')
            else:
                # Missing translation: keep source + warning
                diagnostics.append(Diagnostic(
                    level=DiagnosticLevel.WARNING,
                    message=f"Translation is missing for key '{entry.key}' at line {entry.line_number}, source value kept",
                    code="MISSING_TRANSLATION",
                    line_no=entry.line_number,
                    entry_id=entry.id,
                ))
                lines.append(f'{entry.indent}{entry.key}:{entry.version or "0"} "{self._escape_value(entry.value)}"')

        content = newline.join(lines)
        if parsed_file.raw_content.endswith("\n"):
            content += newline

        return SerializedFile(
            content=content,
            encoding=parsed_file.encoding or "utf-8",
            source_path=parsed_file.source_path,
            newline_style=newline,
            diagnostics=diagnostics,
        )

    def _escape_value(self, value: str) -> str:
        """Escape special characters for Stellaris .yml output.

        Escapes backslash, double-quote, newline and tab so that the
        value can be safely placed inside a double-quoted string.
        """
        value = value.replace('\\', '\\\\')
        value = value.replace('\n', '\\n')
        value = value.replace('\t', '\\t')
        value = value.replace('"', '\\"')
        return value
