"""Mod discovery service — finds Stellaris mods on the filesystem.

Supports multiple real-world mod folder structures (see Mod_Discovery_Module.md).
"""

import os
import re
from pathlib import Path
from typing import Dict, List, Optional

from translator_app.diagnostics.models import Diagnostic, DiagnosticLevel
from translator_app.mods.models import ModInfo, ModDiscoveryResult

# In-memory cache key: stores the last discover result
_last_discovery_result: Optional[ModDiscoveryResult] = None

# --- Diagnostic codes ---
MOD_DESCRIPTOR_NOT_FOUND = "MOD_DESCRIPTOR_NOT_FOUND"
MOD_NO_LOCALISATION = "MOD_NO_LOCALISATION"
MOD_INVALID_STRUCTURE = "MOD_INVALID_STRUCTURE"
MOD_PARSE_WARNING = "MOD_PARSE_WARNING"
MOD_PATH_NOT_FOUND = "MOD_PATH_NOT_FOUND"
MOD_DUPLICATE_SKIPPED = "MOD_DUPLICATE_SKIPPED"


class ModDiscoveryService:
    """Scans directories for Stellaris mods and extracts structured metadata.

    This service is read-only — it never writes to the filesystem.
    """

    LOCALISATION_GLOB_PATTERNS = ("*.yml", "*.yaml")
    DESCRIPTOR_FILENAME = "descriptor.mod"
    LOCALISATION_DIR_NAMES = ("localisation", "localization")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def discover_mods(self, paths: List[str]) -> ModDiscoveryResult:
        """Two-pass discovery: collect candidates, then resolve / deduplicate.

        Supports Scenarios A–F from the spec.
        """
        global _last_discovery_result
        result = ModDiscoveryResult()

        for search_path in paths:
            root = Path(search_path).resolve()
            if not root.is_dir():
                continue

            result.scanned_paths.append(str(root))

            # Phase 1: walk the tree and collect raw candidates
            # Key: resolved mod_root as string
            # Value: dict with candidate metadata
            candidates: Dict[str, dict] = {}

            for dirpath, dirnames, filenames in os.walk(str(root)):
                dir_path = Path(dirpath)

                has_loc_subdir = any(
                    d in dirnames for d in self.LOCALISATION_DIR_NAMES
                )

                # --- Check for descriptor files (.mod) in this directory ---
                # Use count(".") == 1 to filter out false positives like
                # "some_file.descriptor.mod" (valid mod files have exactly
                # one extension: descriptor.mod, my_mod.mod, etc.).
                mod_files = [
                    f for f in filenames
                    if f.endswith(".mod") and f.count(".") == 1
                ]

                if mod_files:
                    for mf in mod_files:
                        desc_path = dir_path / mf
                        desc_diags: List[Diagnostic] = []
                        desc_data = self._parse_descriptor_file(
                            desc_path, desc_diags
                        )

                        # Resolve mod root from path="..." directive
                        mod_root = self._resolve_mod_root(
                            desc_data.get("path", ""), dir_path, root
                        )
                        if mod_root is None:
                            mod_root = dir_path
                            if desc_data.get("path", "").strip():
                                desc_diags.append(
                                    Diagnostic(
                                        level=DiagnosticLevel.WARNING,
                                        message=(
                                            f"Mod path from descriptor "
                                            f"not found: "
                                            f"{desc_data['path']}"
                                        ),
                                        code=MOD_PATH_NOT_FOUND,
                                        file_path=str(desc_path),
                                    )
                                )

                        loc_files = self._find_localisation_files(mod_root)
                        source = self._detect_source(mod_root)
                        mod_root_key = str(mod_root.resolve())

                        if mod_root_key not in candidates:
                            candidates[mod_root_key] = {
                                "mod_root": mod_root,
                                "descriptor_path": str(desc_path),
                                "descriptor_data": desc_data,
                                "loc_files": loc_files,
                                "source": source,
                                "diagnostics": desc_diags,
                            }
                        else:
                            # Merge: prefer inner descriptor over outer .mod
                            existing = candidates[mod_root_key]
                            existing["descriptor_path"] = str(desc_path)
                            existing["descriptor_data"] = (
                                desc_data or existing["descriptor_data"]
                            )
                            existing["loc_files"] = sorted(
                                set(existing["loc_files"] + loc_files)
                            )
                            existing["diagnostics"].extend(desc_diags)

                # --- Localisation-only candidate (no .mod files) ---
                # Skip if the parent directory is already a descriptor-based
                # candidate — the parent's recursive localisation search
                # already covers nested localisation dirs.
                if has_loc_subdir and not mod_files:
                    parent_key = str(dir_path.parent.resolve())
                    parent_is_mod = (
                        parent_key in candidates
                        and candidates[parent_key].get("descriptor_path")
                    )
                    if not parent_is_mod:
                        loc_files = self._find_localisation_files(dir_path)
                        source = self._detect_source(dir_path)
                        mod_root_key = str(dir_path.resolve())

                        if mod_root_key not in candidates:
                            candidates[mod_root_key] = {
                                "mod_root": dir_path,
                                "descriptor_path": None,
                                "descriptor_data": {},
                                "loc_files": loc_files,
                                "source": source,
                                "diagnostics": [],
                            }
                        else:
                            existing = candidates[mod_root_key]
                            existing["loc_files"] = sorted(
                                set(existing["loc_files"] + loc_files)
                            )

            # Phase 2: build ModInfo from deduplicated candidates
            for cand in candidates.values():
                mod_info = self._build_mod_info(cand)
                result.mods.append(mod_info)

        _last_discovery_result = result
        return result

    @staticmethod
    def get_discovered_mods() -> ModDiscoveryResult:
        """Return the last discovery result from in-memory cache.

        Returns an empty :class:`ModDiscoveryResult` if no discovery
        has been performed yet.
        """
        global _last_discovery_result
        return (
            _last_discovery_result
            if _last_discovery_result is not None
            else ModDiscoveryResult()
        )

    # Keep backward-compatible aliases
    def discover(self, search_paths: List[str]) -> List[ModInfo]:
        return self.discover_mods(search_paths).mods

    def discover_all(self) -> List[ModInfo]:
        return []

    # ------------------------------------------------------------------
    # Internal: mod root resolution
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_mod_root(
        path_value: str, mod_file_dir: Path, root_path: Path
    ) -> Optional[Path]:
        """Resolve the mod folder path from a descriptor's ``path=`` directive.

        Supports:
        - absolute paths  (use as-is)
        - ``path="mod/my_mod"``  → try ``<root>/mod/my_mod``,
          ``<mod_file_dir>/mod/my_mod``, ``<root>/my_mod``
        - ``path="my_mod"``      → try ``<mod_file_dir>/my_mod``,
          ``<root>/my_mod``
        """
        pv = path_value.strip()
        if not pv:
            return None

        p = Path(pv)

        # Absolute path — use directly
        if p.is_absolute():
            return p if p.exists() else None

        candidates: List[Path] = []

        # Relative to the .mod file's directory
        candidates.append(mod_file_dir / pv)

        # Relative to the root search path
        candidates.append(root_path / pv)

        # If path starts with "mod/", also try without the "mod/" prefix
        if pv.startswith("mod/") or pv.startswith("mod\\"):
            stripped = pv[4:]  # Remove "mod/"
            candidates.append(mod_file_dir / stripped)
            candidates.append(root_path / stripped)
            try:
                candidates.append(root_path.parent / pv)
            except (ValueError, OSError):
                pass

        for candidate in candidates:
            resolved = candidate.resolve()
            if resolved.exists():
                return resolved

        return None

    # ------------------------------------------------------------------
    # Internal: build ModInfo from a candidate dict
    # ------------------------------------------------------------------

    def _build_mod_info(self, cand: dict) -> ModInfo:
        """Create a :class:`ModInfo` from a collected candidate dict.

        Handles diagnostics setup (MOD_NO_LOCALISATION,
        MOD_DESCRIPTOR_NOT_FOUND, MOD_INVALID_STRUCTURE).
        """
        diagnostics = list(cand.get("diagnostics", []))
        has_descriptor = cand["descriptor_path"] is not None
        has_localisation = bool(cand["loc_files"])
        mod_root = cand["mod_root"]

        if not has_localisation and not has_descriptor:
            is_valid = False
            diagnostics.append(
                Diagnostic(
                    level=DiagnosticLevel.ERROR,
                    message=(
                        "Mod folder has no descriptor and "
                        "no localisation files"
                    ),
                    code=MOD_INVALID_STRUCTURE,
                    file_path=str(mod_root),
                )
            )
        else:
            is_valid = True
            if has_descriptor and not has_localisation:
                diagnostics.append(
                    Diagnostic(
                        level=DiagnosticLevel.WARNING,
                        message="Descriptor found but no localisation files",
                        code=MOD_NO_LOCALISATION,
                        file_path=str(mod_root),
                    )
                )
            elif has_localisation and not has_descriptor:
                diagnostics.append(
                    Diagnostic(
                        level=DiagnosticLevel.WARNING,
                        message="Localisation files found but no descriptor",
                        code=MOD_DESCRIPTOR_NOT_FOUND,
                        file_path=str(mod_root),
                    )
                )

        desc_data = cand.get("descriptor_data", {})
        name = desc_data.get("name", "").strip() or mod_root.name

        return ModInfo(
            name=name,
            mod_id=mod_root.name,
            path=str(mod_root),
            descriptor_path=cand.get("descriptor_path"),
            is_valid=is_valid,
            source=cand.get("source", "local"),
            version=desc_data.get("version", ""),
            supported_version=desc_data.get("supported_version", ""),
            tags=self._parse_tags(desc_data.get("tags", "")),
            localisation_paths=cand.get("loc_files", []),
            diagnostics=diagnostics,
        )

    # ------------------------------------------------------------------
    # Internal: descriptor parsing
    # ------------------------------------------------------------------

    def _parse_descriptor_file(
        self, file_path: Path, diagnostics: List[Diagnostic]
    ) -> Dict[str, str]:
        """Read and parse a ``.mod`` descriptor file.

        Uses simple regex — no full parser.  Adds diagnostics on parse
        warnings.
        """
        try:
            content = file_path.read_text(encoding="utf-8-sig")
        except Exception as exc:
            diagnostics.append(
                Diagnostic(
                    level=DiagnosticLevel.WARNING,
                    message=f"Could not read descriptor file: {exc}",
                    code=MOD_PARSE_WARNING,
                    file_path=str(file_path),
                )
            )
            return {}

        return self._parse_descriptor_content(content, file_path, diagnostics)

    def _parse_descriptor_content(
        self,
        content: str,
        source_path: Optional[Path] = None,
        diagnostics: Optional[List[Diagnostic]] = None,
    ) -> Dict[str, str]:
        """Parse descriptor string content into key-value pairs."""
        if diagnostics is None:
            diagnostics = []

        result: Dict[str, str] = {}

        # Match name="..." or name = "..." (simple quoted values)
        for key in ("name", "version", "supported_version"):
            pattern = re.compile(
                rf'(?<!\w){re.escape(key)}\s*=\s*"([^"]*)"', re.IGNORECASE
            )
            match = pattern.search(content)
            if match:
                result[key] = match.group(1)

        # Match path="..."
        path_match = re.search(
            r'(?<!\w)path\s*=\s*"([^"]*)"', content, re.IGNORECASE
        )
        if path_match:
            result["path"] = path_match.group(1)

        # Match tags = { ... } block
        tags_match = re.search(
            r"tags\s*=\s*\{(.*?)\}", content, re.IGNORECASE | re.DOTALL
        )
        if tags_match:
            result["tags"] = tags_match.group(1).strip()

        return result

    @staticmethod
    def _parse_tags(tags_str: str) -> List[str]:
        """Extract individual tag strings from a ``tags = { ... }`` body."""
        if not tags_str or not tags_str.strip():
            return []
        # Tags can be quoted ("tag") or bare words inside the braces
        tags = re.findall(r'"([^"]*)"', tags_str)
        if not tags:
            # Fallback: split by whitespace
            tags = tags_str.split()
        return tags

    # ------------------------------------------------------------------
    # Internal: localisation
    # ------------------------------------------------------------------

    def _find_localisation_files(self, mod_root: Path) -> List[str]:
        """Return absolute paths of all ``.yml`` / ``.yaml`` files under
        any ``localisation/`` or ``localization/`` directory inside
        *mod_root*, searching recursively.

        Handles nested structures like:
          mod/localisation/english/file.yml
          mod/localisation/file.yml
        """
        if not mod_root.is_dir():
            return []

        files: List[str] = []
        for loc_dir_name in self.LOCALISATION_DIR_NAMES:
            for loc_dir in mod_root.rglob(loc_dir_name):
                if loc_dir.is_dir():
                    for pattern in self.LOCALISATION_GLOB_PATTERNS:
                        for f in sorted(loc_dir.rglob(pattern)):
                            if f.is_file():
                                files.append(str(f.resolve()))

        return sorted(set(files))

    # ------------------------------------------------------------------
    # Internal: source detection
    # ------------------------------------------------------------------

    @staticmethod
    def _detect_source(mod_path: Path) -> str:
        """Determine whether the mod lives in a local or workshop path.

        Detects workshop by:
        - ``workshop`` as a path component
        - ``281990`` anywhere in path (Steam app ID)
        - numeric folder name (workshop-style ID, 5+ digits)
        """
        # Check "workshop" as a whole path component to avoid false
        # positives from folder names like "not_workshop".
        parts_lower = [p.lower() for p in mod_path.parts]
        if "workshop" in parts_lower:
            return "workshop"
        # 281990 is the Stellaris Steam app ID — keep as substring
        # check since it may appear in combined folder names.
        if "281990" in str(mod_path):
            return "workshop"
        if mod_path.name.isdigit() and len(mod_path.name) >= 5:
            return "workshop"
        return "local"

    # ------------------------------------------------------------------
    # Internal: helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _list_files(path: Path) -> List[str]:
        """List regular-file names inside *path* (non-recursive)."""
        if not path.is_dir():
            return []
        try:
            return [e.name for e in path.iterdir() if e.is_file()]
        except PermissionError:
            return []
