"""Mod discovery Pydantic schemas for the backend API."""

from pydantic import BaseModel
from typing import Any, Dict, List, Optional


class DiagnosticSchema(BaseModel):
    """A single diagnostic entry from a mod scan."""
    level: str = "info"
    code: str = ""
    message: str = ""
    file_path: Optional[str] = None
    details: Optional[str] = None


class ModInfoSchema(BaseModel):
    """Serialised view of a discovered mod."""
    name: str = ""
    mod_id: str = ""
    path: str = ""
    game_id: str = "stellaris"
    version: str = ""
    supported_version: str = ""
    tags: List[str] = []
    descriptor_path: Optional[str] = None
    is_valid: bool = True
    source: str = "local"
    localisation_paths: List[str] = []
    diagnostics: List[DiagnosticSchema] = []
    # Installed status (enriched after discovery)
    installed: bool = False
    installed_path: Optional[str] = None
    install_action: str = "install"
    install_conflict: bool = False
    is_self_installed: bool = False


class ModDiscoveryRequest(BaseModel):
    """Request body for POST /api/mods/discover."""
    paths: List[str] = []


class ModDiscoveryResponse(BaseModel):
    """Response for POST /api/mods/discover."""
    mods: List[ModInfoSchema] = []
    scanned_paths: List[str] = []
    diagnostics: List[DiagnosticSchema] = []
