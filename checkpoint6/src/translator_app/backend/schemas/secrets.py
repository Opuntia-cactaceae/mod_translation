"""Pydantic schemas for the Secrets / API Keys API."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ApiKeyResponse(BaseModel):
    """Public representation of an API key — never contains the raw value."""

    id: str
    provider: str
    label: str = ""
    masked_value: str
    created_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    is_active: bool = True


class ApiKeyCreateRequest(BaseModel):
    provider: str = Field(..., min_length=1)
    value: str = Field(..., min_length=1)
    label: str = ""


class ApiKeyUpdateRequest(BaseModel):
    label: Optional[str] = None


class ApiKeyListResponse(BaseModel):
    keys: list[ApiKeyResponse]
    total: int


class DeleteKeyResponse(BaseModel):
    deleted: bool


class TestKeyRequest(BaseModel):
    provider: str = Field(..., min_length=1)
    value: str = Field(..., min_length=1)
    model: str = ""


class TestKeyResponse(BaseModel):
    valid: bool
    message: str = ""
    auth_ok: bool = False
    provider_reachable: bool = False
