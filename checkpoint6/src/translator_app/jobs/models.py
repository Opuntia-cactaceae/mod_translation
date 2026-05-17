"""Job Manager Module — data models.

Spec: #21 Job Manager Module
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, ClassVar, Dict, List, Optional


class JobStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSING = "pausing"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobPriority(Enum):
    LOW = 0
    NORMAL = 1
    HIGH = 2


@dataclass
class JobProgress:
    """Structured progress information for a translation job."""

    total_units: int = 0
    processed_units: int = 0
    failed_units: int = 0
    cached_units: int = 0
    current_batch_index: int = 0
    total_batches: int = 0

    @property
    def percent(self) -> float:
        """Compute completion percentage (0–100).

        ``processed_units`` already includes failed + cached units,
        so the sum alone is the total number of done units.
        """
        if self.total_units == 0:
            return 100.0
        return min(100.0, round((self.processed_units / self.total_units) * 100, 1))

    @property
    def eta_seconds(self) -> Optional[float]:
        """Estimated time remaining (None until we have timing data)."""
        return None


@dataclass
class JobDiagnostic:
    """Diagnostic message attached to a job or batch."""

    level: str = "info"  # "info" | "warning" | "error"
    code: str = ""
    message: str = ""
    batch_index: Optional[int] = None
    details: Optional[Dict[str, Any]] = None


@dataclass
class TranslationJob:
    """Central job model representing a single translation job.

    Combines job metadata, translation config, task plan, progress,
    and diagnostics into one object.

    Backward-compatible alias: ``Job`` is kept as an alias
    so that existing imports across the codebase continue to work.
    """

    # --- Identity ---
    id: str
    name: str = ""

    # --- Lifecycle ---
    status: JobStatus = JobStatus.PENDING
    priority: JobPriority = JobPriority.NORMAL

    # --- Source ---
    file_paths: List[str] = field(default_factory=list)
    source_job_id: Optional[str] = None  # parent job for retry-failed
    # Per-file metadata (mod context, source root, etc.) keyed by normalised
    # file path.  Populated at job creation from CreateJobRequest.file_metadata.
    file_metadata: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    # --- Config & Plan ---
    config: Optional[Any] = None  # TranslationConfig
    task_plan: Optional[Any] = None  # TaskPlan
    units: List[Any] = field(default_factory=list)  # List[TranslationUnit]

    # --- Progress (legacy flat fields, backward compat) ---
    progress: float = 0.0
    total_units: int = 0
    completed_units: int = 0
    failed_units: int = 0

    # --- Progress (new structured fields) ---
    cached_units: int = 0
    current_batch_index: int = 0
    total_batches: int = 0

    # --- Diagnostics & result ---
    diagnostics: List[JobDiagnostic] = field(default_factory=list)
    result_summary: Optional[Dict[str, Any]] = None

    # --- Output files ---
    output_files: List[str] = field(default_factory=list)
    output_root_dir: Optional[str] = None

    # --- Timestamps ---
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: Optional[datetime] = None
    error_message: Optional[str] = None

    # ------------------------------------------------------------------
    # State machine
    # ------------------------------------------------------------------

    VALID_TRANSITIONS: ClassVar[Dict[JobStatus, List[JobStatus]]] = {
        JobStatus.PENDING: [JobStatus.RUNNING, JobStatus.CANCELLED],
        JobStatus.RUNNING: [
            JobStatus.PAUSING,
            JobStatus.PAUSED,
            JobStatus.COMPLETED,
            JobStatus.FAILED,
            JobStatus.CANCELLED,
        ],
        JobStatus.PAUSING: [JobStatus.PAUSED],
        JobStatus.PAUSED: [JobStatus.RUNNING, JobStatus.CANCELLED],
        JobStatus.COMPLETED: [],
        JobStatus.FAILED: [],
        JobStatus.CANCELLED: [],
    }

    def update_status(self, new_status: JobStatus) -> None:
        """Transition job status with state-machine validation.

        Raises ValueError if the transition is not allowed.
        """
        allowed = self.VALID_TRANSITIONS.get(self.status, [])
        if new_status not in allowed:
            raise ValueError(
                f"Invalid status transition: {self.status.value} -> {new_status.value}"
            )
        self.status = new_status
        self.updated_at = datetime.now()

    # ------------------------------------------------------------------
    # Progress helpers
    # ------------------------------------------------------------------

    def get_progress(self) -> JobProgress:
        """Build a JobProgress object from current fields.

        ``processed_units`` reflects all terminal unit states:
        completed (runtime-translated) + failed + cached.
        """
        return JobProgress(
            total_units=self.total_units,
            processed_units=self.completed_units + self.failed_units + self.cached_units,
            failed_units=self.failed_units,
            cached_units=self.cached_units,
            current_batch_index=self.current_batch_index,
            total_batches=self.total_batches,
        )

    def update_progress_from_plan(self) -> None:
        """Recalculate progress fields from the attached task_plan.

        ``total_batches`` counts only runtime (non-cached) task groups.
        Cached tasks (batch_index=-1) are excluded from batch progress.
        """
        if self.task_plan is None:
            return
        self.total_units = self.task_plan.total_units
        self.cached_units = self.task_plan.cache_hits
        # total_batches = count of runtime task groups (exclude cached tasks)
        plan = self.task_plan
        if hasattr(plan, "tasks") and plan.tasks:
            runtime_tasks = sum(
                1 for t in plan.tasks
                if not (hasattr(t, "is_cached") and t.is_cached)
                and getattr(t, "batch_index", 0) >= 0
            )
            self.total_batches = runtime_tasks
        else:
            self.total_batches = max(0, plan.total_tasks - plan.cache_hits)
        self._sync_progress_percent()

    def _sync_progress_percent(self) -> None:
        """Keep the flat ``progress`` field in sync with completed/failed/cached.

        Invariant: ``progress`` can reach **exactly** 100.0 only when
        ``completed + failed + cached == total_units``.  The ``percent``
        property on :meth:`get_progress` is the raw computed value; the
        flat field is the canonical value exposed via API.
        """
        total = self.total_units or 1
        done = self.completed_units + self.failed_units + self.cached_units
        if done == 0:
            self.progress = 0.0
        else:
            self.progress = min(
                100.0,
                round((done / total) * 100, 1),
            )

    def _has_pending_tasks(self) -> bool:
        """Check whether any task in the plan still has PENDING status.

        Returns ``True`` if there is at least one task with ``status == 'pending'``.
        Returns ``False`` if there are no tasks or none are pending.
        """
        if self.task_plan is None:
            return False
        tasks = getattr(self.task_plan, "tasks", None)
        if not tasks:
            return False
        return any(getattr(t, "status", None) == "pending" for t in tasks)


# Backward-compatible alias
Job = TranslationJob
JobProgress = JobProgress
JobDiagnostic = JobDiagnostic
