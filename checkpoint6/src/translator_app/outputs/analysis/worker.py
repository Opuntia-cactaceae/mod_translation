"""In-process background worker for async analysis jobs.

Architecture
------------
A single daemon thread reads job IDs from a ``queue.Queue`` and
processes them one at a time.  On application startup the worker
re-queues any non-terminal jobs (queued or running) so they can be
retried after a crash/restart.

Thread safety
-------------
The worker calls ``OutputAnalysisJobService`` and ``OutputAnalysisService``
which in turn hold their own database locks.  No additional synchronisation
is needed here.

Cancellation
------------
After each file is processed the worker checks the ``cancel_requested``
flag via the repository.  If set, it marks the job as cancelled and
stops processing further files.
"""

import json
import logging
import queue
import threading
from datetime import datetime, timezone
from typing import List, Optional

from translator_app.outputs.analysis.jobs import (
    OutputAnalysisJob,
    OutputAnalysisJobStatus,
)
from translator_app.outputs.analysis.job_repository import AnalysisJobRepository
from translator_app.outputs.analysis.job_service import OutputAnalysisJobService
from translator_app.outputs.analysis.service import OutputAnalysisService
from translator_app.outputs.models import TranslatedOutputFile

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class OutputAnalysisWorker:
    """In-process background thread that processes analysis jobs."""

    def __init__(
        self,
        job_service: OutputAnalysisJobService,
        job_repository: AnalysisJobRepository,
        analysis_service: OutputAnalysisService,
    ):
        self._job_service = job_service
        self._job_repo = job_repository
        self._analysis_service = analysis_service
        self._queue: queue.Queue[str] = queue.Queue()
        self._thread: Optional[threading.Thread] = None
        self._stopped = threading.Event()
        self._pending_jobs: set[str] = set()
        self._pending_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def is_alive(self) -> bool:
        """Return True if the worker thread is alive and accepting jobs."""
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        """Start the background worker thread."""
        if self.is_alive():
            logger.warning("OutputAnalysisWorker already running")
            return

        self._stopped.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            name="output-analysis-worker",
            daemon=True,
        )
        self._thread.start()
        logger.info("OutputAnalysisWorker started")

    def stop(self, timeout: float = 5.0) -> None:
        """Signal the worker to stop and wait for the thread to finish."""
        self._stopped.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=timeout)
            logger.info("OutputAnalysisWorker stopped")

    def submit(self, job_id: str) -> None:
        """Submit a job ID to the work queue.

        If the job ID is already pending or running in this worker,
        the duplicate submission is silently skipped.
        """
        with self._pending_lock:
            if job_id in self._pending_jobs:
                logger.debug("Analysis job %s already pending/running, skipping duplicate submit", job_id)
                return
            self._pending_jobs.add(job_id)
        self._queue.put_nowait(job_id)

    def requeue_existing(self) -> int:
        """Re-queue any non-terminal jobs found in the database.

        Should be called on application startup.
        """
        count = self._job_repo.requeue_non_terminal()
        if count > 0:
            logger.info("Re-queued %d non-terminal analysis job(s)", count)
            # Enqueue all requeued jobs
            jobs = self._job_repo.list(status=OutputAnalysisJobStatus.QUEUED.value)
            for job in jobs:
                self.submit(job.id)
        return count

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _run_loop(self) -> None:
        """Main worker loop: pulls jobs from queue and processes them."""
        while not self._stopped.is_set():
            try:
                job_id = self._queue.get(timeout=2.0)
            except queue.Empty:
                continue

            try:
                self.run_job(job_id)
            except Exception:
                logger.exception("Fatal error processing analysis job %s", job_id)
                try:
                    self._job_repo.mark_failed(
                        job_id,
                        "Fatal worker error",
                        _now(),
                    )
                except Exception:
                    logger.exception(
                        "Failed to mark job %s as failed", job_id
                    )
            finally:
                self._queue.task_done()
                with self._pending_lock:
                    self._pending_jobs.discard(job_id)

    def run_job(self, job_id: str) -> None:
        """Execute a single analysis job.

        1. Load the job from the repository.
        2. Resolve scope into the list of output files.
        3. Mark the job as running with the total file count.
        4. Process each file, updating progress after each one.
        5. Check for cancellation between files.
        6. Mark the job as completed (or cancelled/failed).
        """
        job = self._job_repo.get(job_id)
        if job is None:
            logger.warning("Analysis job %s not found, skipping", job_id)
            return

        # If already terminal, skip
        if job.is_terminal:
            return

        # Resolve scope into files
        try:
            files = self._resolve_scope(job)
        except Exception as exc:
            logger.exception("Failed to resolve scope for job %s", job_id)
            self._job_repo.mark_failed(job_id, f"Scope resolution failed: {exc}", _now())
            return

        checks: List[str] = json.loads(job.checks_json) if job.checks_json else ["compilability", "placeholders"]
        only_stale = self._get_only_stale(job)

        # Filter stale if needed
        if only_stale:
            stale_files = [
                f for f in files
                if f.analysis_stale or f.latest_analysis is None
            ]
            skipped = len(files) - len(stale_files)
            files = stale_files
        else:
            skipped = 0

        total = len(files)

        # Mark running
        now = _now()
        self._job_repo.mark_running(job_id, now, total)
        if skipped > 0:
            self._job_repo.update_progress(
                job_id,
                processed_delta=0,
                skipped_delta=skipped,
            )

        # Process each file
        for idx, f in enumerate(files):
            # Check cancellation
            if self._job_repo.is_cancel_requested(job_id):
                self._job_repo.mark_cancelled(job_id, _now())
                logger.info("Analysis job %s cancelled after %d/%d files", job_id, idx, total)
                return

            try:
                result = self._analysis_service.analyze_file(
                    output_file_id=f.id,
                    checks=checks,
                    save=True,
                )
                status_delta = {"passed": 0, "warning": 0, "failed": 0, "error": 0}
                status_name = result.status.value if hasattr(result.status, "value") else str(result.status)
                if status_name in status_delta:
                    status_delta[status_name] = 1
                else:
                    logger.warning(
                        "Unknown analysis status '%s' for file %s in job %s, mapped to error_count",
                        status_name, f.id, job_id,
                    )
                    status_delta["error"] = 1
                self._job_repo.update_progress(
                    job_id,
                    processed_delta=1,
                    status_counts_delta=status_delta,
                )
            except Exception as exc:
                logger.exception("Analysis failed for file %s in job %s", f.id, job_id)
                self._job_repo.update_progress(
                    job_id,
                    processed_delta=1,
                    status_counts_delta={"error": 1},
                )

        # Mark completed
        self._job_repo.mark_completed(job_id, _now())
        logger.info("Analysis job %s completed (%d files)", job_id, total)

    # ------------------------------------------------------------------
    # Scope resolution
    # ------------------------------------------------------------------

    def _resolve_scope(self, job: OutputAnalysisJob) -> List[TranslatedOutputFile]:
        """Resolve the job's scope into a list of output files."""
        scope = json.loads(job.scope_json)
        scope_type = job.scope_type
        analysis_repo = self._analysis_service._repo  # noqa: SLF001

        if scope_type == "selected":
            file_ids = scope.get("output_file_ids", [])
            files: List[TranslatedOutputFile] = []
            for fid in file_ids:
                f = analysis_repo.get_by_id(fid)
                if f:
                    files.append(f)
            return files
        else:
            return list(
                analysis_repo.list_files(
                    job_id=scope.get("job_id"),
                    mod_id=scope.get("mod_id"),
                    group_key=scope.get("group_key"),
                    limit=10000,
                )
            )

    @staticmethod
    def _get_only_stale(job: OutputAnalysisJob) -> bool:
        try:
            scope = json.loads(job.scope_json)
            return scope.get("only_stale", False)
        except (json.JSONDecodeError, AttributeError):
            return False
