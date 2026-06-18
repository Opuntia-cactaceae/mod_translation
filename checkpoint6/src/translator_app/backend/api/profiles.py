"""Translation Profiles API endpoints.

Spec: Translation Profiles

Endpoints:
    GET    /api/translation-profiles                   — list all profiles
    GET    /api/translation-profiles/{profile_id}       — get single profile
    POST   /api/translation-profiles                    — create profile
    PUT    /api/translation-profiles/{profile_id}       — update profile
    DELETE /api/translation-profiles/{profile_id}       — delete profile
    POST   /api/translation-profiles/{profile_id}/copy  — copy profile
    POST   /api/translation-profiles/validate           — validate a profile
    GET    /api/translation-profiles/{profile_id}/export — export profile as JSON
    POST   /api/translation-profiles/import             — import profile from JSON
"""

from fastapi import APIRouter, Depends

from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import APIError, NOT_FOUND, INVALID_REQUEST
from translator_app.backend.schemas.profiles import (
    CopyProfileRequest,
    CreateProfileRequest,
    ExportProfileResponse,
    ImportProfileRequest,
    ProfileDiagnosticSchema,
    ProfileListResponse,
    ProfileResponse,
    UpdateProfileRequest,
    ValidateProfileRequest,
    ValidateProfileResponse,
)
from translator_app.backend.schemas.profiles import CleanupDuplicatesResponse
from translator_app.translation.profiles import INVALID_PROFILE_FORMAT

router = APIRouter(prefix="/api/translation-profiles", tags=["translation-profiles"])


