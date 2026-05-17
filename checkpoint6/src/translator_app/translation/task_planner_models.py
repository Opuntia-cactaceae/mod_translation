"""22. Translation Task Planner Module — data models.

Dataclasses for TranslationTask, TaskPlan, and PlannerDiagnostic.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, List, Optional


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    CACHED = "cached"


class DiagnosticLevel(str, Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


# ---------------------------------------------------------------------------
# Error / warning codes (spec section "Ошибки / Warnings")
# ---------------------------------------------------------------------------

# Errors
FILE_PARSE_FAILED = "FILE_PARSE_FAILED"
NO_TRANSLATABLE_UNITS = "NO_TRANSLATABLE_UNITS"
INVALID_FILE_TYPE = "INVALID_FILE_TYPE"
CACHE_ERROR = "CACHE_ERROR"
BATCH_BUILD_FAILED = "BATCH_BUILD_FAILED"

# Warnings
FILE_SKIPPED = "FILE_SKIPPED"
EMPTY_FILE = "EMPTY_FILE"
ALL_UNITS_CACHED = "ALL_UNITS_CACHED"
TOO_MANY_UNITS = "TOO_MANY_UNITS"
LARGE_BATCH = "LARGE_BATCH"


@dataclass
class PlannerDiagnostic:
    """Diagnostic message from the planner (error or warning)."""
    level: DiagnosticLevel = DiagnosticLevel.INFO
    code: str = ""
    message: str = ""
    file_path: Optional[str] = None
    details: Optional[str] = None


@dataclass
class TranslationTask:
    """A single batch of translation work.

    Links file -> units -> task, enabling traceability.
    """
    task_id: str = ""
    file_id: str = ""
    unit_ids: List[str] = field(default_factory=list)
    batch_index: int = 0
    batch_size: int = 0
    src_lang: str = ""
    dst_lang: str = ""
    status: str = TaskStatus.PENDING.value
    attempts: int = 0
    created_at: str = ""

    @property
    def is_cached(self) -> bool:
        return self.status == TaskStatus.CACHED.value

    @property
    def size(self) -> int:
        return len(self.unit_ids)


@dataclass
class TaskPlan:
    """Complete plan for translating a set of files.

    Contains all metadata needed by Job Manager to execute tasks.
    """
    plan_id: str = ""
    job_id: str = ""
    tasks: List[TranslationTask] = field(default_factory=list)
    total_units: int = 0
    total_tasks: int = 0
    batch_size: int = 10
    cache_hits: int = 0
    cache_misses: int = 0
    diagnostics: List[PlannerDiagnostic] = field(default_factory=list)
    created_at: str = ""
    units: List[Any] = field(default_factory=list)  # List[TranslationUnit]
