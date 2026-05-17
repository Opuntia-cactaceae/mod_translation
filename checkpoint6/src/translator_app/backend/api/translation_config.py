"""Translation configuration API endpoints.

Uses the TranslationConfigBuilder to assemble, validate, and preview configs.
"""

from typing import Dict, List

from fastapi import APIRouter, Depends

from translator_app.backend.schemas.translation import (
    TranslationOptionsResponse,
    ValidateConfigRequest,
    ValidateConfigResponse,
    ConfigValidationErrorSchema,
    PreviewConfigRequest,
    PreviewConfigResponse,
    PreviewPromptRequest,
    PreviewPromptResponse,
    EffectivePromptRequest,
    EffectivePromptResponse,
)
from translator_app.backend.deps import Services, get_services
from translator_app.translation.config import TranslationConfigBuilder
from translator_app.translation.runtime_adapter import (
    resolve_language_name,
    detect_chatbot_reply,
)
from translator_app.settings.validation import (
    get_supported_providers,
    get_supported_prompt_profiles,
    get_supported_protection_strategies,
    get_supported_validators,
)

router = APIRouter(tags=["translation-config"])


def _build_builder(svcs: Services) -> TranslationConfigBuilder:
    """Factory for TranslationConfigBuilder wired to the service container."""
    return TranslationConfigBuilder(
        settings_service=svcs.settings,
        secrets_service=svcs.secrets,
        prompt_preset_registry=svcs.prompt_presets,
    )


def _ui_config_from_request(body) -> dict:
    """Extract a non-None override dict from a request body."""
    return {k: v for k, v in body.model_dump(exclude_none=True).items() if v is not None}


@router.get("/options", response_model=TranslationOptionsResponse)
def get_translation_options(svcs: Services = Depends(get_services)):
    """List available translation providers, prompt profiles, protection strategies, and validators."""
    return TranslationOptionsResponse(
        providers=sorted(get_supported_providers()),
        prompt_profiles=sorted(get_supported_prompt_profiles()),
        protection_strategies=sorted(get_supported_protection_strategies()),
        validators=sorted(get_supported_validators()),
    )


@router.post("/validate", response_model=ValidateConfigResponse)
def validate_translation_config(body: ValidateConfigRequest, svcs: Services = Depends(get_services)):
    """Validate a translation config without running it."""
    builder = _build_builder(svcs)
    ui_config = _ui_config_from_request(body)

    # Forward prompt_preset_id as preset_id
    preset_id = ui_config.pop("prompt_preset_id", None) or body.model_dump().get("prompt_preset_id")

    config = builder.build_config(
        ui_config=ui_config,
        preset_id=preset_id,
    )
    result = builder.validate_config(config)

    return ValidateConfigResponse(
        is_valid=result.is_valid,
        errors=[
            ConfigValidationErrorSchema(code=e.code, message=e.message, field=e.field)
            for e in result.errors
        ],
    )


@router.post("/preview", response_model=PreviewConfigResponse)
def preview_translation_config(body: PreviewConfigRequest, svcs: Services = Depends(get_services)):
    """Preview a translation config without executing it."""
    builder = _build_builder(svcs)
    ui_config = _ui_config_from_request(body)

    preset_id = ui_config.pop("prompt_preset_id", None) or body.model_dump().get("prompt_preset_id")

    config = builder.build_config(
        ui_config=ui_config,
        preset_id=preset_id,
    )
    preview = builder.preview_config(config)

    return PreviewConfigResponse(config=preview)


