"""Translation jobs API endpoints.

Spec: #21 Job Manager Module
"""

import logging
import os
import threading
from datetime import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends

from translator_app.backend.path_utils import canonicalize_path
from translator_app.backend.schemas.jobs import (
    JobResponse,
    JobSummaryResponse,
    JobProgressResponse,
    JobDiagnosticResponse,
    OutputFileRef,
    TaskPlanSummary,
    CreateJobRequest,
    JobActionResponse,
    UpdateConfigRequest,
)
from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import APIError, JOB_NOT_FOUND, INVALID_REQUEST, NO_FAILED_UNITS
from translator_app.jobs.models import (
    JobDiagnostic,
    JobPriority,
    JobProgress,
    JobStatus,
    TranslationJob,
)
from translator_app.jobs.manager import JobManagerError
from translator_app.storage.repositories import TranslationUnitRepository
from translator_app.translation.task_planner import TaskPlanner
from translator_app.translation.trace_models import TraceEventType

logger = logging.getLogger(__name__)

router = APIRouter(tags=["translation-jobs"])


# ---------------------------------------------------------------------------
# Active execution tracking
# ---------------------------------------------------------------------------

_active_executions: Dict[str, threading.Thread] = {}
_active_executions_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_progress_response(progress: JobProgress) -> JobProgressResponse:
    return JobProgressResponse(
        total_units=progress.total_units,
        processed_units=progress.processed_units,
        failed_units=progress.failed_units,
        cached_units=progress.cached_units,
        current_batch_index=progress.current_batch_index,
        total_batches=progress.total_batches,
        percent=progress.percent,
        eta_seconds=progress.eta_seconds,
    )


def _build_diagnostics(job: TranslationJob) -> list:
    return [
        JobDiagnosticResponse(
            level=d.level,
            code=d.code,
            message=d.message,
            batch_index=d.batch_index,
            details=d.details,
        )
        for d in (job.diagnostics or [])
    ]


def _build_output_file_refs(
    svcs: Services, job_id: str,
) -> List[OutputFileRef]:
    """Build output file refs for a single job.

    Returns a list of ``OutputFileRef`` objects by querying the
    ``TranslatedOutputFileRepository``.  Empty list if the job has no
    indexed output files or the repo is unavailable.
    """
    try:
        raw_refs = svcs.output_files_repo.get_output_file_refs(job_id)
        return [OutputFileRef(id=r["id"], path=r["path"]) for r in raw_refs]
    except Exception:
        logger.exception("Failed to build output_file_refs for job %s", job_id)
        return []


def _build_output_file_refs_batch(
    svcs: Services, job_ids: List[str],
) -> Dict[str, List[OutputFileRef]]:
    """Build output file refs for multiple jobs in a single query.

    Returns a dict mapping job_id to a list of ``OutputFileRef``.
    """
    try:
        raw = svcs.output_files_repo.get_output_file_refs_batch(job_ids)
        return {
            jid: [OutputFileRef(id=r["id"], path=r["path"]) for r in refs]
            for jid, refs in raw.items()
        }
    except Exception:
        logger.exception("Failed to build output_file_refs batch for %d jobs", len(job_ids))
        return {}


def _build_task_plan_summary(job: TranslationJob) -> Optional[TaskPlanSummary]:
    if job.task_plan is None:
        return None
    plan = job.task_plan
    return TaskPlanSummary(
        total_units=getattr(plan, "total_units", 0),
        total_tasks=getattr(plan, "total_tasks", 0),
        batch_size=getattr(plan, "batch_size", 0),
        cache_hits=getattr(plan, "cache_hits", 0),
        cache_misses=getattr(plan, "cache_misses", 0),
    )


