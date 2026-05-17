"""StellarisCacheService — detect, preview, back up, and clean the Stellaris launcher cache."""

import os
import platform
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from translator_app.stellaris_cache.models import (
    CacheItem,
    CacheItemType,
    CacheOperationInput,
    CacheOperationResult,
    CleanMode,
)


# ---------------------------------------------------------------------------
# Well-known cache items (selective mode)
# ---------------------------------------------------------------------------
_KNOWN_CACHE_ITEMS: List[str] = [
    "mod_registry.json",
    "mod_registry.db",
    "launcher-cache",
    "dlc_load.json",
]


# ---------------------------------------------------------------------------
# Error / warning message constants
# ---------------------------------------------------------------------------
SUSPICIOUS_PATH_MSG = "Suspicious cache path: path does not contain 'Stellaris'"
CACHE_PATH_NOT_FOUND_MSG = "Cache path does not exist"
CACHE_NOT_READABLE_MSG = "Cache path is not readable"
CACHE_NOT_WRITABLE_MSG = "Cache path is not writable"
CACHE_DETECTION_FAILED_MSG = "Could not auto-detect Stellaris cache path"
CACHE_DELETE_FAILED_MSG = "Failed to delete cache item"
BACKUP_FAILED_MSG = "Failed to create backup"
PERMISSION_DENIED_MSG = "Permission denied for cache path"
CACHE_ALREADY_EMPTY_MSG = "Cache is already empty"
UNKNOWN_CACHE_STRUCTURE_MSG = "Cache directory contains unexpected items"


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class StellarisCacheService:
    """Service for detecting, previewing, backing up, and cleaning the Stellaris
    launcher cache."""

    # ------------------------------------------------------------------ #
    # Path detection
    # ------------------------------------------------------------------ #

    @staticmethod
    def detect_cache_path(
        settings_cache_path: Optional[str] = None,
        os_name: Optional[str] = None,
    ) -> Optional[str]:
        """Detect the Stellaris cache path.

        Resolution order:
        1. ``settings_cache_path`` if provided and non-empty.
        2. Auto-detect based on the current (or given) operating system.
        3. Return ``None`` if nothing worked.
        """
        # 1. Settings override
        if settings_cache_path:
            return settings_cache_path

        # 2. Auto-detect
        if os_name is None:
            os_name = platform.system()

        home = Path.home()

        if os_name == "Windows":
            # %USERPROFILE%/Documents/Paradox Interactive/Stellaris
            documents = home / "Documents"
            candidate = documents / "Paradox Interactive" / "Stellaris"
        elif os_name == "Darwin":
            # macOS: ~/Documents/Paradox Interactive/Stellaris
            candidate = home / "Documents" / "Paradox Interactive" / "Stellaris"
        elif os_name == "Linux":
            # ~/.local/share/Paradox Interactive/Stellaris
            candidate = home / ".local" / "share" / "Paradox Interactive" / "Stellaris"
        else:
            return None

        return str(candidate) if candidate.exists() else None

    # ------------------------------------------------------------------ #
    # Preview
    # ------------------------------------------------------------------ #

    def preview_cache_clean(self, input_data: CacheOperationInput) -> CacheOperationResult:
        """Preview what would be deleted — never touches the filesystem."""
        result = CacheOperationResult(cache_path=input_data.cache_path)

        path = Path(input_data.cache_path)

        # Safety check
        safety_warning = self._is_safe_cache_path(input_data.cache_path)
        if safety_warning:
            result.warnings.append(safety_warning)
            result.errors.append("SUSPICIOUS_PATH")
            return result

        # Existence & readability
        if not path.exists():
            result.warnings.append(CACHE_PATH_NOT_FOUND_MSG)
            result.errors.append("CACHE_PATH_NOT_FOUND")
            return result
        if not os.access(str(path), os.R_OK):
            result.warnings.append(CACHE_NOT_READABLE_MSG)
            result.errors.append("CACHE_NOT_READABLE")
            return result

        # Collect items
        if input_data.mode == CleanMode.SELECTIVE:
            items = self._collect_selective_items(str(path))
        else:
            items = self._collect_full_items(str(path))

        if not items:
            result.warnings.append(CACHE_ALREADY_EMPTY_MSG)

        result.items_to_delete = items
        result.success = True
        return result

    # ------------------------------------------------------------------ #
    # Clean
    # ------------------------------------------------------------------ #

    def clean_cache(self, input_data: CacheOperationInput) -> CacheOperationResult:
        """Execute a cache clean operation.

        Supports dry-run (preview only), optional backup, and both
        selective and full modes.
        """
        # Always start with a preview
        result = self.preview_cache_clean(input_data)
        if not result.success or result.errors:
            return result

        if input_data.dry_run:
            # dry_run: return preview, no actual deletion
            return result

        items_to_delete = result.items_to_delete
        backup_path: Optional[str] = None

        # Backup (before deletion)
        if input_data.backup and items_to_delete:
            try:
                backup_path = self._create_backup(input_data.cache_path, items_to_delete)
                result.backup_path = backup_path
            except (OSError, shutil.Error) as exc:
                result.errors.append(f"BACKUP_FAILED: {exc}")
                result.success = False
                return result

        # Delete
        deleted: List[CacheItem] = []
        skipped: List[CacheItem] = []

        for item in items_to_delete:
            p = Path(item.path)
            try:
                if item.type == CacheItemType.DIRECTORY and p.is_dir():
                    shutil.rmtree(str(p))
                    deleted.append(item)
                elif item.type == CacheItemType.FILE and p.is_file():
                    p.unlink()
                    deleted.append(item)
                else:
                    skipped.append(item)
            except (OSError, PermissionError) as exc:
                result.errors.append(f"{CACHE_DELETE_FAILED_MSG}: {item.path} — {exc}")
                skipped.append(item)

        result.deleted_items = deleted
        result.skipped_items = skipped

        if result.errors:
            result.warnings.append("PARTIAL_DELETE")

        # Warn about unknown structure in selective mode
        if input_data.mode == CleanMode.SELECTIVE:
            self._warn_unknown_structure(input_data.cache_path, result)

        result.success = True
        return result

    # ------------------------------------------------------------------ #
    # Collectors
    # ------------------------------------------------------------------ #

    @staticmethod
    def _collect_selective_items(cache_path: str) -> List[CacheItem]:
        """Collect only the well-known cache items that actually exist."""
        items: List[CacheItem] = []
        base = Path(cache_path)
        for name in _KNOWN_CACHE_ITEMS:
            p = base / name
            if p.exists():
                item_type = CacheItemType.DIRECTORY if p.is_dir() else CacheItemType.FILE
                size = _get_size(p)
                items.append(CacheItem(
                    path=str(p),
                    type=item_type,
                    size_bytes=size,
                    reason=f"known cache item: {name}",
                ))
        return items

    @staticmethod
    def _collect_full_items(cache_path: str) -> List[CacheItem]:
        """Collect every file/directory inside *cache_path* (non-recursive
        for top-level entries, recursive for size estimation of directories)."""
        items: List[CacheItem] = []
        base = Path(cache_path)
        if not base.is_dir():
            return items

        for entry in base.iterdir():
            item_type = CacheItemType.DIRECTORY if entry.is_dir() else CacheItemType.FILE
            size = _get_size(entry)
            items.append(CacheItem(
                path=str(entry),
                type=item_type,
                size_bytes=size,
                reason="full cache cleanup",
            ))
        return items

    # ------------------------------------------------------------------ #
    # Backup
    # ------------------------------------------------------------------ #

    @staticmethod
    def _create_backup(cache_path: str, items: List[CacheItem]) -> str:
        """Create a timestamped backup directory and copy *items* into it.

        Returns the backup directory path.
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        backup_dir = Path(f"{cache_path}_backup_{timestamp}")
        backup_dir.mkdir(parents=True, exist_ok=True)

        for item in items:
            src = Path(item.path)
            if not src.exists():
                continue
            # Preserve relative structure inside the backup
            if src.is_dir():
                dst = backup_dir / src.name
                shutil.copytree(str(src), str(dst))
            else:
                dst = backup_dir / src.name
                shutil.copy2(str(src), str(dst))

        return str(backup_dir)

    # ------------------------------------------------------------------ #
    # Safety
    # ------------------------------------------------------------------ #

    @staticmethod
    def _is_safe_cache_path(cache_path: str) -> Optional[str]:
        """Check that *cache_path* looks like a safe Stellaris cache path.

        Returns a warning string if the path is suspicious, or ``None``
        if it passes all checks.
        """
        if not cache_path or not cache_path.strip():
            return SUSPICIOUS_PATH_MSG

        resolved = os.path.realpath(cache_path)

        # Block root
        if resolved == "/":
            return SUSPICIOUS_PATH_MSG

        # Block home directory
        home = os.path.realpath(Path.home())
        if resolved == home:
            return SUSPICIOUS_PATH_MSG

        # Block Windows drive roots (e.g. C:\, D:\)
        if platform.system() == "Windows" or os.name == "nt":
            drive, tail = os.path.splitdrive(resolved)
            if drive and tail in (os.sep, ""):
                return SUSPICIOUS_PATH_MSG

        # Must contain "Stellaris" (case-insensitive)
        if "Stellaris" not in resolved and "stellaris" not in resolved:
            return SUSPICIOUS_PATH_MSG

        return None

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def _warn_unknown_structure(cache_path: str, result: CacheOperationResult) -> None:
        """If there are items in the cache dir not among known items, emit a warning."""
        base = Path(cache_path)
        if not base.is_dir():
            return
        known_set = {base / name for name in _KNOWN_CACHE_ITEMS}
        unknown = [str(e) for e in base.iterdir() if e not in known_set]
        if unknown:
            result.warnings.append(
                f"{UNKNOWN_CACHE_STRUCTURE_MSG}: {unknown}"
            )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_size(path: Path) -> int:
    """Return the total size in bytes of a file or directory."""
    if path.is_file():
        return path.stat().st_size
    if path.is_dir():
        total = 0
        for child in path.rglob("*"):
            if child.is_file():
                total += child.stat().st_size
        return total
    return 0
