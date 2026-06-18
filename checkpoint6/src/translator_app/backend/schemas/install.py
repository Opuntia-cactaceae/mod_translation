"""Pydantic schemas for Mod Install API endpoints (#12)."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class InstallRequestSchema(BaseModel):
    """Request body for POST /api/mods/install."""

    source_path: str = Field(..., description="Path to the source mod directory")
    target_dir: str = Field(..., description="Path to the Stellaris mods directory")
    mode: str = Field("copy", description="Operation mode: copy or move")
    overwrite: bool = Field(False, description="Overwrite if target exists")
    backup_on_overwrite: bool = Field(True, description="Create backup before overwrite")
    rename_on_conflict: bool = Field(False, description="Rename target on conflict instead of error")
    dry_run: bool = Field(False, description="Preview only, do not modify filesystem")


class InstallResultSchema(BaseModel):
    """Response body for POST /api/mods/install."""

    success: bool
    partial: bool = False
    operation_type: str = ""
    source_path: str = ""
    target_path: str = ""
    final_path: str = ""
    files_copied: int = 0
    files_moved: int = 0
    files_skipped: int = 0
    bytes_processed: int = 0
    duration_ms: int = 0
    backup_path: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)


class InstallPreviewSchema(BaseModel):
    """Response body for POST /api/mods/install/preview."""

    operation: str = ""
    target_path: str = ""
    conflict: bool = False
    action: str = ""
    estimated_files: int = 0
    estimated_bytes: int = 0
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
