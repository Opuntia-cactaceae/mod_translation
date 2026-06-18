"""API endpoints for the Translation Trace / Live Debug Module.

Provides read-only (and one delete) endpoints for querying trace events,
snapshots, and aggregated stats for translation jobs.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query

from translator_app.backend.deps import get_services, Services
from translator_app.translation.runtime_raw_log import get_collector
from translator_app.translation.trace_models import (
    TraceEventType,
    TraceUnitEntry,
    TranslationTraceEvent,
    TranslationTraceSnapshot,
    TranslationTraceStats,
)

router = APIRouter(prefix="/api/translation-trace", tags=["translation-trace"])


@router.get("/jobs/{job_id}/events", response_model=list[TranslationTraceEvent])
def get_job_events(
    job_id: str,
    limit: int = Query(100, ge=1, le=1000),
    event_type: Optional[TraceEventType] = None,
    services: Services = Depends(get_services),
):
    """Return trace events for a specific job, optionally filtered by type."""
    return services.trace.get_events(job_id, limit=limit, event_type=event_type)


@router.get("/jobs/{job_id}/snapshot", response_model=TranslationTraceSnapshot)
def get_job_snapshot(
    job_id: str,
    services: Services = Depends(get_services),
):
    """Return a point-in-time snapshot for a job with progress from the job manager.

    P1-05: JobManager is the PRIMARY source for status, progress, and batch
    info. Trace events are used only for current_activity/details.
    Job-derived status always overrides trace-derived status.
    """
    snapshot = services.trace.get_snapshot(job_id)

    # Enrich with job progress data — P1-05: job data is PRIMARY
    job = services.jobs.get_job(job_id)
    if job is not None:
        # Status from JobManager is authoritative
        if job.status:
            snapshot.status = job.status.value

        # Progress counters from JobManager
        # Include cached_units so "0 units translated" doesn't appear when
        # all units were cache hits (e.g. during restart with cache enabled).
        snapshot.processed_units = job.completed_units + job.failed_units + job.cached_units
        snapshot.total_units = job.total_units

        # Batch info from JobManager
        if job.current_batch_index:
            snapshot.current_batch_index = job.current_batch_index
        if job.total_batches:
            snapshot.total_batches = job.total_batches

        # Error message from JobManager
        snapshot.error_message = job.error_message or ""

        # Current activity derived from job status
        status_val = job.status.value if job.status else ""
        if status_val == "running" and job.total_batches > 0:
            snapshot.current_activity = (
                f"Translating batch {job.current_batch_index}/{job.total_batches}"
            )
        elif status_val == "paused":
            snapshot.current_activity = (
                f"Paused (batch {job.current_batch_index}/{job.total_batches})"
            )
        elif status_val == "completed":
            snapshot.current_activity = "Completed"
        elif status_val == "failed":
            snapshot.current_activity = job.error_message or "Failed"
        elif status_val == "cancelled":
            snapshot.current_activity = "Cancelled"
        elif status_val == "pending":
            snapshot.current_activity = "Pending"

    return snapshot


@router.get("/jobs/{job_id}/stats", response_model=TranslationTraceStats)
def get_job_stats(
    job_id: str,
    services: Services = Depends(get_services),
):
    """Return aggregated stats for a job."""
    return services.trace.get_stats(job_id)


@router.delete("/jobs/{job_id}")
def clear_job_events(
    job_id: str,
    services: Services = Depends(get_services),
):
    """Clear all trace events for a specific job."""
    services.trace.clear(job_id)
    return {"success": True, "message": f"Trace events cleared for job {job_id}"}


@router.get("/recent", response_model=list[TranslationTraceEvent])
def get_recent_events(
    limit: int = Query(100, ge=1, le=1000),
    services: Services = Depends(get_services),
):
    """Return the most recent trace events across all jobs."""
    return services.trace.get_recent(limit=limit)


@router.get("/jobs/{job_id}/units", response_model=list[TraceUnitEntry])
def get_job_trace_units(
    job_id: str,
    limit: int = Query(50, ge=1, le=500),
    services: Services = Depends(get_services),
):
    """Return per-unit trace entries (source/translated pairs) for a job.

    Units are returned newest-first, capped by ``limit``.
    Each entry contains:
    - source_text / translated_text
    - status (sent, translated, failed, cached)
    - file_path / key
    - error_message (if failed)
    """
    return services.trace.get_units(job_id, limit=limit)


@router.get("/jobs/{job_id}/batches/{batch_no}/units", response_model=list[TraceUnitEntry])
def get_job_batch_units(
    job_id: str,
    batch_no: int,
    limit: int = Query(500, ge=1, le=1000),
    services: Services = Depends(get_services),
):
    """Return trace units for a specific batch within a job.

    ``batch_no`` must match the ``batch_index`` stored on the units
    (1-based, matching the BATCH COMPLETED event's batch_index).
    """
    return services.trace.get_units_by_batch(job_id, batch_index=batch_no, limit=limit)


@router.get("/jobs/{job_id}/runtime-events", response_model=list[TranslationTraceEvent])
def get_job_runtime_events(
    job_id: str,
    limit: int = Query(100, ge=1, le=500),
    services: Services = Depends(get_services),
):
    """Return runtime-status-related trace events for a job.

    Includes: API requests, responses, retries, fallbacks, cache hits/misses.
    Note: the default frontend UI no longer depends on this endpoint;
    the Job log uses GET /events instead to show all job events.
    """
    return services.trace.get_runtime_events(job_id, limit=limit)


@router.get("/jobs/{job_id}/runtime-raw-log")
def get_job_runtime_raw_log(
    job_id: str,
    services: Services = Depends(get_services),
):
    """Return live in-memory raw runtime log lines for a job.

    These are ephemeral lines captured from the httpx/urllib logger
    during job execution (e.g. "HTTP Request: POST …", "Retrying …").
    They are **never persisted** and are **lost on backend restart**.

    Response::

        {
            "job_id": "...",
            "lines": [
                {"ts": "…", "level": "INFO", "message": "HTTP Request: POST …"}
            ],
            "count": 3
        }
    """
    collector = get_collector()
    lines = collector.get_lines(job_id)
    return {
        "job_id": job_id,
        "lines": lines,
        "count": len(lines),
    }