def _serialize_config(job: TranslationJob) -> Optional[Dict[str, Any]]:
    """Serialize job.config to a JSON-compatible dict.

    Handles TranslationConfig dataclass, objects with to_dict(),
    and plain dict (after deserialization from the repository).
    """
    if job.config is None:
        return None
    # Case 1: already a dict (e.g. after deserialization from repo)
    if isinstance(job.config, dict):
        return job.config
    # Case 2: object with to_dict() method (matching _job_to_dict)
    if hasattr(job.config, "to_dict"):
        return job.config.to_dict()
    # Case 3: dataclass
    if hasattr(job.config, "__dataclass_fields__"):
        from dataclasses import asdict
        return asdict(job.config)
    # Unexpected type — log and return None rather than silently dropping config
    logger.warning(
        "Unexpected config type %s for job %s — config will be None in response",
        type(job.config).__name__,
        job.id,
    )
    return None


def _job_to_response(
    job: TranslationJob,
    output_file_refs: Optional[List[OutputFileRef]] = None,
) -> JobResponse:
    return JobResponse(
        id=job.id,
        name=job.name,
        status=job.status.value,
        source_job_id=job.source_job_id,
        progress=job.progress,
        total_units=job.total_units,
        completed_units=job.completed_units,
        failed_units=job.failed_units,
        cached_units=job.cached_units,
        current_batch_index=job.current_batch_index,
        total_batches=job.total_batches,
        created_at=job.created_at.isoformat() if hasattr(job.created_at, "isoformat") else str(job.created_at),
        updated_at=job.updated_at.isoformat() if job.updated_at and hasattr(job.updated_at, "isoformat") else str(job.updated_at) if job.updated_at else None,
        started_at=job.started_at.isoformat() if job.started_at and hasattr(job.started_at, "isoformat") else str(job.started_at) if job.started_at else None,
        completed_at=job.completed_at.isoformat() if job.completed_at and hasattr(job.completed_at, "isoformat") else str(job.completed_at) if job.completed_at else None,
        error_message=job.error_message,
        file_paths=list(job.file_paths),
        output_files=list(job.output_files or []),
        output_file_refs=output_file_refs or [],
        output_root_dir=job.output_root_dir,
        progress_detail=_build_progress_response(job.get_progress()),
        task_plan_summary=_build_task_plan_summary(job),
        diagnostics=_build_diagnostics(job),
        result_summary=job.result_summary,
        config=_serialize_config(job),
        active_worker=_is_active_worker(job.id),
    )


def _job_to_summary_response(job: TranslationJob) -> JobSummaryResponse:
    """Lightweight summary — no file_paths, config, diagnostics, result_summary."""
    return JobSummaryResponse(
        id=job.id,
        status=job.status.value,
        progress=job.progress,
        total_units=job.total_units,
        completed_units=job.completed_units,
        failed_units=job.failed_units,
        cached_units=job.cached_units,
        current_batch_index=job.current_batch_index,
        total_batches=job.total_batches,
        updated_at=job.updated_at.isoformat() if job.updated_at and hasattr(job.updated_at, "isoformat") else str(job.updated_at) if job.updated_at else None,
        completed_at=job.completed_at.isoformat() if job.completed_at and hasattr(job.completed_at, "isoformat") else str(job.completed_at) if job.completed_at else None,
        active_worker=_is_active_worker(job.id),
        error_message=job.error_message,
    )


def _handle_job_manager_error(manager_error: JobManagerError):
    """Convert a JobManagerError to an APIError.

    JobManagerError already carries code/message/status_code.
    """
    raise APIError(
        code=manager_error.code,
        message=manager_error.message,
        status_code=manager_error.status_code,
    )


# ---------------------------------------------------------------------------
# Background execution helpers
# ---------------------------------------------------------------------------


