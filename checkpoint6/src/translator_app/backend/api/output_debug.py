"""Debug/observability API endpoints for output files."""

import json
from typing import List

from fastapi import APIRouter, Depends, Query

from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import APIError, NOT_FOUND
from translator_app.backend.schemas.output_debug import (
    AnalysisJobDebugInfoResponse,
    OutputAnalysisJobDebugResponse,
    OutputFileDebugSnapshotResponse,
    OutputScanEventResponse,
    ScannerDebugInfoResponse,
)
from translator_app.outputs.debug_models import (
    ManifestIntegritySnapshot,
    OutputScanEvent,
    StaleReason,
)
from translator_app.outputs.models import TranslatedOutputFile

router = APIRouter(tags=["output-debug"])


# ---------------------------------------------------------------------------
# Helper: persist scan events (called from scanner)
# ---------------------------------------------------------------------------


def make_scan_event_persister(svcs: Services):
    """Create a callback function that persists scan results as events.

    Meant to be wired into the scanner at startup.
    """
    from translator_app.outputs.scanner import TranslatedOutputScanResult

    def persist(result: TranslatedOutputScanResult) -> None:
        diagnostics_json = json.dumps([
            {
                "severity": d.severity,
                "code": d.code,
                "message": d.message,
                "path": d.path,
                "details": d.details,
            }
            for d in result.diagnostics
        ])

        # Build integrity snapshot JSON from manifest diagnostics
        integrity_info = None
        if result.manifest_diagnostics:
            # Recover integrity info from manifest diagnostics details
            missing_files = []
            undeclared_files = []
            files_declared = 0
            files_found = 0
            is_complete = True
            for d in result.manifest_diagnostics:
                if d.details:
                    files_declared = d.details.get("files_declared", files_declared)
                    files_found = d.details.get("files_found", files_found)
                    undeclared = d.details.get("undeclared", [])
                    if undeclared:
                        undeclared_files = undeclared
                    is_complete = d.details.get("is_complete", is_complete)
            integrity_info = json.dumps({
                "files_declared": files_declared,
                "files_found": files_found,
                "missing_files": missing_files,
                "undeclared_files": undeclared_files,
                "is_complete": is_complete,
                "manifest_mode": result.manifest_mode.value if result.manifest_mode else "",
            })

        scan_event_repo = svcs.scan_event_repo
        event = OutputScanEvent(
            id="",
            job_id=result.job_id,
            output_root=result.output_root,
            manifest_mode=result.manifest_mode.value if result.manifest_mode else "fallback",
            manifest_found=result.manifest_found,
            files_indexed=result.indexed_count,
            files_updated=result.updated_count,
            files_skipped=result.skipped_count,
            files_missing_source=result.missing_source_count,
            errors_count=result.errors_count,
            diagnostics_json=diagnostics_json,
            integrity_json=integrity_info,
        )
        scan_event_repo.create_event(event)

    return persist


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/output-files/{output_file_id}/debug",
    response_model=OutputFileDebugSnapshotResponse,
)
def get_output_file_debug(
    output_file_id: str,
    svcs: Services = Depends(get_services),
):
    """Get aggregated debug snapshot for an output file.

    Returns file metadata, current hashes, latest analysis hashes,
    validity state, stale reason, manifest info, scanner diagnostics,
    and recent analysis jobs.
    """
    snapshot = svcs.output_debug.get_file_debug_snapshot(output_file_id)
    if snapshot is None:
        raise APIError(
            code=NOT_FOUND,
            message=f"Output file not found: {output_file_id}",
            status_code=404,
        )

    return OutputFileDebugSnapshotResponse(
        file_id=snapshot.file_id,
        job_id=snapshot.job_id,
        file_name=snapshot.file_name,
        relative_path=snapshot.relative_path,
        status=snapshot.status,
        created_at=snapshot.created_at,
        updated_at=snapshot.updated_at,
        last_analyzed_at=snapshot.last_analyzed_at,
        current_source_hash=snapshot.current_source_hash,
        current_translated_hash=snapshot.current_translated_hash,
        analysis_stale=snapshot.analysis_stale,
        stale_reason=snapshot.stale_reason,
        latest_analysis_state=snapshot.latest_analysis_state,
        manifest={
            "manifest_path": snapshot.manifest.manifest_path,
            "manifest_mode": snapshot.manifest.manifest_mode,
            "is_complete": snapshot.manifest.is_complete,
            "missing_files": snapshot.manifest.missing_files,
            "undeclared_files": snapshot.manifest.undeclared_files,
            "files_declared": snapshot.manifest.files_declared,
            "files_found": snapshot.manifest.files_found,
        },
        scanner={
            "manifest_mode": snapshot.scanner.manifest_mode,
            "manifest_found": snapshot.scanner.manifest_found,
            "manifest_path": snapshot.scanner.manifest_path,
            "scan_diagnostics": snapshot.scanner.scan_diagnostics,
            "last_scan_event_id": snapshot.scanner.last_scan_event_id,
            "last_scan_at": snapshot.scanner.last_scan_at,
        },
        analysis={
            "latest_analysis_id": snapshot.analysis.latest_analysis_id,
            "latest_analysis_status": snapshot.analysis.latest_analysis_status,
            "latest_analysis_at": snapshot.analysis.latest_analysis_at,
            "analysis_source_hash": snapshot.analysis.analysis_source_hash,
            "analysis_translated_hash": snapshot.analysis.analysis_translated_hash,
            "validity_state": snapshot.analysis.validity_state,
            "diagnostics": snapshot.analysis.diagnostics,
            "history_count": snapshot.analysis.history_count,
        },
        integrity={
            "current_source_hash": snapshot.integrity.current_source_hash,
            "current_translated_hash": snapshot.integrity.current_translated_hash,
            "analysis_source_hash": snapshot.integrity.analysis_source_hash,
            "analysis_translated_hash": snapshot.integrity.analysis_translated_hash,
            "hash_match": snapshot.integrity.hash_match,
            "file_exists_on_disk": snapshot.integrity.file_exists_on_disk,
            "source_exists_on_disk": snapshot.integrity.source_exists_on_disk,
        },
        recent_analysis_jobs=[
            AnalysisJobDebugInfoResponse(
                job_id=j.job_id,
                scope_type=j.scope_type,
                status=j.status,
                total_count=j.total_count,
                processed_count=j.processed_count,
                created_at=j.created_at,
                started_at=j.started_at,
                finished_at=j.finished_at,
                passed_count=j.passed_count,
                warning_count=j.warning_count,
                failed_count=j.failed_count,
                error_count=j.error_count,
            )
            for j in snapshot.recent_analysis_jobs
        ],
    )


