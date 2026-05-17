"""Data models for the Descriptor Module (spec #13)."""

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from translator_app.diagnostics.models import Diagnostic

# ---------------------------------------------------------------------------
# Diagnostic codes
# ---------------------------------------------------------------------------

# Errors
DESCRIPTOR_NOT_FOUND = "DESCRIPTOR_NOT_FOUND"
DESCRIPTOR_READ_FAILED = "DESCRIPTOR_READ_FAILED"
DESCRIPTOR_PARSE_ERROR = "DESCRIPTOR_PARSE_ERROR"
DESCRIPTOR_WRITE_FAILED = "DESCRIPTOR_WRITE_FAILED"
MOD_PATH_NOT_FOUND = "MOD_PATH_NOT_FOUND"
INVALID_DESCRIPTOR_FORMAT = "INVALID_DESCRIPTOR_FORMAT"

# Warnings
PATH_MISMATCH = "PATH_MISMATCH"
MISSING_SUPPORTED_VERSION = "MISSING_SUPPORTED_VERSION"
UNKNOWN_FIELDS_PRESERVED = "UNKNOWN_FIELDS_PRESERVED"
MULTIPLE_TAG_BLOCKS = "MULTIPLE_TAG_BLOCKS"


# ---------------------------------------------------------------------------
# Domain models
# ---------------------------------------------------------------------------


@dataclass
class Descriptor:
    """Represents a parsed Stellaris descriptor (.mod) file."""

    name: str = ""
    path: str = ""
    supported_version: str = ""
    tags: List[str] = field(default_factory=list)
    picture: str = ""
    remote_file_id: str = ""
    raw_fields: Dict[str, str] = field(default_factory=dict)
    source_path: Optional[str] = None
    diagnostics: List[Diagnostic] = field(default_factory=list)


@dataclass
class DescriptorResult:
    """Result of a descriptor create / update operation."""

    descriptor_path: str = ""
    descriptor_text: str = ""
    created: bool = False
    updated: bool = False
    backup_path: Optional[str] = None
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