def _run_execution_in_thread(svcs: Services, job_id: str) -> None:
    """Target function for background execution thread.

    Emits JOB_STARTED trace, runs execute_until_paused_or_done,
    and handles exceptions by marking the job as FAILED.
    """
    try:
        # Emit JOB_STARTED trace event
        job = svcs.jobs.get_job(job_id)
        if job and svcs.trace:
            plan = getattr(job, "task_plan", None)
            total_batches = len(plan.tasks) if plan and hasattr(plan, "tasks") else 0
            provider = ""
            model = ""
            if job.config:
                if isinstance(job.config, dict):
                    runtime = job.config.get("runtime", {})
                    if isinstance(runtime, dict):
                        provider = runtime.get("provider", "") or ""
                        model = runtime.get("model", "") or ""
                elif hasattr(job.config, "runtime"):
                    provider = job.config.runtime.provider or ""
                    model = job.config.runtime.model or ""
            svcs.trace.add_event(
                event_type=TraceEventType.JOB_STARTED,
                job_id=job_id,
                message=f"Job {job_id} started",
                data={
                    "file_paths": list(job.file_paths) if job.file_paths else [],
                    "total_batches": total_batches,
                    "provider": provider,
                    "model": model,
                },
            )

        # Execute all batches
        svcs.execution.execute_until_paused_or_done(job_id)
    except Exception as exc:
        logger.exception("Background execution failed for job %s", job_id)
        try:
            job = svcs.jobs.get_job(job_id)
            if job:
                from translator_app.jobs.models import JobStatus
                job.update_status(JobStatus.FAILED)
                job.error_message = str(exc)
                # Sync progress from any 99.9% cap applied by COUNTERS_SATURATED
                # before the failure occurred.
                job._sync_progress_percent()
                job.diagnostics.append(JobDiagnostic(
                    level="error",
                    code="EXECUTION_FAILED",
                    message=f"Execution thread failed: {exc}",
                    details={"error_type": type(exc).__name__},
                ))
                if svcs.trace:
                    svcs.trace.add_event(
                        event_type=TraceEventType.JOB_FAILED,
                        job_id=job_id,
                        message=f"Job {job_id} failed: {exc}",
                        data={"error": str(exc), "error_type": type(exc).__name__},
                    )
        except Exception as inner:
            logger.exception("Failed to mark job %s as FAILED: %s", job_id, inner)
    finally:
        with _active_executions_lock:
            _active_executions.pop(job_id, None)


def _start_background_execution(svcs: Services, job_id: str) -> bool:
    """Start a background thread for job execution.

    Returns True if thread was started, False if already running.
    """
    with _active_executions_lock:
        existing = _active_executions.get(job_id)
        if existing and existing.is_alive():
            logger.warning("Job %s already has an active execution thread", job_id)
            return False
        thread = threading.Thread(
            target=_run_execution_in_thread,
            args=(svcs, job_id),
            daemon=True,
            name=f"job-exec-{job_id[:8]}",
        )
        _active_executions[job_id] = thread
        thread.start()
        # Invariant check: verify thread actually started
        if not thread.is_alive():
            _active_executions.pop(job_id, None)
            logger.error("Failed to start execution thread for job %s", job_id)
            return False
        return True


def _is_active_worker(job_id: str) -> bool:
    """Check whether a background execution thread is active for *job_id*."""
    with _active_executions_lock:
        thread = _active_executions.get(job_id)
        if thread and thread.is_alive():
            return True
        if job_id in _active_executions:
            _active_executions.pop(job_id, None)
        return False


def _enrich_job_with_worker_diagnostic(job: TranslationJob, svcs: Services) -> None:
    """If job is RUNNING but has no active worker, add a warning diagnostic."""
    if job.status == JobStatus.RUNNING and not _is_active_worker(job.id):
        has_existing = any(
            d.code == "NO_ACTIVE_WORKER" for d in (job.diagnostics or [])
        )
        if not has_existing:
            job.diagnostics.append(JobDiagnostic(
                level="warning",
                code="NO_ACTIVE_WORKER",
                message="Job is marked as running, but no active worker is executing it.",
            ))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[JobResponse])
