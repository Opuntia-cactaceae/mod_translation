"""Prompt Presets API endpoints.

Spec: #16 Prompt Presets Module

Endpoints:
    GET    /api/prompt-presets              — list all presets
    GET    /api/prompt-presets/{preset_id}   — get single preset
    POST   /api/prompt-presets               — create preset
    PUT    /api/prompt-presets/{preset_id}   — update preset
    DELETE /api/prompt-presets/{preset_id}   — delete preset
    POST   /api/prompt-presets/{preset_id}/copy        — copy system preset
    POST   /api/prompt-presets/validate                 — validate a preset
    GET    /api/prompt-presets/{preset_id}/export       — export preset as JSON
    POST   /api/prompt-presets/import                   — import preset from JSON
"""

from fastapi import APIRouter, Depends

from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import APIError, NOT_FOUND, INVALID_REQUEST
from translator_app.backend.schemas.presets import (
    CopyPresetRequest,
    CreatePresetRequest,
    ExportPresetResponse,
    ImportPresetRequest,
    PresetListResponse,
    PresetResponse,
    PromptDiagnosticSchema,
    UpdatePresetRequest,
    ValidatePresetRequest,
    ValidatePresetResponse,
)
from translator_app.translation.prompt_presets import INVALID_PRESET_FORMAT

router = APIRouter(prefix="/api/prompt-presets", tags=["prompt-presets"])


def _preset_to_response(preset) -> PresetResponse:
    """Convert a PromptPreset dataclass to a Pydantic response model."""
    return PresetResponse(
        id=preset.id,
        name=preset.name,
        description=preset.description,
        profile_name=preset.profile_name,
        batch_system_prompt=preset.batch_system_prompt,
        batch_user_template=preset.batch_user_template,
        single_system_prompt=preset.single_system_prompt,
        single_user_template=preset.single_user_template,
        log_prompts=preset.log_prompts,
        is_system=preset.is_system,
        created_at=preset.created_at,
        updated_at=preset.updated_at,
        version=preset.version,
    )


# ------------------------------------------------------------------
# GET /api/prompt-presets
# ------------------------------------------------------------------


@router.get("", response_model=PresetListResponse)
def list_presets(svcs: Services = Depends(get_services)):
    """List all prompt presets (system + user)."""
    presets = svcs.prompt_presets.list_presets()
    items = [_preset_to_response(p) for p in presets]
    return PresetListResponse(presets=items, total=len(items))


# ------------------------------------------------------------------
# GET /api/prompt-presets/{preset_id}
# ------------------------------------------------------------------


@router.get("/{preset_id}", response_model=PresetResponse)
def get_preset(preset_id: str, svcs: Services = Depends(get_services)):
    """Get a single prompt preset by id."""
    preset = svcs.prompt_presets.get_preset(preset_id)
    if preset is None:
        raise APIError(
            code=NOT_FOUND,
            message=f"Prompt preset not found: {preset_id}",
            status_code=404,
        )
    return _preset_to_response(preset)


# ------------------------------------------------------------------
# POST /api/prompt-presets
# ------------------------------------------------------------------


@router.post("", response_model=PresetResponse, status_code=201)
def create_preset(body: CreatePresetRequest, svcs: Services = Depends(get_services)):
    """Create a new user prompt preset."""
    try:
        preset = svcs.prompt_presets.create_preset(
            name=body.name,
            profile_name=body.profile_name,
            description=body.description,
            batch_system_prompt=body.batch_system_prompt,
            batch_user_template=body.batch_user_template,
            single_system_prompt=body.single_system_prompt,
            single_user_template=body.single_user_template,
            log_prompts=body.log_prompts,
        )
    except ValueError as exc:
        raise APIError(
            code=INVALID_REQUEST,
            message=str(exc),
            status_code=400,
        )
    return _preset_to_response(preset)


# ------------------------------------------------------------------
# PUT /api/prompt-presets/{preset_id}
# ------------------------------------------------------------------


