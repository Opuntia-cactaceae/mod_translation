import re
from typing import Optional, List

from translator_app.file_processing.parsers.base import FileParser
from translator_app.file_processing.models.file_type import FileType, EntryType
from translator_app.file_processing.models.parsed_file import ParsedGameFile
from translator_app.file_processing.models.entries import FileEntry
from translator_app.diagnostics.models import Diagnostic, DiagnosticLevel


class StellarisLocalisationParser:
    """Parses Stellaris localisation (.yml) files.

    Format:
        l_english:
         KEY:0 "Value"
         # comment

    Handles:
    - language headers (l_<lang>:)
    - translation entries with indent, key, version, value, trailing comments
    - comments
    - empty lines
    - raw_unknown lines with diagnostics
    - duplicate key detection
    - multiple language header detection
    - missing language header detection
    - newline_style and encoding detection
    """

    LANGUAGE_HEADER_RE = re.compile(r'^\s*l_([a-z]+(?:_[a-z]+)?)\s*:\s*$')
    TRANSLATION_ENTRY_RE = re.compile(
        r'^(?P<indent>\s*)(?P<key>[^:]+?)\s*:\s*(?P<version>\d+)?\s*"(?P<value>[^"]*)"(?P<trailing>\s*#.*)?\s*$'
    )

    @staticmethod
    def unescape_yaml_value(value: str) -> str:
        """Unescape YAML double-quoted string escape sequences.

        Handles: \\\\, \\", \\n, \\t, \\uXXXX.
        Any unrecognised escape sequence is kept as-is.
        """
        result = []
        i = 0
        while i < len(value):
            if value[i] == '\\' and i + 1 < len(value):
                nxt = value[i + 1]
                if nxt == '\\':
                    result.append('\\')
                    i += 2
                elif nxt == '"':
                    result.append('"')
                    i += 2
                elif nxt == 'n':
                    result.append('\n')
                    i += 2
                elif nxt == 't':
                    result.append('\t')
                    i += 2
                elif nxt == 'u' and i + 5 < len(value):
                    try:
                        result.append(chr(int(value[i + 2:i + 6], 16)))
                        i += 6
                    except (ValueError, OverflowError):
                        result.append(value[i])
                        i += 1
                else:
                    result.append(value[i])
                    i += 1
            else:
                result.append(value[i])
                i += 1
        return ''.join(result)

    @staticmethod
    def detect_newline_style(content: str) -> str:
        """Detect newline style from content."""
        if '\r\n' in content:
            return '\r\n'
        return '\n'

    @staticmethod
    def read_with_encoding(file_path: str) -> tuple:
        """Read file trying utf-8-sig first, then utf-8.
        Returns (content, encoding, diagnostics).
        """
        diagnostics: list = []
        for enc in ('utf-8-sig', 'utf-8'):
            try:
                with open(file_path, 'r', encoding=enc) as f:
                    content = f.read()
                return content, enc, diagnostics
            except UnicodeDecodeError:
                continue
        # Final attempt with replacement
        try:
            with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
            diagnostics.append(Diagnostic(
                level=DiagnosticLevel.WARNING,
                message="File encoding could not be determined, used utf-8 with replacement",
                code="FILE_ENCODING_ERROR",
            ))
            return content, 'utf-8', diagnostics
        except Exception as e:
            diagnostics.append(Diagnostic(
                level=DiagnosticLevel.ERROR,
                message=f"Cannot read file: {e}",
                code="FILE_NOT_READABLE",
            ))
            return '', 'utf-8', diagnostics

    def parse(self, content: str, file_type: FileType, source_path: str = "") -> ParsedGameFile:
        lines = content.splitlines(keepends=True)
        entries: List[FileEntry] = []
        header: Optional[str] = None
        header_language: str = ""
        diagnostics: List[Diagnostic] = []
        seen_keys: dict = {}
        header_count = 0
        newline_style = self.detect_newline_style(content)

        for i, line in enumerate(lines, start=1):
            stripped = line.strip()
            raw_line = line

            # Detect newline
            line_rstrip = line.rstrip('\n\r')

            # Language header
            header_match = self.LANGUAGE_HEADER_RE.match(stripped)
            if header_match:
                header_count += 1
                if header_count == 1:
                    header = stripped
                    header_language = header_match.group(1)
                else:
                    diagnostics.append(Diagnostic(
                        level=DiagnosticLevel.WARNING,
                        message=f"Multiple language headers found at line {i}",
                        code="MULTIPLE_LANGUAGE_HEADERS",
                        line_no=i,
                    ))
                entries.append(FileEntry(
                    key="",
                    value="",
                    line_number=i,
                    raw=raw_line,
                    is_translatable=False,
                    id=f"entry_{i}",
                    entry_type=EntryType.LANGUAGE_HEADER.value,
                ))
                continue

            # Translation entry: KEY:0 "value" [# comment]
            entry_match = self.TRANSLATION_ENTRY_RE.match(raw_line)
            if entry_match:
                key = entry_match.group("key")
                version = entry_match.group("version")
                value = self.unescape_yaml_value(entry_match.group("value"))
                indent = entry_match.group("indent")
                trailing = entry_match.group("trailing")
                trailing_comment = trailing.lstrip().lstrip('#').strip() if trailing else ""

                # Detect duplicate keys
                if key in seen_keys:
                    diagnostics.append(Diagnostic(
                        level=DiagnosticLevel.WARNING,
                        message=f"Duplicate localisation key '{key}' at line {i}",
                        code="DUPLICATE_LOCALISATION_KEY",
                        line_no=i,
                    ))
                else:
                    seen_keys[key] = i

                entries.append(FileEntry(
                    key=key,
                    value=value,
                    line_number=i,
                    raw=raw_line,
                    is_translatable=True,
                    id=f"entry_{i}",
                    entry_type=EntryType.TRANSLATION_ENTRY.value,
                    indent=indent,
                    version=version,
                    quote_style='"',
                    trailing_text=trailing_comment,
                    comment=trailing_comment if trailing_comment else None,
                ))
                continue

            # Comment
            if stripped.startswith("#"):
                entries.append(FileEntry(
                    key="",
                    value="",
                    line_number=i,
                    raw=raw_line,
                    is_translatable=False,
                    comment=stripped,
                    id=f"entry_{i}",
                    entry_type=EntryType.COMMENT.value,
                ))
                continue

            # Empty line
            if not stripped:
                entries.append(FileEntry(
                    key="",
                    value="",
                    line_number=i,
                    raw=raw_line,
                    is_translatable=False,
                    id=f"entry_{i}",
                    entry_type=EntryType.EMPTY.value,
                ))
                continue

            # Raw unknown (unparseable line - preserve as-is)
            diagnostics.append(Diagnostic(
                level=DiagnosticLevel.WARNING,
                message=f"Unknown line format at line {i}: {line_rstrip[:80]}",
                code="UNKNOWN_LINE_FORMAT",
                line_no=i,
            ))
            entries.append(FileEntry(
                key="",
                value="",
                line_number=i,
                raw=raw_line,
                is_translatable=False,
                id=f"entry_{i}",
                entry_type=EntryType.RAW_UNKNOWN.value,
                diagnostics=[Diagnostic(
                    level=DiagnosticLevel.WARNING,
                    message=f"Unknown line format at line {i}",
                    code="UNKNOWN_LINE_FORMAT",
                    line_no=i,
                )],
            ))

        # Post-parse diagnostics
        if header_count == 0:
            diagnostics.append(Diagnostic(
                level=DiagnosticLevel.ERROR,
                message="Stellaris localisation language header was not found",
                code="LANGUAGE_HEADER_NOT_FOUND",
            ))

        return ParsedGameFile(
            file_type=file_type,
            entries=entries,
            header=header,
            raw_content=content,
            source_path=source_path,
            detected_language=header_language,
            encoding="utf-8",
            newline_style=newline_style,
            diagnostics=diagnostics,
        )
