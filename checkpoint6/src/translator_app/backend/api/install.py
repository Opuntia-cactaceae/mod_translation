"""Mod Install API endpoints (#12)."""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends

from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import (
    APIError,
    SOURCE_NOT_FOUND,
    SOURCE_NOT_DIRECTORY,
    TARGET_DIR_NOT_FOUND,
    TARGET_NOT_WRITABLE,
    TARGET_ALREADY_EXISTS,
)
from translator_app.backend.schemas.install import (
    InstallPreviewSchema,
    InstallRequestSchema,
    InstallResultSchema,
)
from translator_app.mods.install_models import InstallRequest

router = APIRouter(tags=["mods-install"])


@router.post(
    "/api/mods/install/preview",
    response_model=InstallPreviewSchema,
    summary="Preview mod install/move operation",
)
def preview_install(
    body: InstallRequestSchema,
    svcs: Services = Depends(get_services),
):
    """Preview a mod install/move without modifying filesystem.

    Returns estimated file/byte counts and the action that would be taken.
    """
    request = InstallRequest(
        source_path=body.source_path,
        target_dir=body.target_dir,
        mode=body.mode,
        overwrite=body.overwrite,
        backup_on_overwrite=body.backup_on_overwrite,
        rename_on_conflict=body.rename_on_conflict,
        dry_run=body.dry_run,
    )
    preview = svcs.mod_install.preview_install(request)

    return InstallPreviewSchema(
        operation=preview.operation,
        target_path=preview.target_path,
        conflict=preview.conflict,
        action=preview.action,
        estimated_files=preview.estimated_files,
        estimated_bytes=preview.estimated_bytes,
        warnings=preview.warnings,
        errors=preview.errors,
    )


@router.post(
    "/api/mods/install",
    response_model=InstallResultSchema,
    summary="Install or move a mod",
)
def install_mod(
    body: InstallRequestSchema,
    svcs: Services = Depends(get_services),
):
    """Install or move a mod into the Stellaris mods folder.

    Supports copy and move modes, conflict resolution (overwrite/rename),
    backup on overwrite, and dry-run preview.
    """
    # --- Pre-validation for meaningful HTTP errors ---
    if not os.path.exists(body.source_path):
        raise APIError(
            code=SOURCE_NOT_FOUND,
            message=f"Source path not found: {body.source_path}",
            status_code=404,
        )
    if not os.path.isdir(body.source_path):
        raise APIError(
            code=SOURCE_NOT_DIRECTORY,
            message=f"Source is not a directory: {body.source_path}",
            status_code=400,
        )
    if not os.path.exists(body.target_dir):
        raise APIError(
            code=TARGET_DIR_NOT_FOUND,
            message=f"Target directory not found: {body.target_dir}",
            status_code=404,
        )
    if not os.path.isdir(body.target_dir):
        raise APIError(
            code=TARGET_DIR_NOT_FOUND,
            message=f"Target is not a directory: {body.target_dir}",
            status_code=400,
        )
    if not os.access(body.target_dir, os.W_OK):
        raise APIError(
            code=TARGET_NOT_WRITABLE,
            message=f"Target directory is not writable: {body.target_dir}",
            status_code=403,
        )

    # Additional conflict check for non-overwrite, non-rename scenarios
    target_path = os.path.join(
        body.target_dir, os.path.basename(os.path.normpath(body.source_path))
    )
    if (
        os.path.exists(target_path)
        and not body.overwrite
        and not body.rename_on_conflict
    ):
        raise APIError(
            code=TARGET_ALREADY_EXISTS,
            message=f"Target already exists: {target_path}",
            details={"target_path": target_path},
            status_code=409,
        )

    request = InstallRequest(
        source_path=body.source_path,
        target_dir=body.target_dir,
        mode=body.mode,
        overwrite=body.overwrite,
        backup_on_overwrite=body.backup_on_overwrite,
        rename_on_conflict=body.rename_on_conflict,
        dry_run=body.dry_run,
    )
    result = svcs.mod_install.install_mod(request)

    return InstallResultSchema(
        success=result.success,
        partial=result.partial,
        operation_type=result.operation_type,
        source_path=result.source_path,
        target_path=result.target_path,
        final_path=result.final_path,
        files_copied=result.files_copied,
        files_moved=result.files_moved,
        files_skipped=result.files_skipped,
        bytes_processed=result.bytes_processed,
        duration_ms=result.duration_ms,
        backup_path=result.backup_path,
        warnings=result.warnings,
        errors=result.errors,
    )