@router.get(
    "/output-files/{output_file_id}/scan-history",
    response_model=List[OutputScanEventResponse],
)
def get_output_file_scan_history(
    output_file_id: str,
    limit: int = Query(20, ge=1, le=100),
    svcs: Services = Depends(get_services),
):
    """Get scan/reindex event history for the job owning this file."""
    events = svcs.output_debug.get_file_scan_history(
        output_file_id, limit=limit
    )
    return [
        OutputScanEventResponse(
            id=e.id,
            job_id=e.job_id,
            output_root=e.output_root,
            manifest_mode=e.manifest_mode,
            manifest_found=e.manifest_found,
            files_indexed=e.files_indexed,
            files_updated=e.files_updated,
            files_skipped=e.files_skipped,
            files_missing_source=e.files_missing_source,
            errors_count=e.errors_count,
            diagnostics=json.loads(e.diagnostics_json) if e.diagnostics_json else [],
            created_at=e.created_at,
        )
        for e in events
    ]


@router.get(
    "/output-analysis-jobs/{analysis_job_id}/debug",
    response_model=OutputAnalysisJobDebugResponse,
)
def get_analysis_job_debug(
    analysis_job_id: str,
    svcs: Services = Depends(get_services),
):
    """Get debug info for an analysis job, including linked files."""
    debug_info = svcs.output_debug.get_analysis_job_debug(analysis_job_id)
    return OutputAnalysisJobDebugResponse(**debug_info)
