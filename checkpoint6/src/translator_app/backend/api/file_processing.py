"""File processing API endpoints."""

import os
from fastapi import APIRouter, Depends

from translator_app.backend.schemas.files import FileInfo
from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import APIError, FILE_NOT_FOUND, NOT_IMPLEMENTED

router = APIRouter(tags=["file-processing"])


@router.post("/detect", response_model=dict)
def detect_file(body: dict, svcs: Services = Depends(get_services)):
    """Detect file type for a given file path."""
    file_path = body.get("file_path", "")
    if not os.path.exists(file_path):
        raise APIError(
            code=FILE_NOT_FOUND,
            message=f"File not found: {file_path}",
            status_code=404,
        )
    detection = svcs.file_processing.detect(file_path)
    return {
        "file_type": detection.file_type.category.value,
        "confidence": detection.confidence,
        "matched_by": detection.matched_by,
    }


@router.post("/parse", response_model=dict)
def parse_file(body: dict, svcs: Services = Depends(get_services)):
    """Parse a file and return its structure and translatable entries."""
    file_path = body.get("file_path", "")
    if not os.path.exists(file_path):
        raise APIError(
            code=FILE_NOT_FOUND,
            message=f"File not found: {file_path}",
            status_code=404,
        )

    parsed = svcs.file_processing.parse(file_path)
    file_type_value = parsed.file_type.category.value
    language = parsed.metadata.get("language", "") if parsed.metadata else ""
    language = parsed.header.replace(":", "").strip() if not language and parsed.header else language
    total_lines = len(parsed.entries)
    translatable = parsed.translatable_entries
    entries_data = []
    for e in parsed.entries:
        entries_data.append({
            "key": e.key,
            "value": e.value,
            "comment": e.comment,
            "line_number": e.line_number,
            "is_translatable": e.is_translatable,
            "translated": e.translated,
        })

    return {
        "file_path": file_path,
        "file_type": file_type_value,
        "language": language,
        "total_lines": total_lines,
        "translatable_entries": len(translatable),
        "entries": entries_data,
        "diagnostics": [],
    }


@router.post("/validate", response_model=dict)
def validate_file(body: dict, svcs: Services = Depends(get_services)):
    """Validate a parsed file."""
    file_path = body.get("file_path", "")
    if not os.path.exists(file_path):
        raise APIError(
            code=FILE_NOT_FOUND,
            message=f"File not found: {file_path}",
            status_code=404,
        )

    parsed = svcs.file_processing.parse(file_path)
    validator_name = parsed.file_type.category.value
    validator = svcs.registry.get_validator(validator_name)
    if not validator:
        raise APIError(
            code=NOT_IMPLEMENTED,
            message=f"No validator registered for file type: {validator_name}",
            status_code=501,
        )

    result = validator.validate(parsed)
    return {
        "is_valid": result.is_valid,
        "errors": [{"code": d.code, "message": d.message} for d in result.errors],
        "warnings": [{"code": d.code, "message": d.message} for d in result.warnings],
    }
