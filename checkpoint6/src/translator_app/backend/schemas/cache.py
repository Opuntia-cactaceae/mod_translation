"""Cache-related Pydantic schemas."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class CacheStatsResponse(BaseModel):
    total_requests: int = 0
    hits: int = 0
    misses: int = 0
    hit_rate: float = 0.0
    size: int = 0
    enabled: bool = True


class CacheClearRequest(BaseModel):
    src_lang: Optional[str] = None
    dst_lang: Optional[str] = None
    strategy: Optional[str] = None


class CacheClearResponse(BaseModel):
    success: bool
    message: str = ""
    removed: int = 0


class CacheExportResponse(BaseModel):
    entries: List[Dict[str, Any]] = []
    count: int = 0


class CacheImportRequest(BaseModel):
    entries: List[Dict[str, Any]]
    merge_strategy: str = "skip_existing"


class CacheImportResponse(BaseModel):
    success: bool
    imported: int = 0
    message: str = ""
