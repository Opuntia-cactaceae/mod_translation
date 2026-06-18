"""Domain models for the Stellaris Cache Module (#14)."""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional


class CacheItemType(str, Enum):
    FILE = "file"
    DIRECTORY = "directory"


@dataclass
class CacheItem:
    """A single item (file or directory) to be deleted from the Stellaris cache."""
    path: str
    type: CacheItemType = CacheItemType.FILE
    size_bytes: int = 0
    reason: str = ""


class CleanMode(str, Enum):
    SELECTIVE = "selective"
    FULL = "full"


@dataclass
class CacheOperationInput:
    """Input parameters for a cache clean/preview operation."""
    cache_path: str
    mode: CleanMode = CleanMode.SELECTIVE
    backup: bool = False
    dry_run: bool = False


@dataclass
class CacheOperationResult:
    """Result of a cache clean/preview operation."""
    success: bool = False
    cache_path: str = ""
    items_to_delete: List[CacheItem] = field(default_factory=list)
    deleted_items: List[CacheItem] = field(default_factory=list)
    skipped_items: List[CacheItem] = field(default_factory=list)
    backup_path: Optional[str] = None
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
