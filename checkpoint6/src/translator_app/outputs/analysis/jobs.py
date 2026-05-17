"""Domain models for async output analysis jobs."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class OutputAnalysisJobStatus(str, Enum):
    """Status of an async analysis job."""

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class OutputAnalysisJobScopeType(str, Enum):
    """Scope type for an analysis job."""

    JOB = "job"
    MOD = "mod"
    GROUP = "group"
    SELECTED = "selected"


@dataclass
class OutputAnalysisJob:
    """An async analysis job that processes output files in background."""

    id: str
    scope_type: str
    scope_json: str
    checks_json: str
    status: str = OutputAnalysisJobStatus.QUEUED.value
    total_count: int = 0
    processed_count: int = 0
    skipped_count: int = 0
    passed_count: int = 0
    warning_count: int = 0
    failed_count: int = 0
    error_count: int = 0
    created_at: str = ""
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    cancel_requested: bool = False
    error_message: Optional[str] = None

    @property
    def is_terminal(self) -> bool:
        return self.status in (
            OutputAnalysisJobStatus.COMPLETED.value,
            OutputAnalysisJobStatus.FAILED.value,
            OutputAnalysisJobStatus.CANCELLED.value,
        )

    @property
    def progress(self) -> float:
        if self.total_count == 0:
            return 0.0
        return self.processed_count / self.total_count


@dataclass
class CreateOutputAnalysisJobRequest:
    """Request to create a new analysis job."""

    scope_type: str
    job_id: Optional[str] = None
    mod_id: Optional[str] = None
    group_key: Optional[str] = None
    output_file_ids: Optional[List[str]] = None
    checks: List[str] = field(default_factory=lambda: ["compilability", "placeholders"])
    only_stale: bool = False
