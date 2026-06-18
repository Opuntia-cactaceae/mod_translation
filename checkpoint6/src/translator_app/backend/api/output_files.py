"""Translated output files API endpoints."""

from typing import Optional

from fastapi import APIRouter, Depends

from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import APIError
from translator_app.backend.schemas.output_files import (
    OutputFileListResponse,
    OutputFileResponse,
    OutputReindexRequest,
    OutputFilesSummaryResponse,
    OutputScanResultResponse,
    OutputFileTreeResponse,
    JobTimestampInfo,
    ScanDiagnosticResponse,
    FileContentsResponse,
)
from translator_app.outputs.models import TranslatedOutputFile
from translator_app.outputs.repository import TranslatedOutputFileRepository
from translator_app.outputs.scanner import ScanDiagnostic

from pathlib import Path

router = APIRouter(tags=["output-files"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _file_to_response(file: TranslatedOutputFile) -> OutputFileResponse:
    analysis = file.latest_analysis
    latest_analysis_state = TranslatedOutputFileRepository.get_analysis_state(file)
    return OutputFileResponse(
        id=file.id,
        job_id=file.job_id,
        mod_id=file.mod_id,
        mod_name=file.mod_name,
        source_file_path=file.source_file_path,
        translated_file_path=file.translated_file_path,
        relative_source_path=file.relative_source_path,
        relative_translated_path=file.relative_translated_path,
        file_name=file.file_name,
        file_ext=file.file_ext,
        game_id=file.game_id,
        parser_id=file.parser_id,
        aggregation_key=file.aggregation_key,
        group_key=file.group_key,
        group_label=file.group_label,
        source_size_bytes=file.source_size_bytes,
        translated_size_bytes=file.translated_size_bytes,
        created_at=file.created_at,
        updated_at=file.updated_at,
        last_analyzed_at=file.last_analyzed_at,
        editor_available=file.editor_available,
        status=file.status,
        analysis_stale=file.analysis_stale,
        output_metadata=file.output_metadata,
        latest_analysis_state=latest_analysis_state,
        latest_analysis=(
            None
            if analysis is None
            else {
                "id": analysis.id,
                "status": analysis.status,
                "compilability_score": analysis.compilability_score,
                "placeholders_score": analysis.placeholders_score,
                "errors_count": analysis.errors_count,
                "warnings_count": analysis.warnings_count,
                "created_at": analysis.created_at,
                "source_hash": analysis.source_hash,
                "translated_hash": analysis.translated_hash,
            }
        ),
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/output-files", response_model=OutputFileListResponse)
def list_output_files(
    job_id: Optional[str] = None,
    mod_id: Optional[str] = None,
    group_key: Optional[str] = None,
    status: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    svcs: Services = Depends(get_services),
):
    """List translated output files with filtering and pagination."""
    files = svcs.output_files.list_files(
        job_id=job_id,
        mod_id=mod_id,
        group_key=group_key,
        status=status,
        q=q,
        limit=limit,
        offset=offset,
    )
    total = svcs.output_files.count_files(
        job_id=job_id,
        mod_id=mod_id,
        group_key=group_key,
        status=status,
        q=q,
    )
    return OutputFileListResponse(
        items=[_file_to_response(f) for f in files],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/output-files/tree", response_model=OutputFileTreeResponse)
def get_output_files_tree(
    job_id: Optional[str] = None,
    svcs: Services = Depends(get_services),
):
    """Get the grouped tree of output files (jobs -> mods -> groups -> files)."""
    tree = svcs.output_files.get_tree(job_id=job_id)

    # Build job timestamp + name lookup from the jobs service
    job_timestamps: dict[str, JobTimestampInfo] = {}
    job_names: dict[str, str] = {}
    try:
        for jid in tree.jobs:
            try:
                job = svcs.jobs.get_job(jid)
                if job:
                    def _ts(val):
                        if val is None:
                            return None
                        return val.isoformat() if hasattr(val, "isoformat") else str(val)
                    job_timestamps[jid] = JobTimestampInfo(
                        created_at=_ts(job.created_at) or "",
                        updated_at=_ts(job.updated_at),
                        completed_at=_ts(job.completed_at),
                    )
                    job_names[jid] = job.name or ""
            except Exception:
                continue
    except Exception:
        pass

    return OutputFileTreeResponse(
        jobs={
            jid: {
                "job_id": node.job_id,
                "name": job_names.get(jid, ""),
                "mods": {
                    mid: {
                        "mod_id": mod_node.mod_id,
                        "mod_name": mod_node.mod_name,
                        "groups": {
                            gkey: {
                                "group_key": group_node.group_key,
                                "group_label": group_node.group_label,
                                "files": group_node.files,
                            }
                            for gkey, group_node in mod_node.groups.items()
                        },
                    }
                    for mid, mod_node in node.mods.items()
                },
            }
            for jid, node in tree.jobs.items()
        },
        job_timestamps=job_timestamps,
    )


@router.get("/output-files/{output_file_id}", response_model=OutputFileResponse)
def get_output_file(
    output_file_id: str,
    svcs: Services = Depends(get_services),
):
    """Get full detail for a single output file."""
    file = svcs.output_files.get_file(output_file_id)
    return _file_to_response(file)


@router.get(
    "/output-files/{output_file_id}/file-contents",
    response_model=FileContentsResponse,
)
def get_file_contents(
    output_file_id: str,
    svcs: Services = Depends(get_services),
):
    """Read source and translated file contents from disk (read-only).

    Returns the raw file contents with existence flags.
    Never writes, never uses the serializer, never mutates state.
    """
    try:
        output_file = svcs.output_files_repo.get_by_id(output_file_id)
    except Exception as exc:
        raise APIError(
            code="FILE_CONTENTS_LOAD_FAILED",
            message=f"Failed to load file: {exc}",
            status_code=500,
        ) from exc

    if not output_file:
        raise APIError(
            code="NOT_FOUND",
            message=f"Output file not found: {output_file_id}",
            status_code=404,
        )

    source_path = output_file.source_file_path
    translated_path = output_file.translated_file_path

    source_exists = Path(source_path).exists()
    translated_exists = Path(translated_path).exists()

    source_content = ""
    translated_content = ""

    if source_exists:
        try:
            source_content = Path(source_path).read_text(encoding="utf-8")
        except (OSError, RuntimeError):
            pass

    if translated_exists:
        try:
            translated_content = Path(translated_path).read_text(encoding="utf-8")
        except (OSError, RuntimeError):
            pass

    return FileContentsResponse(
        source_path=source_path,
        translated_path=translated_path,
        source_content=source_content,
        translated_content=translated_content,
        source_exists=source_exists,
        translated_exists=translated_exists,
    )


@router.get(
    "/translation-jobs/{job_id}/outputs-summary",
    response_model=OutputFilesSummaryResponse,
)
def get_outputs_summary(
    job_id: str,
    svcs: Services = Depends(get_services),
):
    """Get summary statistics for a job's output files."""
    summary = svcs.output_files.get_summary_for_job(job_id)
    return OutputFilesSummaryResponse(**summary)


# ---------------------------------------------------------------------------
# Scan / Reindex
# ---------------------------------------------------------------------------


def _scan_diagnostic_to_response(d: ScanDiagnostic) -> ScanDiagnosticResponse:
    return ScanDiagnosticResponse(
        severity=d.severity,
        code=d.code,
        message=d.message,
        path=d.path,
        details=d.details,
    )


@router.post(
    "/translation-jobs/{job_id}/outputs/reindex",
    response_model=OutputScanResultResponse,
)
def reindex_job_outputs(
    job_id: str,
    body: Optional[OutputReindexRequest] = None,
    svcs: Services = Depends(get_services),
):
    """Reindex translated output files for a completed job.

    Walks the job's output directory and upserts ``TranslatedOutputFile``
    records.  Idempotent — repeated calls update existing records without
    duplicating them.
    """
    force = body.force if body is not None else False
    result = svcs.output_files.reindex_job_outputs(
        job_id=job_id, force=force,
    )
    return OutputScanResultResponse(
        job_id=result.job_id,
        scanned_count=result.scanned_count,
        indexed_count=result.indexed_count,
        updated_count=result.updated_count,
        skipped_count=result.skipped_count,
        missing_source_count=result.missing_source_count,
        errors_count=result.errors_count,
        manifest_found=result.manifest_found,
        manifest_mode=result.manifest_mode.value if result.manifest_mode else "fallback",
        diagnostics=[
            _scan_diagnostic_to_response(d) for d in result.diagnostics
        ],
    )