def list_jobs(status: Optional[str] = None, svcs: Services = Depends(get_services)):
    """List all translation jobs, optionally filtered by status."""
    status_filter = None
    if status:
        try:
            status_filter = JobStatus(status)
        except ValueError:
            raise APIError(
                code=INVALID_REQUEST,
                message=f"Invalid job status: {status}",
            )
    jobs = svcs.jobs.list_jobs(status_filter)
    # Enrich all running jobs with worker diagnostic
    for j in jobs:
        _enrich_job_with_worker_diagnostic(j, svcs)
    # Batch-load output file refs to avoid N+1 queries
    job_ids = [j.id for j in jobs]
    refs_map = _build_output_file_refs_batch(svcs, job_ids)
    return [_job_to_response(j, output_file_refs=refs_map.get(j.id)) for j in jobs]


@router.get("/active-executions")
def list_active_executions():
    """List currently active execution threads (diagnostic)."""
    with _active_executions_lock:
        active_ids = [
            jid for jid, t in _active_executions.items() if t.is_alive()
        ]
        return {
            "active_count": len(active_ids),
            "active_job_ids": active_ids,
        }


@router.get("/summary", response_model=dict)
def list_jobs_summary(svcs: Services = Depends(get_services)):
    """Lightweight job summaries for progress polling.

    Returns only progress/status fields — no file_paths, config,
    diagnostics, result_summary, or trace events.
    """
    jobs = svcs.jobs.list_jobs()
    # Enrich running jobs with worker diagnostic (side-effect on domain obj only)
    for j in jobs:
        _enrich_job_with_worker_diagnostic(j, svcs)
    return {"jobs": [_job_to_summary_response(j) for j in jobs]}


