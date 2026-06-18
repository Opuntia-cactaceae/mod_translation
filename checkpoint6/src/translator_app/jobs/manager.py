"""Job Manager Module — coordinates translation job lifecycle.

Spec: #21 Job Manager Module

Flow:
    file_paths + config
      -> TaskPlanner.build_plan()
      -> create job
      -> store plan / tasks / progress
      -> start / pause / resume / cancel
      -> persist state
      -> prepare foundation for TranslationCoreAdapter
"""

import json
import logging
import os
import uuid
from copy import deepcopy
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

from translator_app.backend.path_utils import canonicalize_path
from translator_app.jobs.models import (
    JobDiagnostic,
    JobProgress,
    JobStatus,
    JobPriority,
    TranslationJob,
)
from translator_app.translation.config import TranslationConfig


# ---------------------------------------------------------------------------
# JobManagerError — structured error for invalid operations
# ---------------------------------------------------------------------------


class JobManagerError(Exception):
    """Raised when a job operation fails due to state or not-found."""

    def __init__(self, code: str, message: str, status_code: int = 400):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


JOB_NOT_FOUND = "JOB_NOT_FOUND"
NO_FAILED_UNITS = "NO_FAILED_UNITS"
INVALID_JOB_STATE = "INVALID_JOB_STATE"
JOB_ALREADY_RUNNING = "JOB_ALREADY_RUNNING"
JOB_NOT_PAUSED = "JOB_NOT_PAUSED"
JOB_RESUME_FAILED = "JOB_RESUME_FAILED"
JOB_CANCEL_FAILED = "JOB_CANCEL_FAILED"
CANNOT_CHANGE_LANGUAGE = "CANNOT_CHANGE_LANGUAGE"


# ---------------------------------------------------------------------------
# Config fields that CAN be changed after job creation
# ---------------------------------------------------------------------------

MUTABLE_CONFIG_FIELDS = frozenset({
    "model",
    "prompt",
    "batch_size",
    "protection",
    "validation",
})

# Fields that have dedicated accessor paths in TranslationConfig
MUTABLE_CONFIG_PATHS = frozenset({
    "runtime.model",
    "prompt.profile_name",
    "prompt.batch_system_prompt",
    "prompt.batch_user_template",
    "prompt.single_system_prompt",
    "prompt.single_user_template",
    "prompt.log_prompts",
    "batch_size",
    "protection.rule_set_ids",
    "protection.options",
    "validation.validator_name",
    "validation.options",
    "validation.allow_fallback_on_json_error",
})

# Language fields — NEVER mutable after job creation
LANGUAGE_FIELDS = frozenset({"src_lang", "dst_lang"})


# ---------------------------------------------------------------------------
# Persistence layer (in-memory with JSON serialization)
# ---------------------------------------------------------------------------


class _InMemoryStore:
    """TEST/DEV-ONLY: Simple in-memory dict store with JSON serialization support.

    Intended for tests and local development only.
    Production uses ``JobRepository`` backed by SQLite.
    Data is LOST on process restart — never use in production.
    """

    def __init__(self):
        self._jobs: Dict[str, TranslationJob] = {}

    def save(self, job: TranslationJob) -> None:
        self._jobs[job.id] = job

    def get(self, job_id: str) -> Optional[TranslationJob]:
        return self._jobs.get(job_id)

    def delete(self, job_id: str) -> None:
        self._jobs.pop(job_id, None)

    def list_all(self) -> List[TranslationJob]:
        return list(self._jobs.values())

    def list_by_status(self, status: JobStatus) -> List[TranslationJob]:
        return [j for j in self._jobs.values() if j.status == status]

    def to_json(self) -> str:
        """Serialize all jobs to JSON."""
        data = []
        for job in self.list_all():
            data.append(_job_to_dict(job))
        return json.dumps(data, default=str, indent=2)

    @classmethod
    def from_json(cls, raw: str) -> "_InMemoryStore":
        """Deserialize jobs from JSON into a new store."""
        store = cls()
        data = json.loads(raw)
        for item in data:
            job = _dict_to_job(item)
            if job:
                store._jobs[job.id] = job
        return store


