"""Descriptor API endpoints (spec #13)."""

import os

from fastapi import APIRouter, Depends, Query

from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import APIError, FILE_NOT_FOUND, FILE_READ_FAILED
from translator_app.backend.schemas.descriptors import (
    DescriptorPreviewRequest,
    DescriptorPreviewResponse,
    DescriptorReadResponse,
    DescriptorValidateRequest,
    DescriptorValidateResponse,
    DescriptorWriteRequest,
    DescriptorWriteResponse,
)

router = APIRouter(tags=["descriptors"])


@router.get("/descriptors/read", response_model=DescriptorReadResponse)
def read_descriptor(
    path: str = Query(..., description="Path to the descriptor.mod file"),
    svcs: Services = Depends(get_services),
):
    """Read and parse a descriptor.mod file."""
    if not os.path.exists(path):
        raise APIError(
            code=FILE_NOT_FOUND,
            message=f"Descriptor file not found: {path}",
            status_code=404,
        )
    if not os.path.isfile(path):
        raise APIError(
            code=FILE_READ_FAILED,
            message=f"Not a file: {path}",
            status_code=400,
        )

    descriptor = svcs.descriptor.read_descriptor(path)
    descriptor_text = svcs.descriptor.serialize_descriptor(descriptor)

    warnings = [d.code for d in descriptor.diagnostics if d.code]
    errors = [d.code for d in descriptor.diagnostics if d.code]

    return DescriptorReadResponse(
        name=descriptor.name,
        path=descriptor.path,
        supported_version=descriptor.supported_version,
        tags=descriptor.tags,
        picture=descriptor.picture,
        remote_file_id=descriptor.remote_file_id,
        raw_fields=descriptor.raw_fields,
        source_path=descriptor.source_path,
        descriptor_text=descriptor_text,
        warnings=warnings,
        errors=errors,
    )


@router.post("/descriptors/preview", response_model=DescriptorPreviewResponse)
def preview_descriptor(
    body: DescriptorPreviewRequest,
    svcs: Services = Depends(get_services),
):
    """Preview descriptor text without writing to disk."""
    descriptor_text = svcs.descriptor.preview_descriptor(
        mod_path=body.mod_path,
        target_mods_dir=body.target_mods_dir,
        name=body.name,
        supported_version=body.supported_version,
        tags=body.tags,
        picture=body.picture,
        remote_file_id=body.remote_file_id,
    )

    folder_name = os.path.basename(body.mod_path.rstrip("/\\"))
    descriptor_path = os.path.join(body.mod_path, "descriptor.mod")

    # Run create (without write) to collect warnings
    result = svcs.descriptor.create_descriptor(
        mod_path=body.mod_path,
        target_mods_dir=body.target_mods_dir,
        name=body.name,
        supported_version=body.supported_version,
        tags=body.tags,
        picture=body.picture,
        remote_file_id=body.remote_file_id,
        write=False,
    )

    return DescriptorPreviewResponse(
        descriptor_text=descriptor_text,
        descriptor_path=descriptor_path,
        warnings=result.warnings,
        errors=result.errors,
    )


@router.post("/descriptors/write", response_model=DescriptorWriteResponse)
def write_descriptor(
    body: DescriptorWriteRequest,
    svcs: Services = Depends(get_services),
):
    """Create a descriptor.mod file on disk."""
    result = svcs.descriptor.create_descriptor(
        mod_path=body.mod_path,
        target_mods_dir=body.target_mods_dir,
        name=body.name,
        supported_version=body.supported_version,
        tags=body.tags,
        picture=body.picture,
        remote_file_id=body.remote_file_id,
        write=True,
    )

    return DescriptorWriteResponse(
        descriptor_path=result.descriptor_path,
        descriptor_text=result.descriptor_text,
        created=result.created,
        warnings=result.warnings,
        errors=result.errors,
    )


@router.post("/descriptors/validate", response_model=DescriptorValidateResponse)
def validate_descriptor(
    body: DescriptorValidateRequest,
    svcs: Services = Depends(get_services),
):
    """Validate a descriptor file."""
    if not os.path.exists(body.descriptor_path):
        raise APIError(
            code=FILE_NOT_FOUND,
            message=f"Descriptor file not found: {body.descriptor_path}",
            status_code=404,
        )

    descriptor = svcs.descriptor.read_descriptor(body.descriptor_path)
    validation = svcs.descriptor.validate_descriptor(
        descriptor,
        mod_path=body.mod_path,
        target_mods_dir=body.target_mods_dir,
    )

    warnings = []
    errors = []
    for d in validation.diagnostics:
        if d.level.name in ("WARNING",):
            if d.code and d.code not in warnings:
                warnings.append(d.code)
        elif d.level.name in ("ERROR", "CRITICAL"):
            if d.code and d.code not in errors:
                errors.append(d.code)

    return DescriptorValidateResponse(
        is_valid=validation.is_valid,
        warnings=warnings,
        errors=errors,
    )
