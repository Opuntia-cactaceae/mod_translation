"""Settings API endpoints."""

from fastapi import APIRouter, Depends

from translator_app.backend.schemas.settings import (
    SettingsResponse,
    SettingsUpdateRequest,
    ValidatePathRequest,
    ValidatePathResponse,
)
from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import APIError, INTERNAL_ERROR
from translator_app.settings.validation import validate_path

router = APIRouter(tags=["settings"])


@router.get("", response_model=SettingsResponse)
def get_settings(svcs: Services = Depends(get_services)):
    """Get current application settings."""
    svcs.settings.load()
    return SettingsResponse(settings=svcs.settings.export_settings())


@router.put("", response_model=SettingsResponse)
def update_settings(body: SettingsUpdateRequest, svcs: Services = Depends(get_services)):
    """Update application settings."""
    try:
        svcs.settings.update_settings(body.settings)
        svcs.settings.save()
    except Exception as e:
        raise APIError(
            code=INTERNAL_ERROR,
            message=f"Failed to update settings: {e}",
            status_code=500,
        )
    return SettingsResponse(settings=svcs.settings.export_settings())


@router.post("/validate-path", response_model=ValidatePathResponse)
def validate_settings_path(body: ValidatePathRequest):
    """Check if a path is valid/suitable for use by the app."""
    vr = validate_path(
        path=body.path,
        expected_type=body.expected_type,
        need_read=body.need_read,
        need_write=body.need_write,
        create_if_missing=body.create_if_missing,
    )
    return ValidatePathResponse(
        is_valid=vr.valid,
        message=vr.errors[0] if vr.errors else ("Path is valid" if vr.valid else ""),
        exists=vr.exists,
        is_directory=vr.is_directory,
        can_read=vr.can_read,
        can_write=vr.can_write,
        errors=vr.errors,
        warnings=vr.warnings,
    )


# Backward-compatible function exports
get_settings_handler = get_settings
update_settings_handler = update_settings
