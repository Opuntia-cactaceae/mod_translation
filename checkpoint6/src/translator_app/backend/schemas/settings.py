"""Settings-related Pydantic schemas."""

from pydantic import BaseModel
from typing import Any, Dict, List, Optional


class SettingsResponse(BaseModel):
    settings: Dict[str, Any] = {}


class SettingsUpdateRequest(BaseModel):
    settings: Dict[str, Any]


class ValidatePathRequest(BaseModel):
    path: str
    expected_type: Optional[str] = None
    need_read: bool = False
    need_write: bool = False
    create_if_missing: bool = False


class ValidatePathResponse(BaseModel):
    is_valid: bool
    message: str = ""
    exists: Optional[bool] = None
    is_directory: Optional[bool] = None
    can_read: Optional[bool] = None
    can_write: Optional[bool] = None
    errors: List[str] = []
    warnings: List[str] = []