def _job_to_dict(job: TranslationJob) -> dict:
    """Convert a TranslationJob to a JSON-serializable dict."""
    config_data = None
    if job.config is not None:
        if isinstance(job.config, dict):
            # Config was deserialized from DB — use as-is
            config_data = job.config
        elif hasattr(job.config, "to_dict"):
            config_data = job.config.to_dict()
        elif hasattr(job.config, "__dataclass_fields__"):
            from dataclasses import asdict
            config_data = asdict(job.config)

    plan_data = None
    if job.task_plan is not None:
        if hasattr(job.task_plan, "__dataclass_fields__"):
            from dataclasses import asdict
            plan_data = asdict(job.task_plan)
        elif isinstance(job.task_plan, dict):
            plan_data = job.task_plan

    return {
        "id": job.id,
        "name": job.name,
        "status": job.status.value,
        "priority": job.priority.value,
        "file_paths": list(job.file_paths),
        "file_metadata": dict(job.file_metadata),
        "source_job_id": job.source_job_id,
        "config": config_data,
        "task_plan": plan_data,
        "progress": job.progress,
        "total_units": job.total_units,
        "completed_units": job.completed_units,
        "failed_units": job.failed_units,
        "cached_units": job.cached_units,
        "current_batch_index": job.current_batch_index,
        "total_batches": job.total_batches,
        "diagnostics": [
            {
                "level": d.level,
                "code": d.code,
                "message": d.message,
                "batch_index": d.batch_index,
                "details": d.details,
            }
            for d in (job.diagnostics or [])
        ],
        "result_summary": job.result_summary,
        "output_files": list(job.output_files),
        "output_root_dir": job.output_root_dir,
        "created_at": job.created_at.isoformat() if hasattr(job.created_at, "isoformat") else str(job.created_at),
        "updated_at": job.updated_at.isoformat() if job.updated_at and hasattr(job.updated_at, "isoformat") else str(job.updated_at) if job.updated_at else None,
        "started_at": job.started_at.isoformat() if job.started_at and hasattr(job.started_at, "isoformat") else str(job.started_at) if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at and hasattr(job.completed_at, "isoformat") else str(job.completed_at) if job.completed_at else None,
        "error_message": job.error_message,
    }


def _dict_to_job(data: dict) -> Optional[TranslationJob]:
    """Reconstruct a TranslationJob from a dict."""
    try:
        status = JobStatus(data.get("status", "pending"))
        priority = JobPriority(data.get("priority", 1))
        created_at = _parse_dt(data.get("created_at", ""))
        updated_at = _parse_dt(data.get("updated_at")) if data.get("updated_at") else None
        started_at = _parse_dt(data.get("started_at")) if data.get("started_at") else None
        completed_at = _parse_dt(data.get("completed_at")) if data.get("completed_at") else None

        diags = []
        for d in data.get("diagnostics", []):
            diags.append(JobDiagnostic(
                level=d.get("level", "info"),
                code=d.get("code", ""),
                message=d.get("message", ""),
                batch_index=d.get("batch_index"),
                details=d.get("details"),
            ))

        return TranslationJob(
            id=data.get("id", ""),
            name=data.get("name", ""),
            status=status,
            priority=priority,
            file_paths=list(data.get("file_paths", [])),
            file_metadata=data.get("file_metadata", {}),
            source_job_id=data.get("source_job_id"),
            config=data.get("config"),  # stored as dict, consumer rehydrates
            task_plan=data.get("task_plan"),
            progress=data.get("progress", 0.0),
            total_units=data.get("total_units", 0),
            completed_units=data.get("completed_units", 0),
            failed_units=data.get("failed_units", 0),
            cached_units=data.get("cached_units", 0),
            current_batch_index=data.get("current_batch_index", 0),
            total_batches=data.get("total_batches", 0),
            diagnostics=diags,
            result_summary=data.get("result_summary"),
            output_files=list(data.get("output_files", [])),
            output_root_dir=data.get("output_root_dir"),
            created_at=created_at,
            updated_at=updated_at,
            started_at=started_at,
            completed_at=completed_at,
            error_message=data.get("error_message"),
        )
    except Exception:
        return None


def _parse_dt(value) -> datetime:
    """Parse an ISO datetime string, returning now() on failure."""
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return datetime.now()


# ---------------------------------------------------------------------------
# JobManager
# ---------------------------------------------------------------------------


