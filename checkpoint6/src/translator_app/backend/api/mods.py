"""Mod discovery API endpoints."""

import os
import re
from pathlib import Path

from fastapi import APIRouter, Depends

from translator_app.backend.deps import Services, get_services
from translator_app.backend.schemas.mods import (
    DiagnosticSchema,
    ModDiscoveryRequest,
    ModDiscoveryResponse,
    ModInfoSchema,
)

router = APIRouter(tags=["mods-discovery"])


def _diagnostic_to_schema(d) -> DiagnosticSchema:
    return DiagnosticSchema(
        level=d.level.value if hasattr(d.level, "value") else str(d.level),
        code=d.code,
        message=d.message,
        file_path=d.file_path,
        details=d.details,
    )


def _read_descriptor_path_value(descriptor_path: str) -> str | None:
    """Read a descriptor.mod file and return the ``path=`` value, or ``None``."""
    try:
        content = Path(descriptor_path).read_text(encoding="utf-8-sig")
        match = re.search(r'(?<!\w)path\s*=\s*"([^"]*)"', content, re.IGNORECASE)
        if match:
            return match.group(1)
    except Exception:
        pass
    return None


def _check_installed(mod, target_dir: str | None) -> tuple[bool, str | None, str, bool, bool]:
    """Check if a mod is already installed in *target_dir*.

    Priority order:
      1. If *mod* has a descriptor, parse its ``path=`` directive and
         use that folder as the source of truth.
      2. Otherwise fall back to ``basename(mod.path)``.

    A mod is considered *installed* whenever its folder (at the descriptor
    path OR the basename) exists inside *target_dir*.  When the descriptor
    path differs from the basename and both exist, ``install_conflict``
    is set to ``True``.

    If the resolved source path and installed path point to the same
    directory the mod is flagged as *self-installed* — no copy/reinstall
    is possible and there is no real conflict.

    Returns (installed, installed_path, install_action, install_conflict, is_self_installed).
    """
    if not target_dir or not mod.path:
        return False, None, "install", False, False

    target = Path(target_dir)
    mod_path = Path(mod.path)

    descriptor_path_value = None
    if mod.descriptor_path:
        descriptor_path_value = _read_descriptor_path_value(mod.descriptor_path)

    if descriptor_path_value:
        # ---- Descriptor path as primary location ----
        desc_folder = target / descriptor_path_value
        desc_resolved = desc_folder.resolve() if desc_folder.exists() else desc_folder
        desc_exists = desc_resolved.exists()

        # Basename fallback location
        basename_folder = target / mod_path.name
        basename_exists = basename_folder.exists()

        if desc_exists:
            # Installed at descriptor path
            action = "reinstall"
            conflict = basename_exists and str(basename_folder.resolve()) != str(desc_resolved.resolve())
            installed_path = str(desc_resolved)
        elif basename_exists:
            # Installed at basename path (descriptor path differs)
            conflict = True  # Descriptor points elsewhere
            installed_path = str(basename_folder.resolve())
            action = "reinstall"
        else:
            # Neither path in target exists — fall through to .mod file check below
            installed_path = None
            action = "install"
            conflict = False

        if installed_path:
            is_self = _paths_are_same(mod.path, installed_path)
            if is_self:
                return True, installed_path, action, False, True
            return True, installed_path, action, conflict, False

    # ---- No descriptor — fallback to basename ----
    expected_path = target / mod_path.name
    if expected_path.exists():
        installed_path = str(expected_path.resolve()) if expected_path.exists() else str(expected_path)
        is_self = _paths_are_same(mod.path, installed_path)
        if is_self:
            return True, installed_path, "reinstall", False, True
        return True, installed_path, "reinstall", False, False

    # ---- Also check if a .mod descriptor file exists in target_dir ----
    descriptor_candidates = [
        target / f"{mod.name}.mod",
        target / f"{mod_path.stem}.mod",
        target / f"{mod_path.name}.mod",
    ]
    for desc in descriptor_candidates:
        if desc.exists():
            installed_path = str(desc)
            is_self = _paths_are_same(mod.path, installed_path)
            if is_self:
                return True, installed_path, "reinstall", False, True
            return True, str(desc), "reinstall", False, False

    return False, None, "install", False, False


def _paths_are_same(path_a: str, path_b: str) -> bool:
    """Return ``True`` if both paths resolve to the same filesystem location."""
    try:
        resolved_a = Path(path_a).resolve()
        resolved_b = Path(path_b).resolve()
        return str(resolved_a) == str(resolved_b)
    except OSError:
        return False


def _enrich_with_installed(mod, svcs: Services) -> dict:
    """Add installed-status fields to a ModInfoSchema dict.

    Returns a dict of extra fields to merge into the schema.
    """
    settings = svcs.settings.load()
    target_dir = None
    if settings.paths and settings.paths.stellaris_mods_dir:
        target_dir = settings.paths.stellaris_mods_dir

    installed, installed_path, install_action, conflict, self_installed = _check_installed(mod, target_dir)
    return {
        "installed": installed,
        "installed_path": installed_path,
        "install_action": install_action,
        "install_conflict": conflict,
        "is_self_installed": self_installed,
    }


def _mod_info_to_schema(mod, svcs: Services | None = None) -> ModInfoSchema:
    extra = {}
    if svcs is not None:
        extra = _enrich_with_installed(mod, svcs)
    return ModInfoSchema(
        name=mod.name,
        mod_id=mod.mod_id,
        path=mod.path,
        game_id=mod.game_id,
        version=mod.version,
        supported_version=mod.supported_version,
        tags=mod.tags,
        descriptor_path=mod.descriptor_path,
        is_valid=mod.is_valid,
        source=mod.source,
        localisation_paths=mod.localisation_paths,
        diagnostics=[_diagnostic_to_schema(d) for d in mod.diagnostics],
        **extra,
    )


@router.get(
    "/api/mods/discovered",
    response_model=ModDiscoveryResponse,
    summary="Return previously discovered mods (in-memory cache)",
)
def get_discovered_mods(
    svcs: Services = Depends(get_services),
):
    """Return the last discovery result from in-memory cache.

    Call ``POST /api/mods/discover`` first to discover mods;
    this endpoint returns whatever was found in the most recent
    discovery run.
    """
    result = svcs.mod_discovery.get_discovered_mods()

    return ModDiscoveryResponse(
        mods=[_mod_info_to_schema(m, svcs) for m in result.mods],
        scanned_paths=result.scanned_paths,
        diagnostics=[_diagnostic_to_schema(d) for d in result.diagnostics],
    )


@router.post(
    "/api/mods/discover",
    response_model=ModDiscoveryResponse,
    summary="Discover Stellaris mods in given paths",
)
def discover_mods(
    body: ModDiscoveryRequest,
    svcs: Services = Depends(get_services),
):
    """Scan the given directory paths for Stellaris mod folders.

    Returns a list of discovered mods with metadata and diagnostics.
    """
    result = svcs.mod_discovery.discover_mods(body.paths)

    return ModDiscoveryResponse(
        mods=[_mod_info_to_schema(m, svcs) for m in result.mods],
        scanned_paths=result.scanned_paths,
        diagnostics=[_diagnostic_to_schema(d) for d in result.diagnostics],
    )
