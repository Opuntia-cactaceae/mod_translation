from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

from translator_app.diagnostics.models import Diagnostic


@dataclass
class ModInfo:
    """Represents a discovered mod on the filesystem."""

    # --- Core identity ---
    name: str
    mod_id: str = ""
    path: str = ""
    game_id: str = "stellaris"

    # --- Existing fields (kept for backward compatibility) ---
    version: str = ""
    supported_version: str = ""
    tags: list = field(default_factory=list)
    picture: str = ""
    remote_file_id: str = ""
    is_installed: bool = False
    discovered_at: Optional[datetime] = None

    # --- New fields for discovery ---
    descriptor_path: Optional[str] = None
    is_valid: bool = True
    source: str = "local"
    localisation_paths: List[str] = field(default_factory=list)
    diagnostics: List[Diagnostic] = field(default_factory=list)


@dataclass
class ModDiscoveryResult:
    """Result of a mod discovery scan."""
    mods: List[ModInfo] = field(default_factory=list)
    scanned_paths: List[str] = field(default_factory=list)
    diagnostics: List[Diagnostic] = field(default_factory=list)
