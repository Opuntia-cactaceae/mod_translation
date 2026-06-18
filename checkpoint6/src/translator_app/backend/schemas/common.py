"""Common/shared Pydantic schemas for the backend API."""

from pydantic import BaseModel
from typing import Any, Dict, List


class HealthResponse(BaseModel):
    status: str = "ok"
    app_version: str = "0.1.0"
    backend_ready: bool = True


class AppStateResponse(BaseModel):
    settings: Dict[str, Any] = {}
    active_jobs: list = []
    available_file_types: list = []
    available_strategies: Dict[str, List[str]] = {}
    warnings: list = []


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Dict[str, Any] = {}
    recoverable: bool = True


class ErrorResponse(BaseModel):
    error: ErrorDetail