@router.post("", response_model=JobResponse, status_code=201)
def create_job(body: CreateJobRequest, svcs: Services = Depends(get_services)):
    """Create a new translation job.

    If a config dict is provided, it will be passed to the
    TaskPlanner to build the task plan.

    When ``use_draft_selection`` is ``True`` and ``file_paths`` is empty,
    the handler fills ``file_paths`` and ``file_metadata`` from the backend
    draft selection state and then clears the draft.
    """
    # --- Draft selection fallback ---
    if body.use_draft_selection and not body.file_paths:
        draft_files = svcs.draft_selection.files
        if not draft_files:
            raise APIError(
                code=INVALID_REQUEST,
                message="use_draft_selection=True but draft selection is empty. "
                        "Add files to the draft first.",
            )
        # Fill file_paths and file_metadata from draft state
        body_dict = body.model_dump()
        body_dict["file_paths"] = draft_files
        # Convert draft metadata to FileJobMetadata objects
        draft_meta = svcs.draft_selection.file_metadata
        if draft_meta:
            from translator_app.backend.schemas.jobs import FileJobMetadata
            file_meta = {}
            for fpath, meta in draft_meta.items():
                file_meta[fpath] = FileJobMetadata(
                    mod_id=meta.get("mod_id"),
                    mod_name=meta.get("mod_name"),
                )
            body_dict["file_metadata"] = file_meta
        body = CreateJobRequest(**body_dict)

    if not body.file_paths:
        raise APIError(
            code=INVALID_REQUEST,
            message="At least one file_path is required",
        )

    # --- Canonicalise file_paths and re-key file_metadata ---
    # Identity contract: all paths used as identity keys must be canonical
    # (resolved symlinks, normalised ``..``, absolute).  Relative paths are
    # preserved as-is for backward compatibility.
    canonical_paths: List[str] = []
    seen: set[str] = set()
    metadata_key_map: dict[str, str] = {}  # original_key -> canonical_key
    for p in body.file_paths:
        cp = canonicalize_path(p) if os.path.isabs(p) else p
        metadata_key_map[p] = cp
        if cp not in seen:
            seen.add(cp)
            canonical_paths.append(cp)

    # Re-key file_metadata to use canonical paths, merging values when
    # multiple original keys resolve to the same canonical path.
    canonical_metadata: dict[str, dict[str, Any]] = {}
    if body.file_metadata:
        for orig_key, meta in body.file_metadata.items():
            ck = metadata_key_map.get(
                orig_key,
                canonicalize_path(orig_key) if os.path.isabs(orig_key) else orig_key,
            )
            # Merge: prefer first-encountered metadata for duplicates
            if ck not in canonical_metadata:
                meta_dict = {}
                if meta.mod_id:
                    meta_dict["mod_id"] = meta.mod_id
                if meta.mod_name:
                    meta_dict["mod_name"] = meta.mod_name
                if meta.source_root:
                    meta_dict["source_root"] = meta.source_root
                if meta.group:
                    meta_dict["group"] = meta.group
                canonical_metadata[ck] = meta_dict

    # Use canonicalised paths and metadata from here on
    norm_file_paths = canonical_paths
    norm_file_metadata = canonical_metadata

    # Resolve priority
    try:
        priority = JobPriority(body.priority)
    except ValueError:
        priority = JobPriority.NORMAL

    # Resolve config
    config = None
    if body.config is not None:
        # Build a TranslationConfig from the provided dict
        config = _build_config(svcs, body.config)

    # Build a TaskPlanner so the job gets a task plan at creation time
    planner = None
    if config is not None:
        pf = svcs.protection.compute_protection_fingerprint(
            rule_set_ids=config.protection.rule_set_ids,
        )
        planner = TaskPlanner(
            config=config,
            file_service=svcs.file_processing,
            cache=svcs.cache,
            protection_fingerprint=pf,
        )

    try:
        job = svcs.jobs.create_job(
            file_paths=norm_file_paths,
            config=config,
            autostart=body.autostart,
            name=body.name,
            priority=priority,
            planner=planner,
            file_metadata=norm_file_metadata,
        )

        # Set up context on the persistence service for manifest registration.
        try:
            pers = svcs.output_persistence
            if pers is not None:
                game_id = getattr(config, "game", "") if config else ""

                if norm_file_metadata:
                    # Per-file mod context (multi-mod support).
                    pers.set_job_file_contexts(job.id, norm_file_metadata)

                    # Also set base job context (name, roots, game — no mod data).
                    pers.set_job_context(
                        job_id=job.id,
                        job_name=job.name,
                        game_id=game_id,
                    )
                elif body.mod_id is not None:
                    # Legacy fallback: single mod for the whole job.
                    pers.set_job_context(
                        job_id=job.id,
                        job_name=job.name,
                        game_id=game_id,
                        mod_id=body.mod_id,
                        mod_name=body.mod_name or body.mod_id,
                    )
        except Exception:
            logger.warning(
                "Failed to set mod context on persistence for job %s",
                job.id, exc_info=True,
            )
    except JobManagerError as e:
        _handle_job_manager_error(e)

    # Diagnostic: if file_paths were provided but no units found
    if job.total_units == 0 and norm_file_paths:
        job.diagnostics.append(JobDiagnostic(
            level="warning",
            code="NO_TRANSLATION_UNITS_FOUND",
            message="No translatable units found. Check file format, language header, or selected files.",
            details={
                "file_paths_count": len(norm_file_paths),
                "file_paths": list(norm_file_paths),
            },
        ))

    # If autostart, begin background execution
    if body.autostart and job.status == JobStatus.RUNNING:
        if job.task_plan is not None and job.task_plan.tasks:
            _start_background_execution(svcs, job.id)

    # Clear the draft job selection — the files have been consumed
    # to create this job.  Safe no-op if draft is already empty.
    try:
        svcs.draft_selection.clear()
    except Exception:
        logger.debug("Failed to clear draft selection", exc_info=True)

    refs = _build_output_file_refs(svcs, job.id)
    return _job_to_response(job, output_file_refs=refs)