def _profile_to_response(profile) -> ProfileResponse:
    """Convert a TranslationProfile dataclass to a Pydantic response model."""
    return ProfileResponse(
        id=profile.id,
        name=profile.name,
        description=profile.description,
        game=profile.game,
        file_handler=profile.file_handler,
        config=profile.config,
        is_system=profile.is_system,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


# ------------------------------------------------------------------
# GET /api/translation-profiles
# ------------------------------------------------------------------


@router.get("", response_model=ProfileListResponse)
def list_profiles(svcs: Services = Depends(get_services)):
    """List all translation profiles (system + user)."""
    profiles = svcs.translation_profiles.list_profiles()
    items = [_profile_to_response(p) for p in profiles]
    return ProfileListResponse(profiles=items, total=len(items))


# ------------------------------------------------------------------
# GET /api/translation-profiles/{profile_id}
# ------------------------------------------------------------------


@router.get("/{profile_id}", response_model=ProfileResponse)
def get_profile(profile_id: str, svcs: Services = Depends(get_services)):
    """Get a single translation profile by id."""
    profile = svcs.translation_profiles.get_profile(profile_id)
    if profile is None:
        raise APIError(
            code=NOT_FOUND,
            message=f"Translation profile not found: {profile_id}",
            status_code=404,
        )
    return _profile_to_response(profile)


# ------------------------------------------------------------------
# POST /api/translation-profiles
# ------------------------------------------------------------------


@router.post("", response_model=ProfileResponse, status_code=201)
def create_profile(body: CreateProfileRequest, svcs: Services = Depends(get_services)):
    """Create a new user translation profile."""
    # Validate first
    from translator_app.translation.profiles import TranslationProfile

    tmp = TranslationProfile(
        name=body.name,
        description=body.description,
        game=body.game,
        file_handler=body.file_handler,
        config=body.config,
    )
    diagnostics = svcs.translation_profiles.validate_profile(tmp)
    errors = [d for d in diagnostics if d.level == "error"]
    if errors:
        raise APIError(
            code=INVALID_REQUEST,
            message=errors[0].message,
            status_code=400,
        )

    try:
        profile = svcs.translation_profiles.create_profile(
            name=body.name,
            description=body.description,
            game=body.game,
            file_handler=body.file_handler,
            config=body.config,
        )
    except ValueError as exc:
        raise APIError(
            code=INVALID_REQUEST,
            message=str(exc),
            status_code=400,
        )
    return _profile_to_response(profile)


# ------------------------------------------------------------------
# PUT /api/translation-profiles/{profile_id}
# ------------------------------------------------------------------


@router.put("/{profile_id}", response_model=ProfileResponse)
def update_profile(
    profile_id: str,
    body: UpdateProfileRequest,
    svcs: Services = Depends(get_services),
):
    """Update an existing user translation profile."""
    try:
        profile = svcs.translation_profiles.update_profile(
            profile_id=profile_id,
            name=body.name,
            description=body.description,
            game=body.game,
            file_handler=body.file_handler,
            config=body.config,
        )
    except ValueError as exc:
        msg = str(exc)
        if "not found" in msg.lower():
            raise APIError(code=NOT_FOUND, message=msg, status_code=404)
        raise APIError(code=INVALID_REQUEST, message=msg, status_code=400)
    return _profile_to_response(profile)


# ------------------------------------------------------------------
# DELETE /api/translation-profiles/{profile_id}
# ------------------------------------------------------------------


@router.delete("/{profile_id}")
def delete_profile(profile_id: str, svcs: Services = Depends(get_services)):
    """Delete a user translation profile."""
    try:
        deleted = svcs.translation_profiles.delete_profile(profile_id)
    except ValueError as exc:
        raise APIError(code=INVALID_REQUEST, message=str(exc), status_code=400)
    if not deleted:
        raise APIError(
            code=NOT_FOUND,
            message=f"Translation profile not found: {profile_id}",
            status_code=404,
        )
    return {"deleted": True}


# ------------------------------------------------------------------
# POST /api/translation-profiles/{profile_id}/copy
# ------------------------------------------------------------------


@router.post("/{profile_id}/copy", response_model=ProfileResponse, status_code=201)
def copy_profile(
    profile_id: str,
    body: CopyProfileRequest,
    svcs: Services = Depends(get_services),
):
    """Copy a system (or user) profile into a new editable user profile."""
    try:
        new_profile = svcs.translation_profiles.copy_profile(
            profile_id=profile_id,
            new_name=body.new_name,
        )
    except ValueError as exc:
        msg = str(exc)
        if "not found" in msg.lower():
            raise APIError(code=NOT_FOUND, message=msg, status_code=404)
        raise APIError(code=INVALID_REQUEST, message=msg, status_code=400)
    return _profile_to_response(new_profile)


# ------------------------------------------------------------------
# POST /api/translation-profiles/validate
# ------------------------------------------------------------------


@router.post("/validate", response_model=ValidateProfileResponse)
def validate_profile(body: ValidateProfileRequest, svcs: Services = Depends(get_services)):
    """Validate a translation profile without saving it."""
    from translator_app.translation.profiles import TranslationProfile

    tmp = TranslationProfile(
        name=body.name or "tmp",
        game=body.game,
        file_handler=body.file_handler,
        config=body.config,
        description=body.description,
    )
    diagnostics = svcs.translation_profiles.validate_profile(tmp)
    errors = [d for d in diagnostics if d.level == "error"]
    return ValidateProfileResponse(
        is_valid=len(errors) == 0,
        diagnostics=[
            ProfileDiagnosticSchema(
                level=d.level,
                code=d.code,
                message=d.message,
                field=d.field,
            )
            for d in diagnostics
        ],
    )


# ------------------------------------------------------------------
# GET /api/translation-profiles/{profile_id}/export
# ------------------------------------------------------------------


@router.get("/{profile_id}/export", response_model=ExportProfileResponse)
def export_profile(profile_id: str, svcs: Services = Depends(get_services)):
    """Export a profile as JSON (no system/internal fields)."""
    try:
        data = svcs.translation_profiles.export_profile(profile_id)
    except ValueError as exc:
        raise APIError(
            code=NOT_FOUND,
            message=str(exc),
            status_code=404,
        )
    return ExportProfileResponse(**data)


# ------------------------------------------------------------------
# POST /api/translation-profiles/import
# ------------------------------------------------------------------


@router.post("/import", response_model=ProfileResponse, status_code=201)
def import_profile(body: ImportProfileRequest, svcs: Services = Depends(get_services)):
    """Import a profile from a JSON dict."""
    try:
        profile = svcs.translation_profiles.import_profile(body.data)
    except ValueError as exc:
        raise APIError(
            code=INVALID_PROFILE_FORMAT,
            message=str(exc),
            status_code=400,
        )
    return _profile_to_response(profile)


# ------------------------------------------------------------------
# POST /api/translation-profiles/cleanup-duplicates
# ------------------------------------------------------------------


@router.post("/cleanup-duplicates", response_model=CleanupDuplicatesResponse)
def cleanup_duplicate_profiles(svcs: Services = Depends(get_services)):
    """Remove duplicate user profiles, keeping only the newest per
    (name, game, file_handler) triplet.

    Returns the number of removed profiles and the remaining count.
    """
    removed = svcs.translation_profiles.cleanup_duplicate_profiles()
    total = len(svcs.translation_profiles.list_profiles())
    return CleanupDuplicatesResponse(
        removed=removed,
        remaining=total,
    )
