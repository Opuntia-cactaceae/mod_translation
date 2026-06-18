"""Pydantic schemas for Import / Export Module (#28) API."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class ExportRequestSchema(BaseModel):
    """Request body for POST /api/import-export/export."""
    include_config_presets: bool = False
    include_prompt_presets: bool = True
    include_cache: bool = False
    include_jobs: bool = False
    include_settings: bool = False
    output_path: Optional[str] = None


class ImportRequestSchema(BaseModel):
    """Request body for POST /api/import-export/import."""
    archive_path: str
    merge_strategy: str = "overwrite_existing"


class DiagnosticSchema(BaseModel):
    """A single diagnostic message in an import/export result."""
    level: str = "info"
    code: str = ""
    message: str = ""
    details: Optional[Dict[str, Any]] = None


class ImportExportResultSchema(BaseModel):
    """Response for import/export operations."""
    success: bool = True
    items_processed: int = 0
    items_skipped: int = 0
    warnings: List[DiagnosticSchema] = []
    errors: List[DiagnosticSchema] = []


class ExportResultSchema(ImportExportResultSchema):
    """Response for export, includes the output path."""
    output_path: Optional[str] = None


class PreviewImportResponse(BaseModel):
    """Response for POST /api/import-export/preview-import."""
    success: bool = True
    items_processed: int = 0
    warnings: List[DiagnosticSchema] = []
    errors: List[DiagnosticSchema] = []
    manifest: Optional[Dict[str, Any]] = None
    contents: List[str] = []