@router.put("/{preset_id}", response_model=PresetResponse)
def update_preset(
    preset_id: str,
    body: UpdatePresetRequest,
    svcs: Services = Depends(get_services),
):
    """Update an existing user prompt preset."""
    try:
        preset = svcs.prompt_presets.update_preset(
            preset_id=preset_id,
            name=body.name,
            description=body.description,
            profile_name=body.profile_name,
            batch_system_prompt=body.batch_system_prompt,
            batch_user_template=body.batch_user_template,
            single_system_prompt=body.single_system_prompt,
            single_user_template=body.single_user_template,
            log_prompts=body.log_prompts,
        )
    except ValueError as exc:
        msg = str(exc)
        if "not found" in msg.lower():
            raise APIError(code=NOT_FOUND, message=msg, status_code=404)
        raise APIError(code=INVALID_REQUEST, message=msg, status_code=400)
    return _preset_to_response(preset)


# ------------------------------------------------------------------
# DELETE /api/prompt-presets/{preset_id}
# ------------------------------------------------------------------


@router.delete("/{preset_id}")
def delete_preset(preset_id: str, svcs: Services = Depends(get_services)):
    """Delete a user prompt preset."""
    try:
        deleted = svcs.prompt_presets.delete_preset(preset_id)
    except ValueError as exc:
        raise APIError(code=INVALID_REQUEST, message=str(exc), status_code=400)
    if not deleted:
        raise APIError(
            code=NOT_FOUND,
            message=f"Prompt preset not found: {preset_id}",
            status_code=404,
        )
    return {"deleted": True}


# ------------------------------------------------------------------
# POST /api/prompt-presets/{preset_id}/copy
# ------------------------------------------------------------------


@router.post("/{preset_id}/copy", response_model=PresetResponse, status_code=201)
def copy_preset(
    preset_id: str,
    body: CopyPresetRequest,
    svcs: Services = Depends(get_services),
):
    """Copy a system (or user) preset into a new editable user preset."""
    try:
        new_preset = svcs.prompt_presets.copy_system_preset(
            preset_id=preset_id,
            new_name=body.new_name,
        )
    except ValueError as exc:
        msg = str(exc)
        if "not found" in msg.lower():
            raise APIError(code=NOT_FOUND, message=msg, status_code=404)
        raise APIError(code=INVALID_REQUEST, message=msg, status_code=400)
    return _preset_to_response(new_preset)


# ------------------------------------------------------------------
# POST /api/prompt-presets/validate
# ------------------------------------------------------------------


@router.post("/validate", response_model=ValidatePresetResponse)
def validate_preset(body: ValidatePresetRequest, svcs: Services = Depends(get_services)):
    """Validate a prompt preset without saving it."""
    from translator_app.translation.prompt_presets import PromptPreset

    tmp = PromptPreset(
        name=body.name or "tmp",
        profile_name=body.profile_name,
        batch_system_prompt=body.batch_system_prompt,
        batch_user_template=body.batch_user_template,
        single_system_prompt=body.single_system_prompt,
        single_user_template=body.single_user_template,
        log_prompts=body.log_prompts,
    )
    diagnostics = svcs.prompt_presets.validate_preset(tmp)
    errors = [d for d in diagnostics if d.level == "error"]
    return ValidatePresetResponse(
        is_valid=len(errors) == 0,
        diagnostics=[
            PromptDiagnosticSchema(
                level=d.level,
                code=d.code,
                message=d.message,
                field=d.field,
            )
            for d in diagnostics
        ],
    )


# ------------------------------------------------------------------
# GET /api/prompt-presets/{preset_id}/export
# ------------------------------------------------------------------


@router.get("/{preset_id}/export", response_model=ExportPresetResponse)
def export_preset(preset_id: str, svcs: Services = Depends(get_services)):
    """Export a preset as JSON (no system/internal fields)."""
    try:
        data = svcs.prompt_presets.export_preset(preset_id)
    except ValueError as exc:
        raise APIError(
            code=NOT_FOUND,
            message=str(exc),
            status_code=404,
        )
    return ExportPresetResponse(**data)


# ------------------------------------------------------------------
# POST /api/prompt-presets/import
# ------------------------------------------------------------------


@router.post("/import", response_model=PresetResponse, status_code=201)
def import_preset(body: ImportPresetRequest, svcs: Services = Depends(get_services)):
    """Import a preset from a JSON dict."""
    try:
        preset = svcs.prompt_presets.import_preset(body.data)
    except ValueError as exc:
        raise APIError(
            code=INVALID_PRESET_FORMAT,
            message=str(exc),
            status_code=400,
        )
    return _preset_to_response(preset)
