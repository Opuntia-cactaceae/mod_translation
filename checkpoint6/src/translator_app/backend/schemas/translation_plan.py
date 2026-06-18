"""Translation Plan API schemas (Pydantic layer)."""

from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional


class TranslationPlanPreviewRequest(BaseModel):
    """Request body for translation plan preview."""
    file_paths: List[str] = []
    config: Optional[Dict[str, Any]] = None


class TranslationPlanPreviewResponse(BaseModel):
    """Response for translation plan preview.

    Backward-compatible: all preflight fields have defaults so existing
    callers continue to work unchanged.
    """
    total_units: int = 0
    total_tasks: int = 0
    batch_size: int = 0
    cache_hits: int = 0
    cache_misses: int = 0
    diagnostics: List[Dict[str, Any]] = []

    # --- Preflight diagnostics (added in checkpoint6) ---
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
    unsupported_files: List[str] = Field(default_factory=list)
    duplicate_files: List[str] = Field(default_factory=list)
    empty_files: List[str] = Field(default_factory=list)
    zero_unit_files: List[str] = Field(default_factory=list)
    detected_languages: List[str] = Field(default_factory=list)
    has_blocking_errors: bool = False