@router.get("/{job_id}", response_model=JobResponse)
def get_job(job_id: str, svcs: Services = Depends(get_services)):
    """Get details of a specific translation job."""
    try:
        job = svcs.jobs.get_job(job_id)
    except JobManagerError as e:
        _handle_job_manager_error(e)
    if not job:
        raise APIError(
            code=JOB_NOT_FOUND,
            message=f"Job not found: {job_id}",
            status_code=404,
        )
    # Enrich with worker diagnostic for stuck detection
    _enrich_job_with_worker_diagnostic(job, svcs)
    refs = _build_output_file_refs(svcs, job.id)
    return _job_to_response(job, output_file_refs=refs)


@router.post("/{job_id}/start", response_model=JobActionResponse)
def start_job(job_id: str, svcs: Services = Depends(get_services)):
    """Start a pending translation job and begin background execution."""
    try:
        job = svcs.jobs.start_job(job_id)
    except JobManagerError as e:
        _handle_job_manager_error(e)

    refs = _build_output_file_refs(svcs, job.id)

    # If job has no task plan or no tasks, it completes immediately
    if job.task_plan is None or not job.task_plan.tasks:
        try:
            job.update_status(JobStatus.COMPLETED)
            svcs.jobs._repo.save(job)
        except ValueError:
            pass
        return JobActionResponse(
            success=True,
            job=_job_to_response(job, output_file_refs=refs),
            message="Job started (no tasks to execute)",
        )

    # Start background execution
    started = _start_background_execution(svcs, job_id)
    if not started:
        # Invariant: thread must be alive for running job
        try:
            job.update_status(JobStatus.FAILED)
            job.error_message = "Failed to start background execution worker"
        except ValueError:
            pass
        return JobActionResponse(
            success=False,
            job=_job_to_response(job, output_file_refs=refs),
            message="Failed to start background execution",
        )

    return JobActionResponse(
        success=True,
        job=_job_to_response(job, output_file_refs=refs),
        message="Job started",
    )


@router.post("/{job_id}/pause", response_model=JobActionResponse)
def pause_job(job_id: str, svcs: Services = Depends(get_services)):
    """Pause a running translation job."""
    try:
        job = svcs.jobs.pause_job(job_id)
    except JobManagerError as e:
        _handle_job_manager_error(e)
    refs = _build_output_file_refs(svcs, job.id)
    return JobActionResponse(
        success=True,
        job=_job_to_response(job, output_file_refs=refs),
        message="Job paused",
    )


@router.post("/{job_id}/resume", response_model=JobActionResponse)
def resume_job(job_id: str, svcs: Services = Depends(get_services)):
    """Resume a paused translation job and begin background execution."""
    try:
        job = svcs.jobs.resume_job(job_id)
    except JobManagerError as e:
        _handle_job_manager_error(e)

    refs = _build_output_file_refs(svcs, job.id)

    # Start background execution
    started = _start_background_execution(svcs, job_id)
    if not started:
        try:
            job.update_status(JobStatus.FAILED)
            job.error_message = "Failed to start background execution worker"
        except ValueError:
            pass
        return JobActionResponse(
            success=False,
            job=_job_to_response(job, output_file_refs=refs),
            message="Failed to start background execution",
        )

    return JobActionResponse(
        success=True,
        job=_job_to_response(job, output_file_refs=refs),
        message="Job resumed",
    )


@router.post("/{job_id}/cancel", response_model=JobActionResponse)
def cancel_job(job_id: str, svcs: Services = Depends(get_services)):
    """Cancel a translation job.

    Sets the status to CANCELLED via JobManager and signals the
    cooperative cancellation event so the background execution
    thread does not save results after a cancel.
    """
    try:
        job = svcs.jobs.cancel_job(job_id)
    except JobManagerError as e:
        _handle_job_manager_error(e)
    # P1-03: signal the cooperative cancellation event so the
    # background thread stops at the next check point.
    svcs.execution.cancel_execution(job_id)
    refs = _build_output_file_refs(svcs, job.id)
    return JobActionResponse(
        success=True,
        job=_job_to_response(job, output_file_refs=refs),
        message="Job cancelled",
    )


