from translator_app.file_processing.parsers.base import FileParser
from translator_app.file_processing.models.file_type import FileType, EntryType
from translator_app.file_processing.models.parsed_file import ParsedGameFile
from translator_app.file_processing.models.entries import FileEntry


class PlainTextParser:
    """Parses plain text files: each non-empty line is a translatable entry."""

    @staticmethod
    def detect_newline_style(content: str) -> str:
        if '\r\n' in content:
            return '\r\n'
        return '\n'

    def parse(self, content: str, file_type: FileType, source_path: str = "") -> ParsedGameFile:
        lines = content.splitlines(keepends=True)
        newline_style = self.detect_newline_style(content)
        entries = []
        for i, line in enumerate(lines, start=1):
            stripped = line.rstrip('\n\r')
            if stripped:
                entries.append(FileEntry(
                    key=f"line_{i}",
                    value=stripped,
                    line_number=i,
                    raw=line,
                    is_translatable=True,
                    id=f"entry_{i}",
                    entry_type=EntryType.PLAIN_TEXT_LINE.value,
                ))

        return ParsedGameFile(
            file_type=file_type,
            entries=entries,
            raw_content=content,
            source_path=source_path,
            newline_style=newline_style,
        )
