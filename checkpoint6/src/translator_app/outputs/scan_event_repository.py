"""Repository for scan event and analysis job file linkage persistence."""

import json
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from translator_app.outputs.debug_models import (
    AnalysisJobFileLink,
    ManifestIntegritySnapshot,
    OutputScanEvent,
)
from translator_app.storage.db import DatabaseService


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ScanEventRepository:
    """SQLite-backed repository for ``output_scan_events``.

    Thread-safe: all public mutations are serialized via ``_lock``.
    """

    def __init__(self, db: DatabaseService):
        self.db = db
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Scan events
    # ------------------------------------------------------------------

    def create_event(self, event: OutputScanEvent) -> OutputScanEvent:
        """Insert a new scan event."""
        if not event.id:
            event.id = uuid.uuid4().hex[:16]
        if not event.created_at:
            event.created_at = _now()
        with self._lock:
            conn = self.db.connect()
            conn.execute(
                """INSERT INTO output_scan_events
                   (id, job_id, output_root, manifest_mode, manifest_found,
                    files_indexed, files_updated, files_skipped,
                    files_missing_source, errors_count,
                    diagnostics_json, integrity_json, created_at)
                   VALUES (?, ?, ?, ?, ?,
                           ?, ?, ?,
                           ?, ?,
                           ?, ?, ?)""",
                (
                    event.id,
                    event.job_id,
                    event.output_root,
                    event.manifest_mode,
                    1 if event.manifest_found else 0,
                    event.files_indexed,
                    event.files_updated,
                    event.files_skipped,
                    event.files_missing_source,
                    event.errors_count,
                    event.diagnostics_json,
                    event.integrity_json,
                    event.created_at,
                ),
            )
            conn.commit()
        return event

    def get_event(self, event_id: str) -> Optional[OutputScanEvent]:
        """Get a scan event by id."""
        conn = self.db.connect()
        row = conn.execute(
            "SELECT * FROM output_scan_events WHERE id = ?",
            (event_id,),
        ).fetchone()
        return self._row_to_event(row) if row else None

    def get_latest_event_for_job(self, job_id: str) -> Optional[OutputScanEvent]:
        """Get the most recent scan event for a job."""
        conn = self.db.connect()
        row = conn.execute(
            """SELECT * FROM output_scan_events
               WHERE job_id = ?
               ORDER BY created_at DESC LIMIT 1""",
            (job_id,),
        ).fetchone()
        return self._row_to_event(row) if row else None

    def list_events_for_job(
        self,
        job_id: str,
        limit: int = 20,
        offset: int = 0,
    ) -> List[OutputScanEvent]:
        """List scan events for a job, newest first."""
        conn = self.db.connect()
        rows = conn.execute(
            """SELECT * FROM output_scan_events
               WHERE job_id = ?
               ORDER BY created_at DESC
               LIMIT ? OFFSET ?""",
            (job_id, limit, offset),
        ).fetchall()
        return [self._row_to_event(r) for r in rows]

    def list_events_for_file(
        self,
        output_file_id: str,
        limit: int = 10,
    ) -> List[OutputScanEvent]:
        """List scan events that likely touched a file.

        Finds events for the job that owns this file (since scan events
        are per-job, not per-file).
        """
        conn = self.db.connect()
        rows = conn.execute(
            """SELECT e.* FROM output_scan_events e
               INNER JOIN translated_output_files f ON f.job_id = e.job_id
               WHERE f.id = ?
               ORDER BY e.created_at DESC
               LIMIT ?""",
            (output_file_id, limit),
        ).fetchall()
        return [self._row_to_event(r) for r in rows]

    # ------------------------------------------------------------------
    # Analysis job file linkage
    # ------------------------------------------------------------------

    def link_analysis_job_file(
        self,
        analysis_job_id: str,
        output_file_id: str,
        result_id: Optional[str] = None,
        result_status: Optional[str] = None,
    ) -> None:
        """Record that an analysis job processed a specific output file."""
        now = _now()
        with self._lock:
            conn = self.db.connect()
            conn.execute(
                """INSERT OR IGNORE INTO output_analysis_job_files
                   (analysis_job_id, output_file_id, result_id, result_status, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (analysis_job_id, output_file_id, result_id, result_status, now),
            )
            conn.commit()

    def get_analysis_jobs_for_file(
        self,
        output_file_id: str,
        limit: int = 20,
    ) -> List[AnalysisJobFileLink]:
        """Get recent analysis jobs that touched a file.

        JOINs with ``output_analysis_jobs`` to populate job-level metadata
        (scope_type, status, counts, timestamps).
        """
        conn = self.db.connect()
        rows = conn.execute(
            """SELECT jf.analysis_job_id,
                     jf.output_file_id,
                     jf.result_id,
                     jf.result_status,
                     jf.created_at,
                     a.scope_type,
                     a.status      AS job_status,
                     a.created_at  AS job_created_at,
                     a.total_count,
                     a.processed_count,
                     a.passed_count,
                     a.warning_count,
                     a.failed_count,
                     a.error_count,
                     a.started_at,
                     a.finished_at
               FROM output_analysis_job_files jf
               LEFT JOIN output_analysis_jobs a ON a.id = jf.analysis_job_id
               WHERE jf.output_file_id = ?
               ORDER BY jf.created_at DESC
               LIMIT ?""",
            (output_file_id, limit),
        ).fetchall()
        results: List[AnalysisJobFileLink] = []
        for row in rows:
            results.append(AnalysisJobFileLink(
                analysis_job_id=row["analysis_job_id"],
                output_file_id=row["output_file_id"],
                result_id=row["result_id"],
                result_status=row["result_status"] or (row["job_status"] if row["job_status"] else None),
                created_at=row["created_at"],
                scope_type=row["scope_type"] or "",
                job_status=row["job_status"] or "",
                job_created_at=row["job_created_at"] or "",
                total_count=row["total_count"] or 0,
                processed_count=row["processed_count"] or 0,
                passed_count=row["passed_count"] or 0,
                warning_count=row["warning_count"] or 0,
                failed_count=row["failed_count"] or 0,
                error_count=row["error_count"] or 0,
                started_at=row["started_at"],
                finished_at=row["finished_at"],
            ))
        return results

    def get_linked_files_for_job(
        self,
        analysis_job_id: str,
    ) -> List[str]:
        """Get all output file ids linked to an analysis job."""
        conn = self.db.connect()
        rows = conn.execute(
            "SELECT output_file_id FROM output_analysis_job_files "
            "WHERE analysis_job_id = ?",
            (analysis_job_id,),
        ).fetchall()
        return [r["output_file_id"] for r in rows]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _row_to_event(row) -> Optional[OutputScanEvent]:
        if not row:
            return None
        return OutputScanEvent(
            id=row["id"],
            job_id=row["job_id"],
            output_root=row["output_root"],
            manifest_mode=row["manifest_mode"],
            manifest_found=bool(row["manifest_found"]),
            files_indexed=row["files_indexed"],
            files_updated=row["files_updated"],
            files_skipped=row["files_skipped"],
            files_missing_source=row["files_missing_source"],
            errors_count=row["errors_count"],
            diagnostics_json=row["diagnostics_json"],
            integrity_json=row["integrity_json"],
            created_at=row["created_at"],
        )
