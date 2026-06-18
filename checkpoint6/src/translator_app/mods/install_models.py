"""Data models for the Mod Install / Move Module (#12)."""

from __future__ import annotations

import dataclasses
import time
from typing import List, Optional


@dataclasses.dataclass
class InstallRequest:
    """Request to install or move a mod."""

    source_path: str
    target_dir: str
    mode: str = "copy"  # "copy" | "move"
    overwrite: bool = False
    backup_on_overwrite: bool = True
    rename_on_conflict: bool = False
    dry_run: bool = False


@dataclasses.dataclass
class InstallResult:
    """Result of a mod install/move operation."""

    success: bool
    partial: bool = False
    operation_type: str = ""
    source_path: str = ""
    target_path: str = ""
    final_path: str = ""
    files_copied: int = 0
    files_moved: int = 0
    files_skipped: int = 0
    bytes_processed: int = 0
    duration_ms: int = 0
    backup_path: Optional[str] = None
    warnings: List[str] = dataclasses.field(default_factory=list)
    errors: List[str] = dataclasses.field(default_factory=list)

    @property
    def elapsed_ms(self) -> int:
        """Return duration_ms; convenience alias."""
        return self.duration_ms


@dataclasses.dataclass
class InstallPreview:
    """Preview of an install/move operation (dry-run)."""

    operation: str = ""
    target_path: str = ""
    conflict: bool = False
    action: str = ""  # "copy" | "move" | "overwrite" | "overwrite_with_backup" | "rename" | "skip" | "error"
    estimated_files: int = 0
    estimated_bytes: int = 0
    warnings: List[str] = dataclasses.field(default_factory=list)
    errors: List[str] = dataclasses.field(default_factory=list)
