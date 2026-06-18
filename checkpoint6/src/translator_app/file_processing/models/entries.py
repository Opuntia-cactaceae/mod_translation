from dataclasses import dataclass, field
from typing import Optional


@dataclass
class FileEntry:
    key: str
    value: str
    comment: Optional[str] = None
    line_number: int = 0
    raw: str = ""
    translated: Optional[str] = None
    is_translatable: bool = True
    # Extended fields
    id: str = ""
    entry_type: Optional[str] = None
    indent: str = ""
    version: Optional[str] = None
    quote_style: str = '"'
    leading_text: str = ""
    trailing_text: str = ""
    diagnostics: list = field(default_factory=list)

    @property
    def line_no(self) -> int:
        return self.line_number

    @line_no.setter
    def line_no(self, value: int) -> None:
        self.line_number = value

    @property
    def raw_line(self) -> str:
        return self.raw

    @raw_line.setter
    def raw_line(self, value: str) -> None:
        self.raw = value
