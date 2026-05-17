"""API endpoints for async output analysis jobs."""

import json
from typing import List, Optional

from fastapi import APIRouter, Depends, Query

from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import APIError, NOT_FOUND
from translator_app.backend.schemas.output_files import (
    CreateOutputAnalysisJobRequestSchema,
    OutputAnalysisJobListResponse,
    OutputAnalysisJobResponse,
)
from translator_app.outputs.analysis.jobs import CreateOutputAnalysisJobRequest

router = APIRouter(tags=["output-analysis-jobs"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _job_to_response(job) -> OutputAnalysisJobResponse:
    """Convert a domain job model to a Pydantic response."""
    scope = {}
    if job.scope_json:
        try:
            scope = json.loads(job.scope_json)
        except (json.JSONDecodeError, TypeError):
            scope = {}

    checks: List[str] = []
    if job.checks_json:
        try:
            checks = json.loads(job.checks_json)
        except (json.JSONDecodeError, TypeError):
            checks = []

    return OutputAnalysisJobResponse(
        id=job.id,
        scope_type=job.scope_type,
        scope=scope,
        checks=checks,
        status=job.status,
        total_count=job.total_count,
        processed_count=job.processed_count,
        skipped_count=job.skipped_count,
        passed_count=job.passed_count,
        warning_count=job.warning_count,
        failed_count=job.failed_count,
        error_count=job.error_count,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
        cancel_requested=job.cancel_requested,
        error_message=job.error_message,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/output-analysis-jobs",
    response_model=OutputAnalysisJobResponse,
    status_code=201,
)
def create_analysis_job(
    body: CreateOutputAnalysisJobRequestSchema,
    svcs: Services = Depends(get_services),
):
    """Create a new async output analysis job.

    The job will be processed in the background by the analysis worker.
    """
    # Validate scope
    if body.scope_type not in ("job", "mod", "group", "selected"):
        raise APIError(
            code="INVALID_PARAMS",
            message=f"Invalid scope_type: {body.scope_type}. Must be one of: job, mod, group, selected",
            status_code=422,
        )

    if body.scope_type == "selected":
        if not body.output_file_ids:
            raise APIError(
                code="INVALID_PARAMS",
                message="output_file_ids is required when scope_type is 'selected'",
                status_code=422,
            )
    elif not body.job_id:
        raise APIError(
            code="INVALID_PARAMS",
            message="job_id is required for scope_type '%s'" % body.scope_type,
            status_code=422,
        )

    if body.scope_type == "mod" and not body.mod_id:
        raise APIError(
            code="INVALID_PARAMS",
            message="mod_id is required when scope_type is 'mod'",
            status_code=422,
        )

    if body.scope_type == "group" and not body.group_key:
        raise APIError(
            code="INVALID_PARAMS",
            message="group_key is required when scope_type is 'group'",
            status_code=422,
        )

    request = CreateOutputAnalysisJobRequest(
        scope_type=body.scope_type,
        job_id=body.job_id,
        mod_id=body.mod_id,
        group_key=body.group_key,
        output_file_ids=body.output_file_ids,
        checks=body.checks,
        only_stale=body.only_stale,
    )

    job = svcs.analysis_job_service.create_job(request)
    svcs.analysis_worker.submit(job.id)
    return _job_to_response(job)


@router.get(
    "/output-analysis-jobs",
    response_model=OutputAnalysisJobListResponse,
)
def list_analysis_jobs(
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    svcs: Services = Depends(get_services),
):
    """List analysis jobs, optionally filtered by status."""
    jobs = svcs.analysis_job_service.list_jobs(
        status=status,
        limit=limit,
        offset=offset,
    )
    total = svcs.analysis_job_service.count_jobs(status=status)
    return OutputAnalysisJobListResponse(
        items=[_job_to_response(j) for j in jobs],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/output-analysis-jobs/{analysis_job_id}",
    response_model=OutputAnalysisJobResponse,
)
def get_analysis_job(
    analysis_job_id: str,
    svcs: Services = Depends(get_services),
):
    """Get a single analysis job by id."""
    job = svcs.analysis_job_service.get_job(analysis_job_id)
    if not job:
        raise APIError(
            code=NOT_FOUND,
            message=f"Analysis job not found: {analysis_job_id}",
            status_code=404,
        )
    return _job_to_response(job)


@router.post(
    "/output-analysis-jobs/{analysis_job_id}/cancel",
    response_model=OutputAnalysisJobResponse,
)
def cancel_analysis_job(
    analysis_job_id: str,
    svcs: Services = Depends(get_services),
):
    """Request cancellation of an analysis job."""
    job = svcs.analysis_job_service.cancel_job(analysis_job_id)
    if not job:
        raise APIError(
            code=NOT_FOUND,
            message=f"Analysis job not found: {analysis_job_id}",
            status_code=404,
        )
    return _job_to_response(job)
