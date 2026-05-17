"""API endpoints for output file analysis."""

from typing import List, Optional

from fastapi import APIRouter, Depends

from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import APIError
from translator_app.backend.schemas.output_files import (
    OutputAnalysisDiagnosticResponse,
    OutputAnalysisResultResponse,
    OutputBatchAnalysisResultResponse,
    OutputAnalyzeRequest,
    OutputBatchAnalyzeRequest,
)
from translator_app.outputs.analysis.models import (
    BatchAnalysisRequest,
    OutputFileAnalysisResult,
)

router = APIRouter(tags=["output-analysis"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _diagnostic_to_response(d) -> OutputAnalysisDiagnosticResponse:
    return OutputAnalysisDiagnosticResponse(
        severity=d.severity,
        code=d.code,
        message=d.message,
        source=d.source,
        line=d.line,
        column=d.column,
        key=d.key,
        details=d.details,
    )


def _result_to_response(r: OutputFileAnalysisResult) -> OutputAnalysisResultResponse:
    return OutputAnalysisResultResponse(
        id=r.id,
        output_file_id=r.output_file_id,
        job_id=r.job_id,
        analyzer_version=r.analyzer_version,
        status=r.status.value if hasattr(r.status, "value") else r.status,
        compilability_score=r.compilability_score,
        placeholders_score=r.placeholders_score,
        errors_count=r.errors_count,
        warnings_count=r.warnings_count,
        source_hash=r.source_hash,
        translated_hash=r.translated_hash,
        diagnostics=[_diagnostic_to_response(d) for d in r.diagnostics],
        created_at=r.created_at,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/output-files/{output_file_id}/analyze",
    response_model=OutputAnalysisResultResponse,
)
def analyze_output_file(
    output_file_id: str,
    body: Optional[OutputAnalyzeRequest] = None,
    svcs: Services = Depends(get_services),
):
    """Analyze a single translated output file.

    Runs requested checks (default: compilability and placeholders) and
    returns the result.  If ``save`` is True (default), persists the
    result to the database and clears the ``analysis_stale`` flag.
    """
    checks = body.checks if body and body.checks else ["compilability", "placeholders"]
    save = body.save if body else True

    result = svcs.output_analysis.analyze_file(
        output_file_id=output_file_id,
        checks=checks,
        save=save,
    )
    return _result_to_response(result)


@router.get(
    "/output-files/{output_file_id}/analysis/latest",
    response_model=Optional[OutputAnalysisResultResponse],
)
def get_output_file_latest_analysis(
    output_file_id: str,
    svcs: Services = Depends(get_services),
):
    """Get the most recent analysis result for an output file.

    Returns 204 No Content (null) if no analysis has been run yet.
    """
    result = svcs.output_analysis.get_latest(output_file_id)
    if result is None:
        return None
    return _result_to_response(result)


@router.get(
    "/output-files/{output_file_id}/analysis/history",
    response_model=List[OutputAnalysisResultResponse],
)
def get_output_file_analysis_history(
    output_file_id: str,
    limit: int = 20,
    offset: int = 0,
    svcs: Services = Depends(get_services),
):
    """Get analysis history for an output file, newest first."""
    results = svcs.output_analysis.get_history(
        output_file_id=output_file_id,
        limit=limit,
        offset=offset,
    )
    return [_result_to_response(r) for r in results]


@router.post(
    "/output-files/analyze-batch",
    response_model=OutputBatchAnalysisResultResponse,
)
def analyze_output_files_batch(
    body: OutputBatchAnalyzeRequest,
    svcs: Services = Depends(get_services),
):
    """Analyze multiple output files in a batch.

    Selection:
    - ``output_file_ids``: analyse exactly those files.
    - ``job_id`` / ``mod_id`` / ``group_key``: filter-based selection.
    - ``only_stale``: only analyse stale or never-analysed files.

    Missing/invalid files are skipped with diagnostics; the batch
    never crashes entirely.
    """
    request = BatchAnalysisRequest(
        job_id=body.job_id,
        mod_id=body.mod_id,
        group_key=body.group_key,
        output_file_ids=body.output_file_ids,
        checks=body.checks,
        save=body.save,
        only_stale=body.only_stale,
    )

    batch_result = svcs.output_analysis.analyze_batch(request)

    return OutputBatchAnalysisResultResponse(
        requested_count=batch_result.requested_count,
        analyzed_count=batch_result.analyzed_count,
        skipped_count=batch_result.skipped_count,
        passed_count=batch_result.passed_count,
        warning_count=batch_result.warning_count,
        failed_count=batch_result.failed_count,
        error_count=batch_result.error_count,
        results=[_result_to_response(r) for r in batch_result.results],
    )
