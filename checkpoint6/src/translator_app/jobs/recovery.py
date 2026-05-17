"""Job recovery after backend restart.

On startup, finds jobs that were left in ``running`` or ``pausing`` status
(the backend crashed or was restarted while they were executing) and
transitions them to ``paused`` with a diagnostic warning so the user can
manually resume.

This is the SINGLE canonical recovery path (P1-05).
"""

import logging
from typing import Optional

from translator_app.jobs.manager import JobManager
from translator_app.jobs.models import JobDiagnostic, JobStatus
from translator_app.translation.trace import TranslationTraceService
from translator_app.translation.trace_models import TraceEventType

logger = logging.getLogger(__name__)

# Diagnostic code and messages
DIAGNOSTIC_CODE = "SERVER_RESTARTED"
DIAGNOSTIC_MESSAGE = (
    "Server restarted while this job was running. "
    "The job was paused and can be resumed."
)
TRACE_MESSAGE = (
    "Job interrupted by server restart. "
    "Status changed to paused \u2014 resume manually to continue."
)

# Statuses that should be recovered to PAUSED on startup
_RECOVERABLE_STATUSES = {JobStatus.RUNNING, JobStatus.PAUSING}


def recover_interrupted_jobs(
    job_manager: JobManager,
    trace_service: Optional[TranslationTraceService] = None,
) -> int:
    """Recover jobs that were running when the server stopped.

    For each recoverable job (RUNNING or PAUSING):
      1. Add a ``SERVER_RESTARTED`` diagnostic warning (unless one already
         exists \u2014 the operation is idempotent).
      2. Transition status to ``PAUSED`` so the user can resume it.
      3. Emit a ``JOB_INTERRUPTED`` trace event if a trace service is
         available.

    Idempotent: jobs that already carry a ``SERVER_RESTARTED`` diagnostic
    are skipped to avoid duplicating warnings on repeated startup.

    Args:
        job_manager: The active ``JobManager`` instance.
        trace_service: Optional ``TranslationTraceService`` for trace events.

    Returns:
        Number of jobs that were recovered.
    """
    recovered_count = 0

    for recoverable_status in _RECOVERABLE_STATUSES:
        jobs = job_manager.list_jobs(recoverable_status)
        for job in jobs:
            # Idempotency guard \u2014 skip if the diagnostic already exists
            if _has_diagnostic(job, DIAGNOSTIC_CODE):
                continue

            prev_status = job.status.value

            # Add diagnostic warning (not a hard error \u2014 no error_message set)
            job.diagnostics.append(
                JobDiagnostic(
                    level="warning",
                    code=DIAGNOSTIC_CODE,
                    message=DIAGNOSTIC_MESSAGE,
                )
            )

            # Transition -> paused (safe: RUNNING->PAUSED and PAUSING->PAUSED
            # are both valid per state machine)
            job.update_status(JobStatus.PAUSED)

            # Persist changes
            job_manager._repo.save(job)  # type: ignore[attr-defined]

            # Emit trace event if available
            if trace_service is not None:
                trace_service.add_event(
                    event_type=TraceEventType.JOB_INTERRUPTED,
                    job_id=job.id,
                    message=TRACE_MESSAGE,
                    data={
                        "previous_status": prev_status,
                        "new_status": "paused",
                        "reason": "server_restart",
                    },
                )

            recovered_count += 1

    if recovered_count > 0:
        logger.info("Recovered %d interrupted running/pausing job(s)", recovered_count)

    return recovered_count


def _has_diagnostic(job, code: str) -> bool:
    """Check whether *job* already has a diagnostic with the given *code*."""
    return any(d.code == code for d in (job.diagnostics or []))
