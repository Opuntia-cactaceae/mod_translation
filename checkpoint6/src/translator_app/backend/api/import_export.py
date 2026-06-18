"""Import / Export API endpoints.

Spec: #28 Import / Export Module

Endpoints:
    POST /api/import-export/export          — export data to ZIP archive
    POST /api/import-export/import          — import data from ZIP archive
    POST /api/import-export/preview-import  — preview import (read-only)
"""

from fastapi import APIRouter, Depends

from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import APIError, INVALID_REQUEST
from translator_app.backend.schemas.import_export import (
    DiagnosticSchema,
    ExportRequestSchema,
    ExportResultSchema,
    ImportExportResultSchema,
    ImportRequestSchema,
    PreviewImportResponse,
)
from translator_app.import_export.models import (
    ExportRequest,
    ImportExportDiagnostic,
    ImportRequest,
    MergeStrategy,
)

router = APIRouter(prefix="/api/import-export", tags=["import-export"])


def _diag_to_schema(d: ImportExportDiagnostic) -> DiagnosticSchema:
    return DiagnosticSchema(
        level=d.level,
        code=d.code,
        message=d.message,
        details=d.details,
    )


# ------------------------------------------------------------------
# POST /api/import-export/export
# ------------------------------------------------------------------


@router.post("/export", response_model=ExportResultSchema)
def export_data(
    body: ExportRequestSchema,
    svcs: Services = Depends(get_services),
):
    """Export user data to a ZIP archive."""
    # Build the ImportExportService using existing services
    ie_service = _get_ie_service(svcs)

    request = ExportRequest(
        include_config_presets=body.include_config_presets,
        include_prompt_presets=body.include_prompt_presets,
        include_cache=body.include_cache,
        include_jobs=body.include_jobs,
        include_settings=body.include_settings,
        output_path=body.output_path,
    )

    result = ie_service.export_data(request)
    return ExportResultSchema(
        success=result.success,
        items_processed=result.items_processed,
        items_skipped=result.items_skipped,
        warnings=[_diag_to_schema(w) for w in result.warnings],
        errors=[_diag_to_schema(e) for e in result.errors],
        output_path=getattr(result, "output_path", None),
    )


# ------------------------------------------------------------------
# POST /api/import-export/import
# ------------------------------------------------------------------


@router.post("/import", response_model=ImportExportResultSchema)
def import_data(
    body: ImportRequestSchema,
    svcs: Services = Depends(get_services),
):
    """Import user data from a ZIP archive."""
    ie_service = _get_ie_service(svcs)

    # Validate merge strategy
    try:
        merge_strategy = MergeStrategy(body.merge_strategy)
    except ValueError:
        raise APIError(
            code=INVALID_REQUEST,
            message=(
                f"Invalid merge_strategy: '{body.merge_strategy}'. "
                f"Supported: {[s.value for s in MergeStrategy]}"
            ),
            status_code=400,
        )

    request = ImportRequest(
        archive_path=body.archive_path,
        merge_strategy=merge_strategy,
    )

    result = ie_service.import_data(request)
    return ImportExportResultSchema(
        success=result.success,
        items_processed=result.items_processed,
        items_skipped=result.items_skipped,
        warnings=[_diag_to_schema(w) for w in result.warnings],
        errors=[_diag_to_schema(e) for e in result.errors],
    )


# ------------------------------------------------------------------
# POST /api/import-export/preview-import
# ------------------------------------------------------------------


@router.post("/preview-import", response_model=PreviewImportResponse)
def preview_import(
    body: ImportRequestSchema,
    svcs: Services = Depends(get_services),
):
    """Preview what would be imported from a ZIP archive (read-only)."""
    ie_service = _get_ie_service(svcs)

    result = ie_service.preview_import(body.archive_path)
    manifest = None
    contents = []
    for w in result.warnings:
        if w.code == "PREVIEW" and w.details:
            manifest = w.details.get("manifest")
            contents = w.details.get("contents", [])

    return PreviewImportResponse(
        success=result.success,
        items_processed=result.items_processed,
        warnings=[_diag_to_schema(w) for w in result.warnings],
        errors=[_diag_to_schema(e) for e in result.errors],
        manifest=manifest,
        contents=contents,
    )


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------


def _get_ie_service(svcs: Services):
    """Construct an ImportExportService from the Services container."""
    from translator_app.import_export.service import ImportExportService

    return ImportExportService(
        prompt_presets=svcs.prompt_presets,
        cache=svcs.cache,
        settings_service=svcs.settings,
        job_manager=svcs.jobs,
    )