@router.post("/preview-prompt", response_model=PreviewPromptResponse)
def preview_prompt(body: PreviewPromptRequest):
    """Preview a prompt with placeholder substitution.

    Builds the system and user messages that would be sent to the LLM
    for a given prompt config, source/target languages, mode, and sample texts.
    Does NOT call any LLM — purely a frontend helper.
    """
    import json
    import re

    prompt_cfg = body.prompt or {}
    src_lang_code = body.src_lang or "en"
    dst_lang_code = body.dst_lang or "ru"
    src_lang = resolve_language_name(src_lang_code)
    dst_lang = resolve_language_name(dst_lang_code)
    mode = body.mode or "batch"
    sample_texts = body.sample_texts or []

    warnings: List[str] = []
    errors: List[str] = []

    # Determine which templates to use
    if mode == "batch":
        system_template = prompt_cfg.get("batch_system_prompt", "")
        user_template = prompt_cfg.get("batch_user_template", "")
        if not user_template:
            errors.append("Batch user template is empty")
    else:
        system_template = prompt_cfg.get("single_system_prompt", "")
        user_template = prompt_cfg.get("single_user_template", "")
        if not user_template:
            errors.append("Single user template is empty")

    # Build substitution dict
    texts_str = json.dumps(sample_texts, ensure_ascii=False)
    subst: Dict[str, str] = {
        "texts": texts_str,
        "src_lang": src_lang,
        "dst_lang": dst_lang,
        "src_lang_code": src_lang_code,
        "dst_lang_code": dst_lang_code,
    }
    if sample_texts:
        subst["text"] = sample_texts[0]
    else:
        subst["text"] = ""

    # Check for unknown placeholders
    KNOWN = frozenset({"text", "texts", "src_lang", "dst_lang",
                       "src_lang_code", "dst_lang_code"})
    for template, field_name in [
        (system_template, "system_prompt"),
        (user_template, "user_template"),
    ]:
        if not template:
            continue
        for m in re.finditer(r"\{(\w+)\}", template):
            name = m.group(1)
            if name not in KNOWN:
                warnings.append(f"Unknown placeholder '{{{name}}}' in {field_name}")

    # Check required placeholders
    if mode == "batch" and "{texts}" in user_template:
        if not sample_texts:
            warnings.append("Batch mode requires sample texts for {texts} substitution")
    if mode == "single" and "{text}" in user_template:
        if not sample_texts:
            warnings.append("Single mode requires at least one sample text for {{text}} substitution")

    # Perform substitution
    try:
        system_message = system_template.format(**subst)
    except KeyError as e:
        system_message = system_template
        errors.append(f"Missing substitution key in system template: {e}")
    except Exception as e:
        system_message = system_template
        errors.append(f"Error substituting system template: {e}")

    try:
        user_message = user_template.format(**subst)
    except KeyError as e:
        user_message = user_template
        errors.append(f"Missing substitution key in user template: {e}")
    except Exception as e:
        user_message = user_template
        errors.append(f"Error substituting user template: {e}")

    # Chatbot reply detection warning
    if user_message.strip():
        if detect_chatbot_reply(user_message):
            warnings.append("User message appears to be empty after substitution")
    if system_message.strip() == "" and errors:
        warnings.append("System message is empty after substitution")

    return PreviewPromptResponse(
        system_message=system_message,
        user_message=user_message,
        warnings=warnings,
        errors=errors,
    )


@router.post("/effective-prompt", response_model=EffectivePromptResponse)
def effective_prompt(body: EffectivePromptRequest, svcs: Services = Depends(get_services)):
    """Resolve effective prompt templates for a given profile and optional overrides.

    Returns the merged prompt config (preset + UI overrides) that would
    actually be used when translating.  This is a **read-only** resolution —
    it does not create or modify any job.
    """
    builder = _build_builder(svcs)
    prompt_cfg = body.prompt or {}
    warnings: List[str] = []

    profile_name = prompt_cfg.get("profile_name", "")
    src_lang = body.src_lang or "en"
    dst_lang = body.dst_lang or "ru"

    # Detect whether the caller is providing override fields
    has_overrides = bool(
        prompt_cfg.get("batch_system_prompt")
        or prompt_cfg.get("batch_user_template")
        or prompt_cfg.get("single_system_prompt")
        or prompt_cfg.get("single_user_template")
    )

    # Build a minimal UI config with src/dst lang
    ui_config: Dict[str, Any] = {
        "src_lang": src_lang,
        "dst_lang": dst_lang,
    }

    # Include override fields in the UI config so the builder applies them
    if has_overrides:
        ui_config["batch_system_prompt"] = prompt_cfg.get("batch_system_prompt", "")
        ui_config["batch_user_template"] = prompt_cfg.get("batch_user_template", "")
        ui_config["single_system_prompt"] = prompt_cfg.get("single_system_prompt", "")
        ui_config["single_user_template"] = prompt_cfg.get("single_user_template", "")
        if "log_prompts" in prompt_cfg:
            ui_config["log_prompts"] = prompt_cfg.get("log_prompts", False)

    # Build the config through the same pipeline used for real jobs
    config = builder.build_config(ui_config=ui_config, preset_id=profile_name or None)

    resolved_prompt = config.prompt
    resolved_profile = resolved_prompt.profile_name or profile_name

    # Determine source
    if has_overrides and any([
        resolved_prompt.batch_system_prompt == prompt_cfg.get("batch_system_prompt"),
        resolved_prompt.single_system_prompt == prompt_cfg.get("single_system_prompt"),
    ]):
        source = "override"
    elif resolved_profile:
        source = "preset"
    else:
        source = "fallback"

    if not resolved_profile and not has_overrides:
        warnings.append("No prompt profile selected and no override templates provided")

    if not resolved_prompt.batch_user_template and not resolved_prompt.single_user_template:
        warnings.append("Both batch and single user templates are empty")

    return EffectivePromptResponse(
        profile_name=resolved_profile,
        batch_system_prompt=resolved_prompt.batch_system_prompt or "",
        batch_user_template=resolved_prompt.batch_user_template or "",
        single_system_prompt=resolved_prompt.single_system_prompt or "",
        single_user_template=resolved_prompt.single_user_template or "",
        log_prompts=resolved_prompt.log_prompts or False,
        source=source,
        warnings=warnings,
    )
