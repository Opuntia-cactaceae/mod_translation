"""Translation config related Pydantic schemas (API layer)."""

from pydantic import BaseModel
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------


class TranslationOptionsResponse(BaseModel):
    providers: List[str] = []
    prompt_profiles: List[str] = []
    protection_strategies: List[str] = []
    validators: List[str] = []


# ---------------------------------------------------------------------------
# Validate
# ---------------------------------------------------------------------------


class ValidateConfigRequest(BaseModel):
    """Mirrors the flat UI input form."""
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key_id: Optional[str] = None
    batch_size: Optional[int] = None
    src_lang: Optional[str] = None
    dst_lang: Optional[str] = None
    use_cache: Optional[bool] = None
    save_raw_responses: Optional[bool] = None
    prompt_preset_id: Optional[str] = None
    temperature: Optional[float] = None
    timeout_sec: Optional[float] = None
    max_retries: Optional[int] = None
    protection_strategy: Optional[str] = None
    validator_name: Optional[str] = None
    # Prompt template overrides (advanced)
    batch_system_prompt: Optional[str] = None
    batch_user_template: Optional[str] = None
    single_system_prompt: Optional[str] = None
    single_user_template: Optional[str] = None


class ConfigValidationErrorSchema(BaseModel):
    code: str = ""
    message: str = ""
    field: str = ""


class ValidateConfigResponse(BaseModel):
    is_valid: bool
    errors: List[ConfigValidationErrorSchema] = []


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------


class PreviewConfigRequest(BaseModel):
    """Request body for config preview — same shape as ValidateConfigRequest."""
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key_id: Optional[str] = None
    batch_size: Optional[int] = None
    src_lang: Optional[str] = None
    dst_lang: Optional[str] = None
    use_cache: Optional[bool] = None
    save_raw_responses: Optional[bool] = None
    prompt_preset_id: Optional[str] = None
    temperature: Optional[float] = None
    timeout_sec: Optional[float] = None
    max_retries: Optional[int] = None
    protection_strategy: Optional[str] = None
    validator_name: Optional[str] = None
    batch_system_prompt: Optional[str] = None
    batch_user_template: Optional[str] = None
    single_system_prompt: Optional[str] = None
    single_user_template: Optional[str] = None


class PreviewConfigResponse(BaseModel):
    config: Dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Preview prompt (Part 6)
# ---------------------------------------------------------------------------


class PreviewPromptRequest(BaseModel):
    """Request to preview a prompt with placeholder substitution."""
    prompt: Dict[str, Any] = {}
    src_lang: str = "en"
    dst_lang: str = "ru"
    mode: str = "batch"  # "batch" | "single"
    sample_texts: List[str] = []


class PreviewPromptResponse(BaseModel):
    system_message: str = ""
    user_message: str = ""
    warnings: List[str] = []
    errors: List[str] = []


# ---------------------------------------------------------------------------
# Effective prompt (resolve prompt templates from profile + overrides)
# ---------------------------------------------------------------------------


class EffectivePromptRequest(BaseModel):
    """Request to resolve the effective (merged) prompt templates."""
    prompt: Dict[str, Any] = {}
    src_lang: str = "en"
    dst_lang: str = "ru"


class EffectivePromptResponse(BaseModel):
    """Resolved effective prompt templates after merging profile + overrides."""
    profile_name: str = ""
    batch_system_prompt: str = ""
    batch_user_template: str = ""
    single_system_prompt: str = ""
    single_user_template: str = ""
    log_prompts: bool = False
    source: str = ""  # "preset" | "override" | "fallback"
    warnings: List[str] = []
