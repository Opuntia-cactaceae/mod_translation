"""Stellaris Cache API endpoints (#14)."""

from fastapi import APIRouter, Depends, Query

from translator_app.backend.deps import Services, get_services
from translator_app.backend.schemas.stellaris_cache import (
    StellarisCacheCleanRequest,
    StellarisCacheCleanResponse,
    StellarisCacheItemSchema,
    StellarisCachePreviewResponse,
)
from translator_app.stellaris_cache.models import (
    CacheOperationInput,
    CacheOperationResult,
    CleanMode,
)

router = APIRouter(
    prefix="/api/stellaris-cache",
    tags=["stellaris-cache"],
)


def _result_to_preview_response(result: CacheOperationResult) -> StellarisCachePreviewResponse:
    total_size = sum(item.size_bytes for item in result.items_to_delete)
    return StellarisCachePreviewResponse(
        success=result.success,
        cache_path=result.cache_path,
        items_to_delete=[
            StellarisCacheItemSchema(
                path=item.path,
                type=item.type.value if hasattr(item.type, "value") else item.type,
                size_bytes=item.size_bytes,
                reason=item.reason,
            )
            for item in result.items_to_delete
        ],
        total_size_bytes=total_size,
        warnings=result.warnings,
        errors=result.errors,
    )


def _result_to_clean_response(result: CacheOperationResult) -> StellarisCacheCleanResponse:
    total_size = sum(item.size_bytes for item in result.items_to_delete)
    return StellarisCacheCleanResponse(
        success=result.success,
        cache_path=result.cache_path,
        items_to_delete=[
            StellarisCacheItemSchema(
                path=item.path,
                type=item.type.value if hasattr(item.type, "value") else item.type,
                size_bytes=item.size_bytes,
                reason=item.reason,
            )
            for item in result.items_to_delete
        ],
        deleted_items=[
            StellarisCacheItemSchema(
                path=item.path,
                type=item.type.value if hasattr(item.type, "value") else item.type,
                size_bytes=item.size_bytes,
                reason=item.reason,
            )
            for item in result.deleted_items
        ],
        skipped_items=[
            StellarisCacheItemSchema(
                path=item.path,
                type=item.type.value if hasattr(item.type, "value") else item.type,
                size_bytes=item.size_bytes,
                reason=item.reason,
            )
            for item in result.skipped_items
        ],
        backup_path=result.backup_path,
        total_size_bytes=total_size,
        warnings=result.warnings,
        errors=result.errors,
    )


def _build_input(
    cache_path: str,
    mode: str = "selective",
    backup: bool = False,
    dry_run: bool = False,
) -> CacheOperationInput:
    clean_mode = CleanMode.FULL if mode == "full" else CleanMode.SELECTIVE
    return CacheOperationInput(
        cache_path=cache_path,
        mode=clean_mode,
        backup=backup,
        dry_run=dry_run,
    )


@router.get("/preview-clean", response_model=StellarisCachePreviewResponse)
def preview_clean(
    cache_path: str = Query(..., description="Path to the Stellaris cache directory"),
    mode: str = Query("selective", description="Clean mode: selective or full"),
    svcs: Services = Depends(get_services),
):
    """Preview what would be cleaned from the Stellaris cache. Dry-run only."""
    input_data = _build_input(cache_path=cache_path, mode=mode)
    result = svcs.stellaris_cache.preview_cache_clean(input_data)
    return _result_to_preview_response(result)


@router.post("/clean", response_model=StellarisCacheCleanResponse)
def clean(
    req: StellarisCacheCleanRequest,
    svcs: Services = Depends(get_services),
):
    """Clean (or preview) the Stellaris cache."""
    input_data = _build_input(
        cache_path=req.cache_path,
        mode=req.mode,
        backup=req.backup,
        dry_run=req.dry_run,
    )
    result = svcs.stellaris_cache.clean_cache(input_data)
    return _result_to_clean_response(result)


# Backward-compatible function exports
preview_cache_clean_handler = preview_clean
clean_cache_handler = clean
