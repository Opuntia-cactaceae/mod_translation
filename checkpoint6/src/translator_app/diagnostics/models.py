from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional


class DiagnosticLevel(Enum):
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


# LogLevel mirrors the same levels as DiagnosticLevel but is a separate enum
# so the two concepts (technical logs vs. user-facing diagnostics) can evolve
# independently.
class LogLevel(Enum):
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


@dataclass
class LogEntry:
    """A single structured log entry.

    Stores technical log information with optional job/file/unit correlation.
    """
    timestamp: datetime
    level: LogLevel
    module: str
    message: str
    context: Optional[Dict[str, Any]] = None
    job_id: Optional[str] = None
    file_id: Optional[str] = None
    unit_id: Optional[str] = None


@dataclass
class Diagnostic:
    """A user-facing diagnostic entry (error, warning, info).

    Extended with ``user_message``, ``entity_type`` and ``entity_id`` for
    better integration with the DiagnosticsRepository and UI.

    Backward-compatible: existing callers that only set ``entry_id`` /
    ``file_path`` will continue to work.
    """
    level: DiagnosticLevel
    message: str
    code: str = ""
    file_path: Optional[str] = None
    line: Optional[int] = None
    entry_id: str = ""
    line_no: Optional[int] = None
    details: Optional[str] = None
    # --- New fields for TZ #27 ---
    user_message: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None


@dataclass
class ValidationResult:
    is_valid: bool
    diagnostics: list = field(default_factory=list)

    def add_diagnostic(self, diagnostic: Diagnostic) -> None:
        self.diagnostics.append(diagnostic)

    @property
    def errors(self) -> list:
        return [d for d in self.diagnostics if d.level in (DiagnosticLevel.ERROR, DiagnosticLevel.CRITICAL)]

    @property
    def warnings(self) -> list:
        return [d for d in self.diagnostics if d.level == DiagnosticLevel.WARNING]
