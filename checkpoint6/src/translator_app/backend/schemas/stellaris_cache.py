"""Pydantic schemas for the Stellaris Cache Module (#14) API."""

from typing import List, Optional

from pydantic import BaseModel


class StellarisCacheItemSchema(BaseModel):
    """A single item that is (or would be) deleted from the Stellaris cache."""
    path: str
    type: str = "file"
    size_bytes: int = 0
    reason: str = ""


class StellarisCachePreviewResponse(BaseModel):
    """Response for the preview-clean endpoint."""
    success: bool
    cache_path: str = ""
    items_to_delete: List[StellarisCacheItemSchema] = []
    total_size_bytes: int = 0
    warnings: List[str] = []
    errors: List[str] = []


class StellarisCacheCleanRequest(BaseModel):
    """Request body for the clean endpoint."""
    cache_path: str
    mode: str = "selective"
    backup: bool = False
    dry_run: bool = False


class StellarisCacheCleanResponse(BaseModel):
    """Response for the clean endpoint."""
    success: bool
    cache_path: str = ""
    items_to_delete: List[StellarisCacheItemSchema] = []
    deleted_items: List[StellarisCacheItemSchema] = []
    skipped_items: List[StellarisCacheItemSchema] = []
    backup_path: Optional[str] = None
    total_size_bytes: int = 0
    warnings: List[str] = []
    errors: List[str] = []
