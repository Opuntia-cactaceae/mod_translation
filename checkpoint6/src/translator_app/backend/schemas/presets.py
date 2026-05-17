"""Prompt presets Pydantic schemas for the backend API.

Spec: #16 Prompt Presets Module
"""

from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------


class PromptDiagnosticSchema(BaseModel):
    """Validation diagnostic for a single field."""
    level: str = "error"
    code: str = ""
    message: str = ""
    field: str = ""


# ---------------------------------------------------------------------------
# Preset models
# ---------------------------------------------------------------------------


class PresetResponse(BaseModel):
    """Full preset data returned by the API."""
    id: str = ""
    name: str = ""
    description: str = ""
    profile_name: str = ""
    batch_system_prompt: str = ""
    batch_user_template: str = ""
    single_system_prompt: str = ""
    single_user_template: str = ""
    log_prompts: bool = False
    is_system: bool = False
    created_at: str = ""
    updated_at: str = ""
    version: int = 1


class PresetListResponse(BaseModel):
    """List of presets."""
    presets: List[PresetResponse] = []
    total: int = 0


# ---------------------------------------------------------------------------
# CRUD request models
# ---------------------------------------------------------------------------


class CreatePresetRequest(BaseModel):
    name: str
    profile_name: str
    description: str = ""
    batch_system_prompt: str = ""
    batch_user_template: str = ""
    single_system_prompt: str = ""
    single_user_template: str = ""
    log_prompts: bool = False


class UpdatePresetRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    profile_name: Optional[str] = None
    batch_system_prompt: Optional[str] = None
    batch_user_template: Optional[str] = None
    single_system_prompt: Optional[str] = None
    single_user_template: Optional[str] = None
    log_prompts: Optional[bool] = None


class CopyPresetRequest(BaseModel):
    new_name: str


# ---------------------------------------------------------------------------
# Validate
# ---------------------------------------------------------------------------


class ValidatePresetRequest(BaseModel):
    name: str = ""
    profile_name: str = ""
    description: str = ""
    batch_system_prompt: str = ""
    batch_user_template: str = ""
    single_system_prompt: str = ""
    single_user_template: str = ""
    log_prompts: bool = False


class ValidatePresetResponse(BaseModel):
    is_valid: bool = True
    diagnostics: List[PromptDiagnosticSchema] = []


# ---------------------------------------------------------------------------
# Export / Import
# ---------------------------------------------------------------------------


class ExportPresetResponse(BaseModel):
    name: str = ""
    profile_name: str = ""
    batch_system_prompt: str = ""
    batch_user_template: str = ""
    single_system_prompt: str = ""
    single_user_template: str = ""
    log_prompts: bool = False


class ImportPresetRequest(BaseModel):
    data: Dict[str, Any]
