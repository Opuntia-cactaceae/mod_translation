from dataclasses import dataclass, field
from typing import Optional


@dataclass
class TranslationUnit:
    source: str = ""
    key: str = ""
    context: str = ""
    file_path: str = ""
    line_number: int = 0
    target: str = ""
    metadata: dict = field(default_factory=dict)
    # Extended fields
    id: str = ""
    file_id: str = ""
    entry_id: str = ""
    src_lang: str = ""
    dst_lang: str = ""
    protection_state: str = "unprotected"
    status: str = "pending"
    from_cache: bool = False
    diagnostics: list = field(default_factory=list)
    error_message: str = ""

    @property
    def source_text(self) -> str:
        return self.source

    @source_text.setter
    def source_text(self, value: str) -> None:
        self.source = value

    @property
    def translated_text(self) -> str:
        return self.target

    @translated_text.setter
    def translated_text(self, value: str) -> None:
        self.target = value
