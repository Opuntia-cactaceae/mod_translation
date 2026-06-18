from dataclasses import dataclass, field
from typing import Optional

from translator_app.file_processing.models.file_type import FileType
from translator_app.file_processing.models.entries import FileEntry
from translator_app.diagnostics.models import Diagnostic, DiagnosticLevel


@dataclass
class ParsedGameFile:
    file_type: FileType
    entries: list = field(default_factory=list)
    header: Optional[str] = None
    raw_content: str = ""
    metadata: dict = field(default_factory=dict)
    # Extended fields
    id: str = ""
    source_path: str = ""
    detected_language: str = ""
    encoding: str = "utf-8"
    newline_style: str = "\n"
    diagnostics: list = field(default_factory=list)

    @property
    def translatable_entries(self) -> list:
        return [e for e in self.entries if e.is_translatable]


@dataclass
class SerializedFile:
    content: str = ""
    encoding: str = "utf-8"
    # Extended fields
    source_file_id: str = ""
    source_path: str = ""
    output_path: str = ""
    newline_style: str = "\n"
    diagnostics: list = field(default_factory=list)

    @property
    def output_text(self) -> str:
        return self.content

    @output_text.setter
    def output_text(self, value: str) -> None:
        self.content = value


@dataclass
class FileDetectionResult:
    file_type: FileType
    confidence: float = 0.0
    matched_by: str = ""
    # Extended fields
    path: str = ""
    supported: bool = True
    detected_language: str = ""
    parser_name: str = ""
    serializer_name: str = ""
    validator_name: str = ""
    diagnostics: list = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    @property
    def language(self) -> str:
        return self.detected_language

    @language.setter
    def language(self, value: str) -> None:
        self.detected_language = value

    @property
    def warnings(self) -> list:
        return [d for d in self.diagnostics if isinstance(d, Diagnostic) and d.level in (DiagnosticLevel.WARNING, DiagnosticLevel.INFO)]

    @property
    def errors(self) -> list:
        return [d for d in self.diagnostics if isinstance(d, Diagnostic) and d.level in (DiagnosticLevel.ERROR, DiagnosticLevel.CRITICAL)]
