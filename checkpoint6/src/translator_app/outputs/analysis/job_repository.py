"""Repository for async output analysis jobs."""

import json
import threading
from datetime import datetime, timezone
from typing import Dict, List, Optional

from translator_app.outputs.analysis.jobs import OutputAnalysisJob, OutputAnalysisJobStatus
from translator_app.storage.db import DatabaseService


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AnalysisJobRepository:
    """SQLite-backed repository for ``output_analysis_jobs``.

    Thread-safe: all public mutations are serialized via ``_lock``.
    """

    def __init__(self, db: DatabaseService):
        self.db = db
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def create(self, job: OutputAnalysisJob) -> OutputAnalysisJob:
        """Insert a new analysis job."""
        with self._lock:
            conn = self.db.connect()
            conn.execute(
                """INSERT INTO output_analysis_jobs
                   (id, scope_type, scope_json, checks_json, status,
                    total_count, processed_count, skipped_count,
                    passed_count, warning_count, failed_count, error_count,
                    created_at, started_at, finished_at,
                    cancel_requested, error_message)
                   VALUES (?, ?, ?, ?, ?,
                           ?, ?, ?,
                           ?, ?, ?, ?,
                           ?, ?, ?,
                           ?, ?)""",
                (
                    job.id,
                    job.scope_type,
                    job.scope_json,
                    job.checks_json,
                    job.status,
                    job.total_count,
                    job.processed_count,
                    job.skipped_count,
                    job.passed_count,
                    job.warning_count,
                    job.failed_count,
                    job.error_count,
                    job.created_at,
                    job.started_at,
                    job.finished_at,
                    1 if job.cancel_requested else 0,
                    job.error_message,
                ),
            )
            conn.commit()
            return job

    def get(self, job_id: str) -> Optional[OutputAnalysisJob]:
        """Get an analysis job by id."""
        conn = self.db.connect()
        row = conn.execute(
            "SELECT * FROM output_analysis_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        if not row:
            return None
        return self._row_to_job(row)

    def list(
        self,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[OutputAnalysisJob]:
        """List analysis jobs, optionally filtered by status."""
        conn = self.db.connect()
        if status is not None:
            rows = conn.execute(
                """SELECT * FROM output_analysis_jobs
                   WHERE status = ?
                   ORDER BY created_at DESC
                   LIMIT ? OFFSET ?""",
                (status, limit, offset),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM output_analysis_jobs
                   ORDER BY created_at DESC
                   LIMIT ? OFFSET ?""",
                (limit, offset),
            ).fetchall()
        return [self._row_to_job(r) for r in rows]

    def count(
        self,
        status: Optional[str] = None,
    ) -> int:
        """Count analysis jobs, optionally filtered by status."""
        conn = self.db.connect()
        if status is not None:
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM output_analysis_jobs WHERE status = ?",
                (status,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM output_analysis_jobs",
            ).fetchone()
        return row["cnt"] if row else 0

    # ------------------------------------------------------------------
    # Status transitions
    # ------------------------------------------------------------------

    def mark_running(
        self, job_id: str, started_at: str, total_count: int
    ) -> None:
        """Mark a job as running, set started_at and total_count."""
        with self._lock:
            conn = self.db.connect()
            conn.execute(
                """UPDATE output_analysis_jobs
                   SET status = ?, started_at = ?, total_count = ?
                   WHERE id = ?""",
                (OutputAnalysisJobStatus.RUNNING.value, started_at, total_count, job_id),
            )
            conn.commit()

    def update_progress(
        self,
        job_id: str,
        processed_delta: int = 1,
        skipped_delta: int = 0,
        status_counts_delta: Optional[Dict[str, int]] = None,
    ) -> None:
        """Increment progress counters for a running job."""
        if status_counts_delta is None:
            status_counts_delta = {}
        with self._lock:
            conn = self.db.connect()
            conn.execute(
                """UPDATE output_analysis_jobs
                   SET processed_count = processed_count + ?,
                       skipped_count = skipped_count + ?,
                       passed_count = passed_count + COALESCE(?, 0),
                       warning_count = warning_count + COALESCE(?, 0),
                       failed_count = failed_count + COALESCE(?, 0),
                       error_count = error_count + COALESCE(?, 0)
                   WHERE id = ?""",
                (
                    processed_delta,
                    skipped_delta,
                    status_counts_delta.get("passed", 0),
                    status_counts_delta.get("warning", 0),
                    status_counts_delta.get("failed", 0),
                    status_counts_delta.get("error", 0),
                    job_id,
                ),
            )
            conn.commit()

    def mark_completed(self, job_id: str, finished_at: str) -> None:
        """Mark a job as completed."""
        with self._lock:
            conn = self.db.connect()
            conn.execute(
                """UPDATE output_analysis_jobs
                   SET status = ?, finished_at = ?
                   WHERE id = ?""",
                (OutputAnalysisJobStatus.COMPLETED.value, finished_at, job_id),
            )
            conn.commit()

    def mark_failed(
        self, job_id: str, error_message: str, finished_at: str
    ) -> None:
        """Mark a job as failed with an error message."""
        with self._lock:
            conn = self.db.connect()
            conn.execute(
                """UPDATE output_analysis_jobs
                   SET status = ?, error_message = ?, finished_at = ?
                   WHERE id = ?""",
                (OutputAnalysisJobStatus.FAILED.value, error_message, finished_at, job_id),
            )
            conn.commit()

    # ------------------------------------------------------------------
    # Cancellation
    # ------------------------------------------------------------------

    def request_cancel(self, job_id: str) -> None:
        """Set cancel_requested flag on a job."""
        with self._lock:
            conn = self.db.connect()
            conn.execute(
                """UPDATE output_analysis_jobs
                   SET cancel_requested = 1
                   WHERE id = ?""",
                (job_id,),
            )
            conn.commit()

    def mark_cancelled(self, job_id: str, finished_at: str) -> None:
        """Mark a job as cancelled."""
        with self._lock:
            conn = self.db.connect()
            conn.execute(
                """UPDATE output_analysis_jobs
                   SET status = ?, finished_at = ?
                   WHERE id = ?""",
                (OutputAnalysisJobStatus.CANCELLED.value, finished_at, job_id),
            )
            conn.commit()

    def is_cancel_requested(self, job_id: str) -> bool:
        """Check if cancellation has been requested for a job."""
        conn = self.db.connect()
        row = conn.execute(
            "SELECT cancel_requested FROM output_analysis_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        if row is None:
            return False
        return bool(row["cancel_requested"])

    def mark_queued(self, job_id: str) -> None:
        """Re-queue a running job back to queued status (e.g. after worker restart)."""
        with self._lock:
            conn = self.db.connect()
            conn.execute(
                """UPDATE output_analysis_jobs
                   SET status = ?, started_at = NULL
                   WHERE id = ? AND status != ? AND status != ? AND status != ?""",
                (
                    OutputAnalysisJobStatus.QUEUED.value,
                    job_id,
                    OutputAnalysisJobStatus.COMPLETED.value,
                    OutputAnalysisJobStatus.FAILED.value,
                    OutputAnalysisJobStatus.CANCELLED.value,
                ),
            )
            conn.commit()

    def get_next_queued(self) -> Optional[OutputAnalysisJob]:
        """Get the oldest queued job, if any."""
        conn = self.db.connect()
        row = conn.execute(
            """SELECT * FROM output_analysis_jobs
               WHERE status = ?
               ORDER BY created_at ASC LIMIT 1""",
            (OutputAnalysisJobStatus.QUEUED.value,),
        ).fetchone()
        if not row:
            return None
        return self._row_to_job(row)

    def requeue_non_terminal(self) -> int:
        """Requeue all queued/running jobs as queued (for app restart).

        Returns the number of jobs requeued.
        """
        with self._lock:
            conn = self.db.connect()
            cursor = conn.execute(
                """UPDATE output_analysis_jobs
                   SET status = ?
                   WHERE status IN (?, ?)""",
                (
                    OutputAnalysisJobStatus.QUEUED.value,
                    OutputAnalysisJobStatus.QUEUED.value,
                    OutputAnalysisJobStatus.RUNNING.value,
                ),
            )
            conn.commit()
            return cursor.rowcount

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _row_to_job(row) -> OutputAnalysisJob:
        return OutputAnalysisJob(
            id=row["id"],
            scope_type=row["scope_type"],
            scope_json=row["scope_json"],
            checks_json=row["checks_json"],
            status=row["status"],
            total_count=row["total_count"],
            processed_count=row["processed_count"],
            skipped_count=row["skipped_count"],
            passed_count=row["passed_count"],
            warning_count=row["warning_count"],
            failed_count=row["failed_count"],
            error_count=row["error_count"],
            created_at=row["created_at"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            cancel_requested=bool(row["cancel_requested"]),
            error_message=row["error_message"],
        )
