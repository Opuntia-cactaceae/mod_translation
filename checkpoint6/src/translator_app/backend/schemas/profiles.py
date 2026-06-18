"""Translation profiles Pydantic schemas for the backend API.

Spec: Translation Profiles
"""

from pydantic import BaseModel
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------


class ProfileDiagnosticSchema(BaseModel):
    """Validation diagnostic for a single field."""
    level: str = "error"
    code: str = ""
    message: str = ""
    field: str = ""


# ---------------------------------------------------------------------------
# Profile models
# ---------------------------------------------------------------------------


class ProfileResponse(BaseModel):
    """Full profile data returned by the API."""
    id: str = ""
    name: str = ""
    description: str = ""
    game: str = "stellaris"
    file_handler: Optional[str] = None
    config: Dict[str, Any] = {}
    is_system: bool = False
    created_at: str = ""
    updated_at: str = ""


class ProfileListResponse(BaseModel):
    """List of profiles."""
    profiles: List[ProfileResponse] = []
    total: int = 0


# ---------------------------------------------------------------------------
# CRUD request models
# ---------------------------------------------------------------------------


class CreateProfileRequest(BaseModel):
    name: str
    description: str = ""
    game: str = "stellaris"
    file_handler: Optional[str] = None
    config: Dict[str, Any] = {}


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    game: Optional[str] = None
    file_handler: Optional[str] = None
    config: Optional[Dict[str, Any]] = None


class CopyProfileRequest(BaseModel):
    new_name: str


# ---------------------------------------------------------------------------
# Validate
# ---------------------------------------------------------------------------


class ValidateProfileRequest(BaseModel):
    name: str = ""
    description: str = ""
    game: str = "stellaris"
    file_handler: Optional[str] = None
    config: Dict[str, Any] = {}


class ValidateProfileResponse(BaseModel):
    is_valid: bool = True
    diagnostics: List[ProfileDiagnosticSchema] = []


# ---------------------------------------------------------------------------
# Export / Import
# ---------------------------------------------------------------------------


class ExportProfileResponse(BaseModel):
    name: str = ""
    description: str = ""
    game: str = "stellaris"
    file_handler: Optional[str] = None
    config: Dict[str, Any] = {}


class ImportProfileRequest(BaseModel):
    data: Dict[str, Any]


# ---------------------------------------------------------------------------
# Cleanup duplicates
# ---------------------------------------------------------------------------


class CleanupDuplicatesResponse(BaseModel):
    removed: int = 0
    remaining: int = 0
