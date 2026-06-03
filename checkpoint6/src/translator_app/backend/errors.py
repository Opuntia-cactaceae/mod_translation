"""Unified error format and FastAPI error handlers."""

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from typing import Any, Dict

from translator_app.backend.schemas.common import ErrorDetail, ErrorResponse


class APIError(Exception):
    """Base API error with unified format."""

    def __init__(
        self,
        code: str,
        message: str,
        details: Dict[str, Any] = None,
        recoverable: bool = True,
        status_code: int = 400,
    ):
        self.code = code
        self.message = message
        self.details = details or {}
        self.recoverable = recoverable
        self.status_code = status_code
        super().__init__(message)

    def to_response(self) -> ErrorResponse:
        return ErrorResponse(
            error=ErrorDetail(
                code=self.code,
                message=self.message,
                details=self.details,
                recoverable=self.recoverable,
            )
        )

    def to_json(self) -> Dict[str, Any]:
        return self.to_response().model_dump()


# Predefined error codes
INVALID_REQUEST = "INVALID_REQUEST"
NOT_FOUND = "NOT_FOUND"
NOT_IMPLEMENTED = "NOT_IMPLEMENTED"
PATH_NOT_FOUND = "PATH_NOT_FOUND"
FILE_NOT_FOUND = "FILE_NOT_FOUND"
FILE_READ_FAILED = "FILE_READ_FAILED"
CONFIG_VALIDATION_ERROR = "CONFIG_VALIDATION_ERROR"
JOB_NOT_FOUND = "JOB_NOT_FOUND"
INTERNAL_ERROR = "INTERNAL_ERROR"

# Editor Module error codes (spec #25)
ROW_NOT_FOUND = "ROW_NOT_FOUND"
INVALID_EDIT = "INVALID_EDIT"
SAVE_FAILED = "SAVE_FAILED"

# Job Manager error codes (spec #21)
INVALID_JOB_STATE = "INVALID_JOB_STATE"
JOB_ALREADY_RUNNING = "JOB_ALREADY_RUNNING"
JOB_NOT_PAUSED = "JOB_NOT_PAUSED"
JOB_RESUME_FAILED = "JOB_RESUME_FAILED"
JOB_CANCEL_FAILED = "JOB_CANCEL_FAILED"
CANNOT_CHANGE_LANGUAGE = "CANNOT_CHANGE_LANGUAGE"
NO_FAILED_UNITS = "NO_FAILED_UNITS"


# Mod Install error codes (spec #12)
SOURCE_NOT_FOUND = "SOURCE_NOT_FOUND"
SOURCE_NOT_DIRECTORY = "SOURCE_NOT_DIRECTORY"
TARGET_DIR_NOT_FOUND = "TARGET_DIR_NOT_FOUND"
TARGET_NOT_WRITABLE = "TARGET_NOT_WRITABLE"
TARGET_ALREADY_EXISTS = "TARGET_ALREADY_EXISTS"
COPY_FAILED = "COPY_FAILED"
MOVE_FAILED = "MOVE_FAILED"
DELETE_FAILED = "DELETE_FAILED"
BACKUP_FAILED = "BACKUP_FAILED"
PERMISSION_DENIED = "PERMISSION_DENIED"
DISK_FULL = "DISK_FULL"

# Provider Models error codes
PROVIDER_MODEL_CONFLICT = "PROVIDER_MODEL_CONFLICT"
PROVIDER_MODEL_DELETE_BUILTIN = "PROVIDER_MODEL_DELETE_BUILTIN"
PROVIDER_MODEL_NOT_FOUND = "PROVIDER_MODEL_NOT_FOUND"

# Custom Protection Rules error codes
RULE_NOT_FOUND = "RULE_NOT_FOUND"
RULE_INVALID_PATTERN = "RULE_INVALID_PATTERN"
RULE_NAME_CONFLICT = "RULE_NAME_CONFLICT"
RULE_LIMIT_EXCEEDED = "RULE_LIMIT_EXCEEDED"

# Protection Analysis error codes
ANALYSIS_INVALID_INPUT = "ANALYSIS_INVALID_INPUT"

# Protection Profiles error codes
PROFILE_NOT_FOUND = "PROFILE_NOT_FOUND"
PROFILE_NAME_CONFLICT = "PROFILE_NAME_CONFLICT"
CANDIDATE_NOT_FOUND = "CANDIDATE_NOT_FOUND"
PROFILE_LIMIT_EXCEEDED = "PROFILE_LIMIT_EXCEEDED"

# Stellaris Cache Module error codes (spec #14)
CACHE_PATH_NOT_FOUND = "CACHE_PATH_NOT_FOUND"
CACHE_NOT_READABLE = "CACHE_NOT_READABLE"
CACHE_NOT_WRITABLE = "CACHE_NOT_WRITABLE"
CACHE_DETECTION_FAILED = "CACHE_DETECTION_FAILED"
CACHE_DELETE_FAILED = "CACHE_DELETE_FAILED"
SUSPICIOUS_PATH = "SUSPICIOUS_PATH"


def api_error(
    code: str,
    message: str,
    details: Dict[str, Any] = None,
    recoverable: bool = True,
    status_code: int = 400,
) -> APIError:
    return APIError(
        code=code,
        message=message,
        details=details,
        recoverable=recoverable,
        status_code=status_code,
    )


async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_json(),
    )


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            error=ErrorDetail(
                code="HTTP_ERROR",
                message=str(exc.detail),
                recoverable=exc.status_code < 500,
            )
        ).model_dump(),
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            error=ErrorDetail(
                code=INTERNAL_ERROR,
                message="An unexpected error occurred.",
                recoverable=False,
            )
        ).model_dump(),
    )