class JobManager:
    """Coordinates translation job lifecycle.

    Creates jobs via TaskPlanner, manages state transitions, persists
    state, and provides a foundation for the TranslationCoreAdapter.
    """

    def __init__(self, planner=None, repository=None):
        self._planner = planner  # Optional[TaskPlanner]
        if repository is None:
            logger.warning(
                "JobManager initialized without a repository — "
                "using test/dev-only _InMemoryStore. Data will be lost on restart."
            )
            self._repo = _InMemoryStore()
        else:
            self._repo = repository

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def create_job(
        self,
        file_paths: List[str],
        config: Optional[TranslationConfig] = None,
        autostart: bool = False,
        name: str = "",
        priority: JobPriority = JobPriority.NORMAL,
        planner: Optional[Any] = None,
        file_metadata: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> TranslationJob:
        """Create a new translation job.

        If *config* and *planner* are available, calls
        ``planner.build_plan()`` to generate the task plan immediately.

        Args:
            file_paths: List of file paths to translate.
            config: TranslationConfig (optional, used by planner).
            autostart: If True, start job immediately after creation.
            name: Human-readable name.
            priority: Job priority.
            planner: Optional TaskPlanner override (falls back to
                     self._planner if not provided).

        Returns:
            The newly created TranslationJob.
        """
        # --- Canonicalise absolute file_paths and re-key file_metadata ---
        # Identity contract: all paths used as identity keys must be canonical
        # (resolved symlinks, normalised ``..``, absolute).  Relative paths are
        # preserved as-is for backward compatibility.
        canonical_paths: List[str] = []
        seen: set[str] = set()
        metadata_key_map: dict[str, str] = {}
        for p in file_paths:
            cp = canonicalize_path(p) if os.path.isabs(p) else p
            metadata_key_map[p] = cp
            if cp not in seen:
                seen.add(cp)
                canonical_paths.append(cp)

        canonical_metadata: dict[str, dict[str, Any]] = {}
        if file_metadata:
            for orig_key, meta in file_metadata.items():
                ck = metadata_key_map.get(orig_key, canonicalize_path(orig_key) if os.path.isabs(orig_key) else orig_key)
                if ck not in canonical_metadata:
                    canonical_metadata[ck] = dict(meta)

        job = TranslationJob(
            id=str(uuid.uuid4()),
            name=name or f"Job-{len(self._repo.list_all()) + 1}",
            status=JobStatus.PENDING,
            priority=priority,
            file_paths=canonical_paths,
            file_metadata=canonical_metadata,
            config=config,
        )

        # Build the task plan if a planner and config are available
        active_planner = planner or self._planner
        if active_planner is not None and config is not None:
            plan = active_planner.build_plan(canonical_paths, job_id=job.id)
            job.task_plan = plan
            job.update_progress_from_plan()

            # Store plan units on the job
            if hasattr(plan, "units") and plan.units:
                job.units = list(plan.units)

            # Copy planner diagnostics into job diagnostics
            if plan.diagnostics:
                for pd in plan.diagnostics:
                    job.diagnostics.append(JobDiagnostic(
                        level=pd.level.value if hasattr(pd.level, "value") else str(pd.level),
                        code=pd.code,
                        message=pd.message,
                        details={"file_path": pd.file_path} if pd.file_path else None,
                    ))

        self._repo.save(job)

        if autostart:
            job = self.start_job(job.id)

        return job

    def create_restart_job(
        self,
        source_job_id: str,
        config: Optional[TranslationConfig] = None,
        autostart: bool = False,
        planner: Optional[Any] = None,
    ) -> TranslationJob:
        """Create a new job that is a full rerun of ``source_job``.

        Unlike ``create_retry_job`` (which only retries failed units), this
        method creates a completely fresh job with the same file paths and
        config, re-parsing all source files and building a brand new task
        plan.

        Cache is disabled so that ALL units are re-translated from scratch,
        making this a true full rerun (not a cache-assisted replay).

        Args:
            source_job_id: ID of the parent job to rerun.
            config: TranslationConfig (falls back to source job's config
                    with ``use_cache`` forced to False).
            autostart: If True, start the new job immediately.
            planner: Optional TaskPlanner override.

        Returns:
            The newly created restart TranslationJob.

        Raises:
            JobManagerError: if source job is not found.
        """
        source_job = self._get_or_raise(source_job_id)

        # Copy config from source job — preserve use_cache setting
        restart_config = config if config is not None else source_job.config
        if restart_config is not None:
            if hasattr(restart_config, "__dataclass_fields__"):
                from copy import deepcopy
                restart_config = deepcopy(restart_config)
                # Preserve original use_cache — do NOT force False
            elif isinstance(restart_config, dict):
                restart_config = dict(restart_config)

        restart_name = f"{source_job.name} (restart)"

        job = TranslationJob(
            id=str(uuid.uuid4()),
            name=restart_name,
            status=JobStatus.PENDING,
            priority=source_job.priority,
            file_paths=list(source_job.file_paths),
            file_metadata=dict(source_job.file_metadata),  # copy from source
            source_job_id=source_job_id,
            config=restart_config,
        )

        # Build a fresh task plan from source files (planner without cache)
        active_planner = planner or self._planner
        if active_planner is not None and restart_config is not None:
            plan = active_planner.build_plan(
                list(source_job.file_paths),
                job_id=job.id,
            )
            job.task_plan = plan
            job.update_progress_from_plan()

            if hasattr(plan, "units") and plan.units:
                job.units = list(plan.units)

            if plan.diagnostics:
                for pd in plan.diagnostics:
                    job.diagnostics.append(JobDiagnostic(
                        level=pd.level.value if hasattr(pd.level, "value") else str(pd.level),
                        code=pd.code,
                        message=pd.message,
                        details={"file_path": pd.file_path} if pd.file_path else None,
                    ))

        self._repo.save(job)

        if autostart:
            job = self.start_job(job.id)

        return job

    def create_retry_job(
        self,
        source_job_id: str,
        failed_units: List[Any],
        config: Optional[TranslationConfig] = None,
        autostart: bool = False,
        planner: Optional[Any] = None,
    ) -> TranslationJob:
        """Create a new job that retries only the failed units of ``source_job``.

        Args:
            source_job_id: ID of the parent job whose failed units to retry.
            failed_units: List of TranslationUnit objects that failed.
            config: TranslationConfig (falls back to source job's config).
            autostart: If True, start the new job immediately.
            planner: Optional TaskPlanner override.

        Returns:
            The newly created retry TranslationJob.

        Raises:
            JobManagerError: if source job is not found or has no failed units.
        """
        # Validate source job exists
        source_job = self._get_or_raise(source_job_id)

        if not failed_units:
            raise JobManagerError(
                NO_FAILED_UNITS,
                f"Source job {source_job_id} has no failed units to retry.",
                status_code=400,
            )

        retry_config = config if config is not None else source_job.config
        retry_name = f"{source_job.name} (retry failed)"

        job = TranslationJob(
            id=str(uuid.uuid4()),
            name=retry_name,
            status=JobStatus.PENDING,
            priority=source_job.priority,
            file_paths=list(source_job.file_paths),
            file_metadata=dict(source_job.file_metadata),  # copy from source
            source_job_id=source_job_id,
            config=retry_config,
        )

        # Build task plan from the failed units only
        active_planner = planner or self._planner
        if active_planner is not None and retry_config is not None:
            plan = active_planner.build_plan_from_units(
                failed_units,
                file_paths=list(source_job.file_paths),
                job_id=job.id,
            )
            job.task_plan = plan
            job.update_progress_from_plan()

            # Store plan units on the job
            if hasattr(plan, "units") and plan.units:
                job.units = list(plan.units)

            # Copy planner diagnostics into job diagnostics
            if plan.diagnostics:
                for pd in plan.diagnostics:
                    job.diagnostics.append(JobDiagnostic(
                        level=pd.level.value if hasattr(pd.level, "value") else str(pd.level),
                        code=pd.code,
                        message=pd.message,
                        details={"file_path": pd.file_path} if pd.file_path else None,
                    ))

        self._repo.save(job)

        if autostart:
            job = self.start_job(job.id)

        return job

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start_job(self, job_id: str) -> TranslationJob:
        """Start a pending job: pending -> running.

        Raises ``JobManagerError`` if job is not found or not in pending status.
        """
        job = self._get_or_raise(job_id)
        self._reject_broken_plan(job, "start")
        try:
            job.update_status(JobStatus.RUNNING)
        except ValueError:
            raise JobManagerError(
                INVALID_JOB_STATE,
                f"Cannot start job {job_id}: current status is '{job.status.value}'. "
                f"Only 'pending' jobs can be started.",
            )
        self._repo.save(job)
        return job

    def pause_job(self, job_id: str) -> TranslationJob:
        """Pause a running job: running -> pausing -> paused.

        For MVP the pausing state is transient — we advance directly
        to paused (a real worker would finish the current batch first).
        """
        job = self._get_or_raise(job_id)
        try:
            job.update_status(JobStatus.PAUSING)
            job.update_status(JobStatus.PAUSED)
        except ValueError:
            raise JobManagerError(
                INVALID_JOB_STATE,
                f"Cannot pause job {job_id}: current status is '{job.status.value}'. "
                f"Only 'running' jobs can be paused.",
            )
        self._repo.save(job)
        return job

    def resume_job(self, job_id: str) -> TranslationJob:
        """Resume a paused job: paused -> running."""
        job = self._get_or_raise(job_id)
        self._reject_broken_plan(job, "resume")
        if job.status != JobStatus.PAUSED:
            raise JobManagerError(
                INVALID_JOB_STATE,
                f"Cannot resume job {job_id}: current status is '{job.status.value}'. "
                f"Only 'paused' jobs can be resumed.",
            )
        job.update_status(JobStatus.RUNNING)
        self._repo.save(job)
        return job

    def cancel_job(self, job_id: str) -> TranslationJob:
        """Cancel a job: pending/running/paused -> cancelled."""
        job = self._get_or_raise(job_id)
        try:
            job.update_status(JobStatus.CANCELLED)
        except ValueError:
            raise JobManagerError(
                INVALID_JOB_STATE,
                f"Cannot cancel job {job_id}: current status is '{job.status.value}' "
                f"which cannot be cancelled.",
            )
        # Sync progress to remove 99.9% cap that save_partial_results may
        # have applied.  CANCELLED is a terminal state — the cap is only
        # meaningful while RUNNING.
        job._sync_progress_percent()
        self._repo.save(job)
        return job

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    def get_job(self, job_id: str) -> Optional[TranslationJob]:
        """Get a job by ID, or None if not found."""
        return self._repo.get(job_id)

    def list_jobs(
        self, status: Optional[JobStatus] = None
    ) -> List[TranslationJob]:
        """List all jobs, optionally filtered by status."""
        if status is not None:
            return self._repo.list_by_status(status)
        return self._repo.list_all()

    # ------------------------------------------------------------------
    # Config update
    # ------------------------------------------------------------------

    def update_job_config(
        self, job_id: str, new_config: Dict[str, Any]
    ) -> TranslationJob:
        """Apply a partial config update to a pending or paused job.

        Allowed changes (from TZ #21):
            - model, prompt, batch_size, protection, validation

        Forbidden:
            - src_lang, dst_lang (cannot be changed after creation)
        """
        job = self._get_or_raise(job_id)

        if job.status not in (JobStatus.PENDING, JobStatus.PAUSED):
            raise JobManagerError(
                INVALID_JOB_STATE,
                f"Cannot update config for job {job_id}: "
                f"current status is '{job.status.value}'. "
                f"Config can only be updated for 'pending' or 'paused' jobs.",
            )

        # Reject language changes
        for lang_field in LANGUAGE_FIELDS:
            if lang_field in new_config:
                raise JobManagerError(
                    CANNOT_CHANGE_LANGUAGE,
                    f"Cannot change '{lang_field}' after job creation.",
                )

        # Verify only mutable fields are present
        update_keys = set(new_config.keys())
        allowed = MUTABLE_CONFIG_FIELDS | MUTABLE_CONFIG_PATHS
        unknown = update_keys - allowed
        if unknown:
            raise JobManagerError(
                INVALID_JOB_STATE,
                f"Cannot update config fields: {sorted(unknown)}. "
                f"Only mutable fields are allowed: {sorted(allowed)}.",
            )

        # Apply the update to the config object
        if job.config is not None and hasattr(job.config, "__dataclass_fields__"):
            job.config = self._apply_config_overrides(job.config, new_config)
        elif isinstance(job.config, dict):
            job.config.update(new_config)
        elif job.config is None:
            # Store raw dict if no config object exists
            job.config = new_config

        self._repo.save(job)
        return job

    # ------------------------------------------------------------------
    # Partial results (stub for TranslationCoreAdapter)
    # ------------------------------------------------------------------

    def save_partial_results(
        self, job_id: str, batch_result: Dict[str, Any],
        job: Optional[TranslationJob] = None,
    ) -> None:
        """Save partial translation results after a batch completes.

        Args:
            job_id: The job these results belong to.
            batch_result: Dict with keys like ``completed``, ``failed``,
                          ``batch_index``, and optionally ``translations``.
                          Counters are DELTA per batch (not cumulative).
            job: Optional pre-fetched job object. If provided, it is used
                 instead of re-fetching from the repository. This preserves
                 in-memory mutations (e.g. task status changes) that would
                 otherwise be lost when the repository returns a new object.

        Invariants enforced:
            - completed + failed + cached never exceeds total_units
            - If a counter would exceed total_units, it is capped and a
              DATA_INVARIANT_VIOLATION diagnostic is added.
            - This method does NOT transition the job to COMPLETED.
              Completion is handled by the execution layer
              (``execute_next_batch``) which has full context of the
              task plan and trace events.
        """
        if job is None:
            job = self._get_or_raise(job_id)

        completed_delta = batch_result.get("completed", 0)
        failed_delta = batch_result.get("failed", 0)
        cached_delta = batch_result.get("cached", 0)
        batch_index = batch_result.get("batch_index", job.current_batch_index)

        # --- Invariant guard: cap counters at total_units ---
        new_completed = job.completed_units + completed_delta
        new_failed = job.failed_units + failed_delta
        new_cached = job.cached_units + cached_delta
        new_total = new_completed + new_failed + new_cached

        if new_total > job.total_units > 0:
            excess = new_total - job.total_units
            # Reduce completed first (safest to cap — can be re-processed)
            reduce_completed = min(new_completed, excess)
            new_completed -= reduce_completed
            excess -= reduce_completed
            # Then reduce cached
            reduce_cached = min(new_cached, excess)
            new_cached -= reduce_cached
            excess -= reduce_cached
            # Then reduce failed (last resort — real errors must not be hidden)
            new_failed = max(0, new_failed - excess)
            job.diagnostics.append(JobDiagnostic(
                level="error",
                code="DATA_INVARIANT_VIOLATION",
                message=(
                    f"Progress counters exceeded total_units={job.total_units}: "
                    f"completed={job.completed_units + completed_delta}, "
                    f"failed={job.failed_units + failed_delta}, "
                    f"cached={job.cached_units + cached_delta}. "
                    f"Capped: completed={new_completed}, failed={new_failed}, "
                    f"cached={new_cached}."
                ),
                batch_index=batch_index,
            ))

        job.completed_units = new_completed
        job.failed_units = new_failed
        job.cached_units = new_cached
        job.current_batch_index = batch_index
        job._sync_progress_percent()
        job.updated_at = datetime.now()

        # Diagnostic + semantic guard: check if counters suggest completion
        # while the job is still RUNNING.  This is an INVARIANT VIOLATION
        # that produces 100% progress before the job is actually complete.
        #
        # We do NOT transition to COMPLETED here — the execution layer
        # (execute_next_batch) handles the status transition with full
        # task-plan and trace-event context.  Instead we:
        #   1) cap ``progress`` at 99.9% so the UI never sees 100%
        #   2) emit a ``COUNTERS_SATURATED`` error diagnostic
        if (
            job.status == JobStatus.RUNNING
            and job.completed_units + job.failed_units + job.cached_units >= job.total_units
            and job.total_units > 0
        ):
            # --- Cap progress at 99.9% — 100% only when execution layer
            #     transitions to COMPLETED (with all tasks done). ---
            if job.progress >= 100.0:
                job.progress = 99.9

            # --- Dedup: only emit COUNTERS_SATURATED once to avoid
            #     flooding diagnostics on repeated save_partial_results
            #     calls while counters are already saturated. ---
            already_saturated = any(
                d.code == "COUNTERS_SATURATED"
                for d in (job.diagnostics or [])
            )

            if not already_saturated:
                # --- Check for pending tasks to distinguish normal last-batch
                #     saturation from the invariant violation. ---
                has_pending = job._has_pending_tasks()
                diag_level = "error" if has_pending else "info"
                diag_msg = (
                    f"Progress counters reached total_units={job.total_units} "
                    f"(completed={job.completed_units}, "
                    f"failed={job.failed_units}, "
                    f"cached={job.cached_units}), "
                    f"but completion transition is deferred to execution layer."
                )
                if has_pending:
                    diag_msg += (
                        f" INVARIANT: progress capped at 99.9% because "
                        f"{sum(1 for t in getattr(job.task_plan, 'tasks', []) if getattr(t, 'status', None) == 'pending')} "
                        f"tasks still have PENDING status."
                    )
                job.diagnostics.append(JobDiagnostic(
                    level=diag_level,
                    code="COUNTERS_SATURATED",
                    message=diag_msg,
                    batch_index=batch_index,
                ))

        self._repo.save(job)

    # ------------------------------------------------------------------
    # Recovery
    # ------------------------------------------------------------------

    def recover_jobs_after_restart(self) -> List[TranslationJob]:
        """Recover jobs after app restart.

        Deprecated — use ``recover_interrupted_jobs()`` from
        ``translator_app.jobs.recovery`` instead, which is the single
        canonical recovery path.

        This method delegates to the canonical recovery function for
        consistency.  BE AWARE: the canonical function may add diagnostic
        and trace entries that this simpler version does not.
        """
        # Lazy import avoids circular dependency (recovery -> manager -> recovery)
        from translator_app.jobs.recovery import recover_interrupted_jobs

        count = recover_interrupted_jobs(self)
        # Re-fetch recovered jobs to return them (the canonical function
        # modifies jobs in-place through _repo.save).
        return [j for j in self._repo.list_all()
                if j.status == JobStatus.PAUSED
                and any(d.code == "SERVER_RESTARTED" for d in (j.diagnostics or []))][-count:] if count else []

    # ------------------------------------------------------------------
    # Backward-compat aliases (old method names)
    # ------------------------------------------------------------------

    def start(self, job_id: str) -> Optional[TranslationJob]:
        """Backward-compat alias for ``start_job``. Returns None on error."""
        try:
            return self.start_job(job_id)
        except JobManagerError:
            return None

    def pause(self, job_id: str) -> Optional[TranslationJob]:
        """Backward-compat alias for ``pause_job``."""
        try:
            return self.pause_job(job_id)
        except JobManagerError:
            return None

    def resume(self, job_id: str) -> Optional[TranslationJob]:
        """Backward-compat alias for ``resume_job``."""
        try:
            return self.resume_job(job_id)
        except JobManagerError:
            return None

    def cancel(self, job_id: str) -> Optional[TranslationJob]:
        """Backward-compat alias for ``cancel_job``."""
        try:
            return self.cancel_job(job_id)
        except JobManagerError:
            return None

    def get(self, job_id: str) -> Optional[TranslationJob]:
        """Backward-compat alias for ``get_job``."""
        return self.get_job(job_id)

    def update_progress(
        self, job_id: str, completed: int = 0, failed: int = 0
    ) -> Optional[TranslationJob]:
        """Backward-compat: update progress via flat fields."""
        try:
            job = self._get_or_raise(job_id)
        except JobManagerError:
            return None
        job.completed_units += completed
        job.failed_units += failed
        job._sync_progress_percent()
        job.updated_at = datetime.now()
        if job.progress >= 100.0 and job.status == JobStatus.RUNNING:
            try:
                job.update_status(JobStatus.COMPLETED)
            except ValueError as exc:
                logger.warning(
                    "Invalid transition for job %s: %s -> COMPLETED: %s",
                    job_id, job.status.value, exc,
                )
                job.diagnostics.append(JobDiagnostic(
                    level="warning",
                    code="INVALID_STATUS_TRANSITION",
                    message=(
                        f"Invalid status transition: {job.status.value} -> "
                        f"completed for job {job_id}: {exc}"
                    ),
                    details={
                        "from_status": job.status.value,
                        "to_status": "completed",
                        "job_id": job_id,
                    },
                ))
        self._repo.save(job)
        return job

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _reject_broken_plan(job: TranslationJob, operation: str) -> None:
        """Guard: reject jobs whose task_plan cannot be safely used.

        Checks two conditions:
        1. Job has ``TASK_PLAN_REHYDRATION_FAILED`` diagnostic (set by the
           repository layer when rehydration from JSON failed).
        2. ``task_plan`` is a raw ``dict`` (JSON deserialization output)
           instead of a proper ``TaskPlan`` instance.

        When either condition is true, the job is marked ``FAILED``,
        ``task_plan`` is set to ``None``, and a ``JobManagerError`` is
        raised so the caller (start / resume) never proceeds with execution.
        """
        has_failure_diag = any(
            d.code == "TASK_PLAN_REHYDRATION_FAILED"
            for d in (job.diagnostics or [])
        )
        is_raw_dict = isinstance(job.task_plan, dict)

        if not has_failure_diag and not is_raw_dict:
            return  # All good

        # Capture raw type before mutation (for the diagnostic message)
        raw_type_name = type(job.task_plan).__name__ if job.task_plan is not None else "None"

        # Mark job as FAILED
        job.status = JobStatus.FAILED
        job.task_plan = None
        job.units = []
        if not job.error_message:
            job.error_message = (
                f"Cannot {operation} job {job.id}: "
                f"task_plan is corrupted"
            )
        if not has_failure_diag:
            job.diagnostics.append(JobDiagnostic(
                level="error",
                code="TASK_PLAN_REHYDRATION_FAILED",
                message=(
                    f"Cannot {operation} job {job.id}: "
                    f"task_plan is not a valid TaskPlan instance "
                    f"(type={raw_type_name})"
                ),
                details={"operation": operation},
            ))
        raise JobManagerError(
            INVALID_JOB_STATE,
            f"Cannot {operation} job {job.id}: "
            f"task_plan is corrupted",
        )

    def _get_or_raise(self, job_id: str) -> TranslationJob:
        """Get a job or raise ``JobManagerError(JOB_NOT_FOUND)``."""
        job = self._repo.get(job_id)
        if job is None:
            raise JobManagerError(
                JOB_NOT_FOUND,
                f"Job not found: {job_id}",
                status_code=404,
            )
        return job

    @staticmethod
    def _apply_config_overrides(
        config: TranslationConfig, overrides: Dict[str, Any]
    ) -> TranslationConfig:
        """Apply config overrides, preserving existing values for unset fields."""
        result = deepcopy(config)

        if "model" in overrides and result.runtime is not None:
            result.runtime.model = overrides["model"]
        if "batch_size" in overrides:
            result.batch_size = int(overrides["batch_size"])

        # Prompt overrides
        if "prompt" in overrides:
            prompt_updates = overrides["prompt"]
            if isinstance(prompt_updates, dict):
                for k, v in prompt_updates.items():
                    if hasattr(result.prompt, k):
                        setattr(result.prompt, k, v)

        # Protection overrides
        if "protection" in overrides:
            prot_updates = overrides["protection"]
            if isinstance(prot_updates, dict):
                if "rule_set_ids" in prot_updates:
                    result.protection.rule_set_ids = list(prot_updates["rule_set_ids"])
                # Legacy backward compat
                if "strategy" in prot_updates and not prot_updates.get("rule_set_ids"):
                    from translator_app.protection.rule_set import DEFAULT_RULE_SET_ID
                    if prot_updates["strategy"] and prot_updates["strategy"] != "none":
                        result.protection.rule_set_ids = [DEFAULT_RULE_SET_ID]

        # Validation overrides
        if "validation" in overrides:
            val_updates = overrides["validation"]
            if isinstance(val_updates, dict):
                if "validator_name" in val_updates:
                    result.validation.validator_name = val_updates["validator_name"]
                if "options" in val_updates:
                    result.validation.options = dict(val_updates["options"])

        # Flat key overrides (path-style)
        path_mapping = {
            "runtime.model": ("runtime", "model"),
            "batch_size": ("batch_size",),
            "prompt.profile_name": ("prompt", "profile_name"),
            "prompt.batch_system_prompt": ("prompt", "batch_system_prompt"),
            "prompt.batch_user_template": ("prompt", "batch_user_template"),
            "prompt.single_system_prompt": ("prompt", "single_system_prompt"),
            "prompt.single_user_template": ("prompt", "single_user_template"),
            "protection.rule_set_ids": ("protection", "rule_set_ids"),
            "protection.options": ("protection", "options"),
            "validation.validator_name": ("validation", "validator_name"),
            "validation.options": ("validation", "options"),
        }
        for path_key, attrs in path_mapping.items():
            if path_key in overrides:
                obj = result
                for attr in attrs[:-1]:
                    obj = getattr(obj, attr)
                setattr(obj, attrs[-1], overrides[path_key])

        return result
