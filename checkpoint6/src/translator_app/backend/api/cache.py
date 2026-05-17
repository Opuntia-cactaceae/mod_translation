"""Cache API endpoints."""

from fastapi import APIRouter, Depends

from translator_app.backend.schemas.cache import (
    CacheStatsResponse,
    CacheClearRequest,
    CacheClearResponse,
    CacheExportResponse,
    CacheImportRequest,
    CacheImportResponse,
)
from translator_app.backend.deps import Services, get_services

router = APIRouter(tags=["cache"])


@router.get("/stats", response_model=CacheStatsResponse)
def get_cache_stats(svcs: Services = Depends(get_services)):
    """Get translation cache statistics."""
    stats = svcs.cache.stats()
    return CacheStatsResponse(
        total_requests=stats.total_requests,
        hits=stats.hits,
        misses=stats.misses,
        hit_rate=stats.hit_rate,
        size=stats.size,
        enabled=True,
    )


@router.post("/clear", response_model=CacheClearResponse)
def clear_cache(
    req: CacheClearRequest = CacheClearRequest(),
    svcs: Services = Depends(get_services),
):
    """Clear the translation cache.

    If no scope parameters are provided, clears the entire cache.
    Otherwise clears only entries matching the given scope.
    """
    scope = None
    if req.src_lang is not None or req.dst_lang is not None or req.strategy is not None:
        scope = {}
        if req.src_lang is not None:
            scope["src_lang"] = req.src_lang
        if req.dst_lang is not None:
            scope["dst_lang"] = req.dst_lang
        if req.strategy is not None:
            scope["strategy"] = req.strategy

    removed = svcs.cache.clear(scope=scope)
    return CacheClearResponse(
        success=True,
        message="Cache cleared" if not scope else f"Cleared {removed} entries matching scope",
        removed=removed,
    )


@router.post("/export", response_model=CacheExportResponse)
def export_cache(svcs: Services = Depends(get_services)):
    """Export all cache entries as JSON."""
    entries = svcs.cache.export_cache()
    return CacheExportResponse(entries=entries, count=len(entries))


@router.post("/import", response_model=CacheImportResponse)
def import_cache(
    req: CacheImportRequest,
    svcs: Services = Depends(get_services),
):
    """Import cache entries from JSON."""
    try:
        imported = svcs.cache.import_cache(req.entries, req.merge_strategy)
        return CacheImportResponse(
            success=True,
            imported=imported,
            message=f"Imported {imported} entries",
        )
    except (ValueError, RuntimeError) as exc:
        return CacheImportResponse(
            success=False,
            imported=0,
            message=str(exc),
        )


# Backward-compatible function exports
get_cache_info_handler = get_cache_stats
clear_cache_handler = clear_cache
