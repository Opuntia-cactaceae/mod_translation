"""Mod Install / Move Module (#12).

Handles copying and moving mod directories to the Stellaris mods folder
with conflict resolution, backup support, and dry-run preview.
"""

from __future__ import annotations

import os
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

from translator_app.mods.install_models import (
    InstallPreview,
    InstallRequest,
    InstallResult,
)

# ---------------------------------------------------------------------------
# Error codes
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class ModInstallService:
    """Service for installing/moving mods with conflict resolution and backup."""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def preview_install(self, request: InstallRequest) -> InstallPreview:
        """Preview an install/move operation without modifying the filesystem.

        Returns an InstallPreview with estimated file/byte counts and the
        action that *would* be taken.
        """
        errors: List[str] = []
        warnings: List[str] = []

        # Validate source
        source_validation = self._validate_source(request.source_path)
        if source_validation:
            errors.append(source_validation)
            return InstallPreview(
                operation=request.mode,
                target_path="",
                conflict=False,
                action="error",
                estimated_files=0,
                estimated_bytes=0,
                warnings=warnings,
                errors=errors,
            )

        # Validate target dir
        target_validation = self._validate_target_dir(request.target_dir)
        if target_validation:
            errors.append(target_validation)
            return InstallPreview(
                operation=request.mode,
                target_path="",
                conflict=False,
                action="error",
                estimated_files=0,
                estimated_bytes=0,
                warnings=warnings,
                errors=errors,
            )

        target_path = self._build_target_path(request.target_dir, request.source_path)
        conflict = os.path.exists(target_path)

        # Estimate
        estimated_files, estimated_bytes = self._estimate_directory(
            request.source_path
        )

        # Determine action
        action = self._resolve_conflict_action(
            conflict, request.overwrite, request.rename_on_conflict,
            request.backup_on_overwrite,
        )
        if action == "error":
            errors.append(TARGET_ALREADY_EXISTS)
        elif action == "overwrite_with_backup":
            warnings.append("backup will be created before overwrite")

        return InstallPreview(
            operation=request.mode,
            target_path=target_path,
            conflict=conflict,
            action=action,
            estimated_files=estimated_files,
            estimated_bytes=estimated_bytes,
            warnings=warnings,
            errors=errors,
        )

    def install_mod(self, request: InstallRequest) -> InstallResult:
        """Execute an install/move operation.

        If ``dry_run`` is ``True`` no filesystem changes are made and an
        ``InstallResult`` with ``success=True`` and zero counts is returned.
        """
        start = time.monotonic()
        errors: List[str] = []
        warnings: List[str] = []

        # --- 1. Validate source ---
        source_validation = self._validate_source(request.source_path)
        if source_validation:
            return self._error_result(
                request, source_validation, errors, start
            )

        # --- 2. Validate target dir ---
        target_validation = self._validate_target_dir(request.target_dir)
        if target_validation:
            return self._error_result(
                request, target_validation, errors, start
            )

        # --- 3. Build target path ---
        target_path = self._build_target_path(request.target_dir, request.source_path)
        final_path = target_path
        backup_path: Optional[str] = None
        conflict = os.path.exists(target_path)

        # --- 4. Dry-run check (must be before conflict resolution) ---
        if request.dry_run:
            return InstallResult(
                success=True,
                partial=False,
                operation_type=request.mode,
                source_path=request.source_path,
                target_path=target_path,
                final_path=target_path,
                files_copied=0,
                files_moved=0,
                files_skipped=0,
                bytes_processed=0,
                duration_ms=0,
                backup_path=None,
                warnings=warnings,
                errors=[],
            )

        # --- 5. Resolve conflict ---
        if conflict:
            final_path = self._resolve_conflict(
                target_path,
                request.overwrite,
                request.rename_on_conflict,
                request.backup_on_overwrite,
                warnings,
                errors,
            )
            if not final_path:
                # Conflict could not be resolved
                return self._error_result(
                    request, TARGET_ALREADY_EXISTS, errors, start,
                    target_path=target_path,
                    warnings=warnings,
                )

            # Record backup path if one was created
            backup_candidates = list(
                Path(request.target_dir, ".backup").glob(
                    f"{Path(target_path).name}_*"
                )
            )
            if backup_candidates:
                backup_path = str(sorted(backup_candidates)[-1])

        # --- 6. Execute operation ---
        if request.mode == "copy":
            files_copied, bytes_copied, op_errors = self._copy_directory(
                request.source_path, final_path
            )
            files_moved = 0
            bytes_processed = bytes_copied
        elif request.mode == "move":
            files_moved, bytes_moved, op_errors = self._move_directory(
                request.source_path, final_path
            )
            files_copied = 0
            bytes_processed = bytes_moved
        else:
            return self._error_result(
                request, f"Unknown mode: {request.mode}", errors, start,
            )

        errors.extend(op_errors)

        # Determine success
        success = len(errors) == 0
        partial = len(errors) > 0 and (files_copied > 0 or files_moved > 0)

        duration_ms = int((time.monotonic() - start) * 1000)

        return InstallResult(
            success=success,
            partial=partial,
            operation_type=request.mode,
            source_path=request.source_path,
            target_path=target_path,
            final_path=final_path,
            files_copied=files_copied,
            files_moved=files_moved,
            files_skipped=0,
            bytes_processed=bytes_processed,
            duration_ms=duration_ms,
            backup_path=backup_path,
            warnings=warnings,
            errors=errors,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _validate_source(self, source_path: str) -> Optional[str]:
        """Validate source path. Returns an error code or None."""
        if not os.path.exists(source_path):
            return SOURCE_NOT_FOUND
        if not os.path.isdir(source_path):
            return SOURCE_NOT_DIRECTORY
        return None

    def _validate_target_dir(self, target_dir: str) -> Optional[str]:
        """Validate target directory. Returns an error code or None."""
        if not os.path.exists(target_dir):
            return TARGET_DIR_NOT_FOUND
        if not os.path.isdir(target_dir):
            return TARGET_DIR_NOT_FOUND
        if not os.access(target_dir, os.W_OK):
            return TARGET_NOT_WRITABLE
        return None

    def _build_target_path(self, target_dir: str, source_path: str) -> str:
        """Build the target path: target_dir / basename(source_path)."""
        return os.path.join(target_dir, os.path.basename(os.path.normpath(source_path)))

    def _resolve_conflict_action(
        self,
        conflict: bool,
        overwrite: bool,
        rename_on_conflict: bool,
        backup_on_overwrite: bool,
    ) -> str:
        """Determine what action would be taken for a conflict (preview helper)."""
        if not conflict:
            return "copy"  # normal copy/move
        if overwrite:
            return "overwrite_with_backup" if backup_on_overwrite else "overwrite"
        if rename_on_conflict:
            return "rename"
        return "error"  # TARGET_ALREADY_EXISTS

    def _resolve_conflict(
        self,
        target_path: str,
        overwrite: bool,
        rename_on_conflict: bool,
        backup_on_overwrite: bool,
        warnings: List[str],
        errors: List[str],
    ) -> Optional[str]:
        """Resolve a naming conflict at *target_path*.

        Returns the resolved final path, or ``None`` if the conflict
        cannot be resolved (error).
        """
        if not os.path.exists(target_path):
            return target_path

        if overwrite:
            if backup_on_overwrite:
                try:
                    self._create_backup(target_path)
                except OSError as e:
                    errors.append(f"{BACKUP_FAILED}: {e}")
                    return None
            try:
                if os.path.isdir(target_path):
                    shutil.rmtree(target_path)
                else:
                    os.remove(target_path)
            except OSError as e:
                errors.append(f"{DELETE_FAILED}: {e}")
                return None
            return target_path

        if rename_on_conflict:
            return self._find_rename_target(target_path)

        errors.append(TARGET_ALREADY_EXISTS)
        return None

    def _find_rename_target(self, target_path: str) -> str:
        """Find an available name by appending _1, _2, etc."""
        base = target_path
        counter = 1
        while os.path.exists(base):
            stem = f"{target_path}_{counter}"
            base = stem
            counter += 1
        return base

    def _create_backup(self, target_path: str) -> str:
        """Create a timestamped backup of *target_path*.

        Backup is stored at ``<parent>/.backup/<name>_<timestamp>``.

        Returns the backup path.
        """
        parent = os.path.dirname(target_path)
        name = os.path.basename(target_path)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = os.path.join(parent, ".backup")
        backup_path = os.path.join(backup_dir, f"{name}_{timestamp}")

        os.makedirs(backup_dir, exist_ok=True)

        if os.path.isdir(target_path):
            shutil.copytree(target_path, backup_path)
        else:
            shutil.copy2(target_path, backup_path)

        return backup_path

    def _copy_directory(
        self, source: str, target: str
    ) -> Tuple[int, int, List[str]]:
        """Recursively copy a directory.

        Returns (file_count, byte_count, error_list).
        """
        errors: List[str] = []
        total_files = 0
        total_bytes = 0

        try:
            os.makedirs(target, exist_ok=True)
            for dirpath, dirnames, filenames in os.walk(source):
                rel_path = os.path.relpath(dirpath, source)
                dest_dir = os.path.join(target, rel_path) if rel_path != "." else target
                os.makedirs(dest_dir, exist_ok=True)

                for filename in filenames:
                    src_file = os.path.join(dirpath, filename)
                    dst_file = os.path.join(dest_dir, filename)
                    try:
                        shutil.copy2(src_file, dst_file)
                        total_files += 1
                        total_bytes += os.path.getsize(src_file)
                    except OSError as e:
                        errors.append(f"{COPY_FAILED}: {src_file} -> {e}")
        except OSError as e:
            errors.append(f"{COPY_FAILED}: {e}")

        return total_files, total_bytes, errors

    def _move_directory(
        self, source: str, target: str
    ) -> Tuple[int, int, List[str]]:
        """Move a directory, preferring os.rename.

        Falls back to copy-then-delete for cross-filesystem moves.

        Returns (file_count, byte_count, error_list).
        """
        errors: List[str] = []

        # Try fast rename first (same filesystem)
        try:
            os.rename(source, target)
            # Count files in moved directory
            count, byte_count = self._estimate_directory(target)
            return count, byte_count, errors
        except OSError:
            pass  # Cross-filesystem or other issue — fall through

        # Fallback: copy + delete
        count, byte_count, copy_errors = self._copy_directory(source, target)
        errors.extend(copy_errors)

        if not copy_errors:
            try:
                shutil.rmtree(source)
            except OSError as e:
                errors.append(f"{DELETE_FAILED}: {e}")
        else:
            # Partial copy — do not delete source
            errors.append(f"{MOVE_FAILED}: copy succeeded but source not deleted due to copy errors")

        return count, byte_count, errors

    def _estimate_directory(self, path: str) -> Tuple[int, int]:
        """Count files and total bytes in a directory tree.

        Returns (file_count, total_bytes).
        """
        total_files = 0
        total_bytes = 0
        try:
            for dirpath, dirnames, filenames in os.walk(path):
                for filename in filenames:
                    filepath = os.path.join(dirpath, filename)
                    try:
                        total_bytes += os.path.getsize(filepath)
                        total_files += 1
                    except OSError:
                        pass
        except OSError:
            pass
        return total_files, total_bytes

    # ------------------------------------------------------------------
    # Internal: result builders
    # ------------------------------------------------------------------

    def _error_result(
        self,
        request: InstallRequest,
        error_code: str,
        errors: List[str],
        start: float,
        target_path: str = "",
        warnings: Optional[List[str]] = None,
    ) -> InstallResult:
        """Build a failure InstallResult."""
        errors.append(error_code)
        duration_ms = int((time.monotonic() - start) * 1000)
        return InstallResult(
            success=False,
            partial=False,
            operation_type=request.mode,
            source_path=request.source_path,
            target_path=target_path,
            final_path="",
            files_copied=0,
            files_moved=0,
            files_skipped=0,
            bytes_processed=0,
            duration_ms=duration_ms,
            backup_path=None,
            warnings=warnings or [],
            errors=errors,
        )

    # ------------------------------------------------------------------
    # Backward-compatible API
    # ------------------------------------------------------------------

    def install(self, source_path: str, target_dir: str) -> bool:
        """Legacy: simple install (copy) with no conflict handling.

        Returns True on success.
        """
        request = InstallRequest(
            source_path=source_path,
            target_dir=target_dir,
            mode="copy",
            overwrite=True,
        )
        result = self.install_mod(request)
        return result.success

    def move(self, source_path: str, target_path: str) -> bool:
        """Legacy: simple move to a specific target path.

        Attempts ``os.rename`` directly, falls back to ``shutil.move``.

        Returns True on success.
        """
        try:
            target_dir = os.path.dirname(target_path)
            os.makedirs(target_dir, exist_ok=True)
            shutil.move(source_path, target_path)
            return True
        except OSError:
            return False
