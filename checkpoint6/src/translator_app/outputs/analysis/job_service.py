"""Service for managing async output analysis jobs."""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from translator_app.outputs.analysis.jobs import (
    CreateOutputAnalysisJobRequest,
    OutputAnalysisJob,
    OutputAnalysisJobStatus,
)
from translator_app.outputs.analysis.job_repository import AnalysisJobRepository

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class OutputAnalysisJobService:
    """Service for creating, listing, and managing analysis jobs."""

    def __init__(self, repository: AnalysisJobRepository):
        self._repo = repository

    def create_job(self, request: CreateOutputAnalysisJobRequest) -> OutputAnalysisJob:
        """Create a new analysis job and enqueue it."""
        scope_json = self._build_scope_json(request)
        checks_json = json.dumps(request.checks)

        job = OutputAnalysisJob(
            id=str(uuid.uuid4()),
            scope_type=request.scope_type,
            scope_json=scope_json,
            checks_json=checks_json,
            status=OutputAnalysisJobStatus.QUEUED.value,
            created_at=_now(),
        )
        self._repo.create(job)
        return job

    def get_job(self, job_id: str) -> Optional[OutputAnalysisJob]:
        """Get an analysis job by id."""
        return self._repo.get(job_id)

    def list_jobs(
        self,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[OutputAnalysisJob]:
        """List analysis jobs, optionally filtered by status."""
        return self._repo.list(status=status, limit=limit, offset=offset)

    def count_jobs(
        self,
        status: Optional[str] = None,
    ) -> int:
        """Count analysis jobs, optionally filtered by status."""
        return self._repo.count(status=status)

    def cancel_job(self, job_id: str) -> Optional[OutputAnalysisJob]:
        """Request cancellation of an analysis job.

        Returns the updated job, or None if not found.
        """
        job = self._repo.get(job_id)
        if not job:
            return None
        if job.is_terminal:
            # Already finished — nothing to cancel
            return job
        self._repo.request_cancel(job_id)
        job.cancel_requested = True
        return job

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_scope_json(request: CreateOutputAnalysisJobRequest) -> str:
        """Build scope JSON from a create request."""
        scope: dict = {}
        if request.scope_type == "job":
            scope["job_id"] = request.job_id
        elif request.scope_type == "mod":
            scope["job_id"] = request.job_id
            scope["mod_id"] = request.mod_id
        elif request.scope_type == "group":
            scope["job_id"] = request.job_id
            scope["mod_id"] = request.mod_id
            scope["group_key"] = request.group_key
        elif request.scope_type == "selected":
            scope["output_file_ids"] = request.output_file_ids

        if request.only_stale:
            scope["only_stale"] = True

        return json.dumps(scope)