@router.post("/{job_id}/restart", response_model=JobActionResponse)
def restart_job(job_id: str, svcs: Services = Depends(get_services)):
    """Create a new job that is a full rerun of *job_id*.

    Unlike ``retry-failed`` (which only retries failed units), this endpoint:
    * Creates a completely fresh job with the same file paths and config
    * Preserves the source job's ``use_cache`` setting — if the source used
      cache, the restart will also use cache
    * Re-parses all source files and builds a brand new task plan
    * Names the new job ``"<parent name> (restart)"``
    """
    # Validate source job exists
    try:
        source_job = svcs.jobs.get_job(job_id)
    except JobManagerError as e:
        _handle_job_manager_error(e)
    if not source_job:
        raise APIError(
            code=JOB_NOT_FOUND,
            message=f"Job not found: {job_id}",
            status_code=404,
        )

    # Build config + TaskPlanner for the restart job (preserves source use_cache)
    config = source_job.config
    planner = None
    if config is not None:
        if isinstance(config, dict):
            config_obj = _build_config(svcs, config)
        else:
            config_obj = config
        # NOTE: Do NOT force use_cache=False — preserve source job's setting
        pf = svcs.protection.compute_protection_fingerprint(
            rule_set_ids=config_obj.protection.rule_set_ids,
        )
        planner = TaskPlanner(
            config=config_obj,
            file_service=svcs.file_processing,
            cache=svcs.cache,
            protection_fingerprint=pf,
        )
    else:
        config_obj = None

    try:
        restart_job_obj = svcs.jobs.create_restart_job(
            source_job_id=job_id,
            config=config_obj,
            autostart=False,
            planner=planner,
        )
    except JobManagerError as e:
        _handle_job_manager_error(e)

    # Start background execution for the restart job
    if restart_job_obj.task_plan is not None and restart_job_obj.task_plan.tasks:
        try:
            svcs.jobs.start_job(restart_job_obj.id)
        except JobManagerError as e:
            _handle_job_manager_error(e)
        _start_background_execution(svcs, restart_job_obj.id)
    else:
        # If somehow no tasks were created (e.g. empty files), mark as completed
        try:
            restart_job_obj.update_status(JobStatus.COMPLETED)
            svcs.jobs._repo.save(restart_job_obj)
        except ValueError:
            pass

    refs = _build_output_file_refs(svcs, restart_job_obj.id)
    return JobActionResponse(
        success=True,
        job=_job_to_response(restart_job_obj, output_file_refs=refs),
        message=f"Restart job created for {job_id} with {restart_job_obj.total_units} units",
    )


@router.post("/{job_id}/retry-failed", response_model=JobActionResponse)
def retry_failed_job(job_id: str, svcs: Services = Depends(get_services)):
    """Create a new job that retries only the failed units of *job_id*.

    Unlike restart (full rerun), this endpoint:
    * Fetches only the failed units from the source job
    * Creates a new job with a task_plan containing only those units
    * Sets ``source_job_id`` to link back to the parent job
    * Names the new job ``"<parent name> (retry failed)"``

    Raises ``NO_FAILED_UNITS`` if the source job has zero failed units.
    """
    # Validate source job exists
    try:
        source_job = svcs.jobs.get_job(job_id)
    except JobManagerError as e:
        _handle_job_manager_error(e)
    if not source_job:
        raise APIError(
            code=JOB_NOT_FOUND,
            message=f"Job not found: {job_id}",
            status_code=404,
        )

    # Check for failed units
    if source_job.failed_units <= 0:
        raise APIError(
            code=NO_FAILED_UNITS,
            message=f"Job {job_id} has no failed units to retry",
            status_code=400,
        )

    # Get failed units from the job's in-memory units list
    failed_units = [u for u in (source_job.units or []) if getattr(u, 'status', '') == 'failed']

    if not failed_units:
        raise APIError(
            code=NO_FAILED_UNITS,
            message=f"Job {job_id} has {source_job.failed_units} failed count but no failed units found in job units",
            status_code=400,
        )

    # Build config + TaskPlanner for the retry job
    config = source_job.config
    planner = None
    if config is not None:
        if isinstance(config, dict):
            config_obj = _build_config(svcs, config)
        else:
            config_obj = config
        pf = svcs.protection.compute_protection_fingerprint(
            rule_set_ids=config_obj.protection.rule_set_ids,
        )
        planner = TaskPlanner(
            config=config_obj,
            file_service=svcs.file_processing,
            cache=svcs.cache,
            protection_fingerprint=pf,
        )
    else:
        config_obj = None

    try:
        retry_job = svcs.jobs.create_retry_job(
            source_job_id=job_id,
            failed_units=failed_units,
            config=config_obj,
            autostart=False,
            planner=planner,
        )
    except JobManagerError as e:
        _handle_job_manager_error(e)

    # Start background execution for the retry job
    if retry_job.task_plan is not None and retry_job.task_plan.tasks:
        try:
            svcs.jobs.start_job(retry_job.id)
        except JobManagerError as e:
            _handle_job_manager_error(e)
        _start_background_execution(svcs, retry_job.id)

    refs = _build_output_file_refs(svcs, retry_job.id)
    return JobActionResponse(
        success=True,
        job=_job_to_response(retry_job, output_file_refs=refs),
        message=f"Retry job created with {len(failed_units)} failed units from {job_id}",
    )


