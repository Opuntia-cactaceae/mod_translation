"""Import / Export Module (#28) — domain models.

Spec: #28 Import / Export Module
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Merge strategies
# ---------------------------------------------------------------------------


class MergeStrategy(str, Enum):
    SKIP_EXISTING = "skip_existing"
    OVERWRITE_EXISTING = "overwrite_existing"
    KEEP_NEWER = "keep_newer"
    MERGE = "merge"


# ---------------------------------------------------------------------------
# Error / Warning codes (spec #28)
# ---------------------------------------------------------------------------

EXPORT_FAILED = "EXPORT_FAILED"
IMPORT_FAILED = "IMPORT_FAILED"
ARCHIVE_NOT_FOUND = "ARCHIVE_NOT_FOUND"
INVALID_ARCHIVE = "INVALID_ARCHIVE"
INVALID_MANIFEST = "INVALID_MANIFEST"
UNSUPPORTED_VERSION = "UNSUPPORTED_VERSION"
CORRUPTED_DATA = "CORRUPTED_DATA"

PARTIAL_IMPORT = "PARTIAL_IMPORT"
SKIPPED_EXISTING = "SKIPPED_EXISTING"
VERSION_MISMATCH = "VERSION_MISMATCH"
UNSUPPORTED_FIELDS = "UNSUPPORTED_FIELDS"
API_KEYS_IGNORED = "API_KEYS_IGNORED"

SUPPORTED_MANIFEST_VERSIONS = frozenset({"1.0"})


# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------


@dataclass
class ImportExportDiagnostic:
    """Diagnostic message for an import/export operation."""
    level: str = "info"  # "info" | "warning" | "error"
    code: str = ""
    message: str = ""
    details: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# ExportRequest
# ---------------------------------------------------------------------------


@dataclass
class ExportRequest:
    """Request parameters for an export operation."""
    include_config_presets: bool = False
    include_prompt_presets: bool = True
    include_cache: bool = False
    include_jobs: bool = False
    include_settings: bool = False
    output_path: Optional[str] = None


# ---------------------------------------------------------------------------
# ImportRequest
# ---------------------------------------------------------------------------


@dataclass
class ImportRequest:
    """Request parameters for an import operation."""
    archive_path: str = ""
    merge_strategy: MergeStrategy = MergeStrategy.OVERWRITE_EXISTING


# ---------------------------------------------------------------------------
# ExportManifest
# ---------------------------------------------------------------------------


@dataclass
class ExportManifest:
    """Manifest describing the contents of an export archive."""
    version: str = "1.0"
    exported_at: str = ""
    app_version: str = "0.1.0"
    contents: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# ImportExportResult
# ---------------------------------------------------------------------------


@dataclass
class ImportExportResult:
    """Result of an import or export operation."""
    success: bool = True
    items_processed: int = 0
    items_skipped: int = 0
    warnings: List[ImportExportDiagnostic] = field(default_factory=list)
    errors: List[ImportExportDiagnostic] = field(default_factory=list)