@router.post("/{job_id}/update-config", response_model=JobActionResponse)
def update_job_config(job_id: str, body: UpdateConfigRequest, svcs: Services = Depends(get_services)):
    """Update config for a pending or paused translation job.

    Cannot change src_lang or dst_lang after job creation.
    Mutable fields: model, prompt, batch_size, protection, validation.
    """
    try:
        job = svcs.jobs.update_job_config(job_id, body.config)
    except JobManagerError as e:
        _handle_job_manager_error(e)
    refs = _build_output_file_refs(svcs, job.id)
    return JobActionResponse(
        success=True,
        job=_job_to_response(job, output_file_refs=refs),
        message="Config updated",
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _build_config(svcs: Services, config_dict: dict) -> object:
    """Build a TranslationConfig from a raw dict using the config builder.

    Extracts the prompt ``profile_name`` from the config dict and passes it
    as ``preset_id`` so that prompt templates (batch_system_prompt,
    batch_user_template, etc.) are populated from the corresponding preset.
    Without this, the templates remain empty and the LLM receives empty
    messages, producing chatbot meta-replies.
    """
    # Extract profile_name from either nested prompt dict or flat key
    prompt_cfg = config_dict.get("prompt", {}) or {}
    preset_id = (
        prompt_cfg.get("profile_name")
        or config_dict.get("prompt_profile")
        or config_dict.get("profile_name")
    )

    # Extract translation_profile_id (profile selection from the UI)
    translation_profile_id = (
        config_dict.get("translation_profile_id")
        or config_dict.get("selectedProfileId")
        or prompt_cfg.get("translation_profile_id")
    )

    builder = svcs.translation_config_builder if hasattr(svcs, "translation_config_builder") else None
    if builder is not None:
        return builder.build_config(
            ui_config=config_dict,
            preset_id=preset_id,
            translation_profile_id=translation_profile_id,
        )
    # Fallback: import and use standalone builder
    from translator_app.translation.config import TranslationConfigBuilder
    from translator_app.translation.prompt_presets import PromptPresetRegistry
    standalone_builder = TranslationConfigBuilder(
        settings_service=svcs.settings,
        secrets_service=svcs.secrets,
        prompt_preset_registry=PromptPresetRegistry(),
        profile_service=getattr(svcs, "translation_profiles", None),
    )
    return standalone_builder.build_config(
        ui_config=config_dict,
        preset_id=preset_id,
        translation_profile_id=translation_profile_id,
    )


# Backward-compatible function exports
list_jobs_handler = list_jobs
get_job_handler = get_job
create_job_handler = create_job
