"""Draft job selection service with persistence, grouping, and diagnostics.

Holds the "draft" collection of files the user has selected for a
translation job, along with per-file metadata (mod context).

Design decisions
----------------
*State is persisted to ``app_data/draft_job_selection.json``.*  A backend
restart preserves the draft across restarts.  Every mutation writes through
to disk immediately.

*All file paths are canonicalised* (symlinks resolved, absolute) so
that the same file always produces the same identity key regardless of
how its path was expressed by the frontend.  Relative paths are
preserved as-is.

*Grouping is computed on read (``get_full_state`` / ``compute_grouped``).*
The flat file list is the source of truth; the grouped tree is a derived
view computed from metadata saved alongside each file path.

*Mod-resolution delegates to ``ModDiscoveryService``.*  The service accepts
an optional ``mod_discovery`` dependency; if none is provided, it falls
back to the static ``get_discovered_mods()`` cache.
"""

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from translator_app.backend.path_utils import canonicalize_path
from translator_app.storage.paths import get_data_dir

logger = logging.getLogger(__name__)


class DraftJobSelectionService:
    """Backend-driven draft job selection state.

    Usage
    -----
        svc = DraftJobSelectionService()
        svc.add_files(["/path/to/file.yml"], metadata={"mod_id": "my-mod"})
        state = svc.get_full_state()
        # state["grouped"] is a pre-computed hierarchical tree
        # state["diagnostics"] contains warnings (missing files, etc.)
    """

    # ------------------------------------------------------------------
    #  Lifecycle
    # ------------------------------------------------------------------

    def __init__(
        self,
        mod_discovery: Any = None,
        file_service: Any = None,
    ) -> None:
        self._files: List[str] = []
        self._metadata: Dict[str, Dict[str, Any]] = {}
        self._updated_at: Optional[datetime] = None
        # Optional dependencies
        self._mod_discovery = mod_discovery
        self._file_service = file_service
        # Load persisted state from disk
        self._load_from_disk()

    # ------------------------------------------------------------------
    #  Persistence
    # ------------------------------------------------------------------

    @staticmethod
    def _persist_path() -> Path:
        return Path(get_data_dir()) / "draft_job_selection.json"

    def _save_to_disk(self) -> None:
        data = {
            "files": self._files,
            "file_metadata": self._metadata,
            "updated_at": self._updated_at.isoformat() if self._updated_at else None,
        }
        path = self._persist_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except OSError:
            logger.exception("Failed to save draft selection to %s", path)

    def _load_from_disk(self) -> None:
        path = self._persist_path()
        if not path.exists():
            self._files = []
            self._metadata = {}
            self._updated_at = None
            return
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self._files = data.get("files", [])
            self._metadata = data.get("file_metadata", {})
            ts = data.get("updated_at")
            self._updated_at = datetime.fromisoformat(ts) if ts else None
        except (json.JSONDecodeError, OSError, ValueError):
            logger.warning(
                "Failed to load draft selection from %s, starting fresh", path
            )
            self._files = []
            self._metadata = {}
            self._updated_at = None

    def _mark_updated(self) -> None:
        self._updated_at = datetime.now(timezone.utc)
        self._save_to_disk()

    # ------------------------------------------------------------------
    #  Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _canonicalise(path: str) -> str:
        """Return the canonical form of *path* for identity-key use."""
        return canonicalize_path(path) if os.path.isabs(path) else path

    @staticmethod
    def _canonicalise_all(paths: List[str]) -> List[str]:
        """Return a deduplicated, canonicalised list of paths."""
        seen: set[str] = set()
        result: List[str] = []
        for p in paths:
            cp = DraftJobSelectionService._canonicalise(p)
            if cp not in seen:
                seen.add(cp)
                result.append(cp)
        return result

    def _normalise_key(self, path: str) -> str:
        """Existing metadata key comparator-safe."""
        return self._canonicalise(path)

    # ------------------------------------------------------------------
    #  Properties
    # ------------------------------------------------------------------

    @property
    def files(self) -> List[str]:
        """Return the current list of draft file paths."""
        return list(self._files)

    @property
    def file_metadata(self) -> Dict[str, Dict[str, Any]]:
        """Return per-file metadata dict."""
        return dict(self._metadata)

    @property
    def count(self) -> int:
        """Number of files in the draft."""
        return len(self._files)

    @property
    def updated_at(self) -> Optional[datetime]:
        """Timestamp of the last mutation."""
        return self._updated_at

    # ------------------------------------------------------------------
    #  State access
    # ------------------------------------------------------------------

    def get_state(self) -> Dict[str, Any]:
        """Return the full draft state as a serialisable dict."""
        return {
            "files": self.files,
            "file_metadata": self.file_metadata,
            "count": self.count,
        }

    def get_full_state(self) -> Dict[str, Any]:
        """Return the full draft state including grouped view and diagnostics."""
        return {
            "files": self.files,
            "file_metadata": self.file_metadata,
            "grouped": self.compute_grouped(),
            "diagnostics": self._collect_diagnostics(),
            "count": self.count,
            "updated_at": self._updated_at.isoformat() if self._updated_at else None,
        }

    # ------------------------------------------------------------------
    #  Mutations
    # ------------------------------------------------------------------

    def add_files(
        self,
        file_paths: List[str],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> "DraftJobSelectionService":
        """Add files to the draft.  Deduplicates by canonical path.

        If *metadata* is provided, it is associated with every file
        added in this call (useful for bulk-add from a single mod).
        """
        existing_canonical = {self._canonicalise(f) for f in self._files}
        for p in file_paths:
            cp = self._canonicalise(p)
            if cp not in existing_canonical:
                existing_canonical.add(cp)
                self._files.append(cp)

            # Store / merge metadata for this file
            if metadata:
                existing = self._metadata.get(cp, {})
                merged = {**existing, **metadata}
                self._metadata[cp] = merged

        self._mark_updated()
        return self

    def remove_files(self, file_paths: List[str]) -> "DraftJobSelectionService":
        """Remove files from the draft.  Canonical comparison."""
        remove_canonical = {self._canonicalise(p) for p in file_paths}
        self._files = [f for f in self._files if f not in remove_canonical]
        # Also clean up metadata for removed files
        for cp in remove_canonical:
            self._metadata.pop(cp, None)
        self._mark_updated()
        return self

    def set_files(
        self,
        files: List[str],
        file_metadata: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> "DraftJobSelectionService":
        """Replace the entire draft file list and metadata atomically."""
        self._files = self._canonicalise_all(files)
        if file_metadata is not None:
            # Re-key metadata to canonical paths
            rekeyed: Dict[str, Dict[str, Any]] = {}
            for orig_key, meta in file_metadata.items():
                ck = self._canonicalise(orig_key)
                if ck not in rekeyed:
                    rekeyed[ck] = dict(meta)
            self._metadata = rekeyed
        else:
            # Preserve metadata for files that still exist
            canonical_set = set(self._files)
            self._metadata = {
                k: v for k, v in self._metadata.items() if k in canonical_set
            }
        self._mark_updated()
        return self

    def clear(self) -> "DraftJobSelectionService":
        """Remove all files and metadata."""
        self._files.clear()
        self._metadata.clear()
        self._mark_updated()
        return self

    def get_file_metadata_for_path(self, path: str) -> Optional[Dict[str, Any]]:
        """Return metadata for a specific file path (canonical lookup)."""
        cp = self._canonicalise(path)
        return self._metadata.get(cp)

    # ------------------------------------------------------------------
    #  Raw textarea replacement
    # ------------------------------------------------------------------

    def add_files_from_raw_text(
        self,
        paths_text: str,
        source: str = "raw",
    ) -> "DraftJobSelectionService":
        """Replace draft from raw textarea content.

        Parses multi-line text, trims whitespace, skips empty lines,
        deduplicates, and sets ``source`` metadata on every file.
        """
        raw_paths = [p.strip() for p in paths_text.split("\n") if p.strip()]
        # Use set_files to replace everything, but preserve metadata for
        # paths that survive (we do a full replace with source info)
        file_meta: Dict[str, Dict[str, Any]] = {}
        for p in raw_paths:
            cp = self._canonicalise(p)
            # Preserve any existing metadata, overlay source
            existing = self._metadata.get(cp, {})
            merged = {**existing, "source": source}
            file_meta[p] = merged

        self.set_files(raw_paths, file_metadata=file_meta)
        return self

    # ------------------------------------------------------------------
    #  Mod-based addition
    # ------------------------------------------------------------------

    def add_files_from_mods(
        self,
        mod_ids: Optional[List[str]] = None,
        mod_paths: Optional[List[str]] = None,
        handler: str = "stellaris_localisation",
        language: str = "english",
    ) -> tuple[List[str], List[Dict[str, Any]]]:
        """Resolve mod IDs or mod paths to localisation file paths and add them to draft.

        *mod_paths* take priority over *mod_ids*. When *mod_paths* are provided,
        mods are looked up by their filesystem path, which avoids aliasing
        when two mods share the same ``mod_id`` but live at different paths.

        When *mod_paths* is empty/None and *mod_ids* is provided, falls back
        to the legacy mod_id-based lookup.

        Returns ``(added_paths, diagnostics)``.
        """
        diagnostics: List[Dict[str, Any]] = []
        all_paths: List[str] = []

        mod_ids = mod_ids or []
        mod_paths = mod_paths or []

        # Use mod_paths by preference (avoids mod_id aliasing)
        use_paths = bool(mod_paths)
        if not use_paths and not mod_ids:
            return all_paths, diagnostics

        # Access discovered mods
        mod_list: List = []
        if self._mod_discovery is not None:
            result = self._mod_discovery.get_discovered_mods()
            mod_list = result.mods if result else []
        else:
            # Fall back to static cache
            from translator_app.mods.discovery import ModDiscoveryService
            result = ModDiscoveryService.get_discovered_mods()
            mod_list = result.mods if result else []

        if use_paths:
            # Build lookup: normalised absolute path -> ModInfo
            mods_by_path: Dict[str, Any] = {}
            for m in mod_list:
                mp = getattr(m, "path", None) or ""
                if mp:
                    mods_by_path[mp] = m

            for mod_path in mod_paths:
                mod = mods_by_path.get(mod_path)
                if not mod:
                    diagnostics.append({
                        "level": "warning",
                        "code": "MOD_NOT_FOUND",
                        "message": f"Mod not found by path in discovered mods: {mod_path}",
                    })
                    continue

                self._add_mod_localisation_files(
                    mod, mod_path, all_paths, diagnostics,
                    handler=handler, language=language,
                )
        else:
            # Legacy: build lookup by mod_id
            mods_by_id: Dict[str, Any] = {}
            for m in mod_list:
                mid = getattr(m, "mod_id", None) or getattr(m, "mod_id_from_descriptor", "")
                if mid:
                    mods_by_id[mid] = m

            for mod_id in mod_ids:
                mod = mods_by_id.get(mod_id)
                if not mod:
                    diagnostics.append({
                        "level": "warning",
                        "code": "MOD_NOT_FOUND",
                        "message": f"Mod not found in discovered mods: {mod_id}",
                    })
                    continue

                self._add_mod_localisation_files(
                    mod, mod_id, all_paths, diagnostics,
                    handler=handler, language=language,
                )

        # Dedup and append to files list
        existing_canonical = {self._canonicalise(f) for f in self._files}
        for p in all_paths:
            if p not in existing_canonical:
                existing_canonical.add(p)
                self._files.append(p)

        if all_paths:
            self._mark_updated()

        return all_paths, diagnostics

    def _add_mod_localisation_files(
        self,
        mod: Any,
        mod_identity: str,
        all_paths: List[str],
        diagnostics: List[Dict[str, Any]],
        handler: str,
        language: str,
    ) -> None:
        """Extract localisation paths from a mod and append to *all_paths*.

        Shared helper used by both mod_id and mod_path lookups so the
        localisation filtering / metadata logic lives in one place.
        """
        localisation_paths: List[str] = getattr(mod, "localisation_paths", []) or []

        # Filter by language if the path contains it
        if language:
            lang_filtered = [
                p for p in localisation_paths
                if f"/{language}/" in p.replace("\\", "/")
            ]
            if not lang_filtered:
                lang_filtered = list(localisation_paths)
            localisation_paths = lang_filtered

        mod_name = getattr(mod, "name", None) or mod_identity
        game_id = getattr(mod, "game_id", "") or ""

        for lp in localisation_paths:
            cp = self._canonicalise(lp)
            all_paths.append(cp)
            existing = self._metadata.get(cp, {})
            self._metadata[cp] = {
                **existing,
                "source": "mod",
                "mod_id": mod_identity,
                "mod_name": mod_name,
                "game_id": game_id,
                "handler": handler,
                "language": language,
            }

    # ------------------------------------------------------------------
    #  Search-based addition
    # ------------------------------------------------------------------

    def search_and_add_files(
        self,
        roots: List[str],
        handler: str = "stellaris_localisation",
        language: str = "english",
        add: bool = False,
    ) -> tuple[List[str], List[Dict[str, Any]]]:
        """Search for localisation files in root directories.

        Returns ``(found_paths, diagnostics)``.
        If *add* is ``True``, found files are also added to the draft.
        """
        diagnostics: List[Dict[str, Any]] = []
        found_paths: List[str] = []

        for root in roots:
            root_path = Path(root).resolve()
            if not root_path.is_dir():
                diagnostics.append({
                    "level": "warning",
                    "code": "ROOT_NOT_FOUND",
                    "message": f"Search root not found or not a directory: {root}",
                })
                continue

            for dirpath, _dirnames, filenames in os.walk(root_path):
                for fn in filenames:
                    if not fn.endswith((".yml", ".yaml", ".csv")):
                        continue
                    full_path = os.path.join(dirpath, fn)
                    # Filter by language if specified
                    if language:
                        rel = full_path.replace("\\", "/")
                        if f"/{language}/" not in rel:
                            continue
                    found_paths.append(full_path)

        if add and found_paths:
            meta = {
                "source": "search",
                "handler": handler,
                "language": language,
            }
            self.add_files(found_paths, metadata=meta)

        return found_paths, diagnostics

    # ------------------------------------------------------------------
    #  Grouping
    # ------------------------------------------------------------------

    def compute_grouped(self) -> List[Dict[str, Any]]:
        """Compute a hierarchical grouped tree from the flat file list.

        Grouping rules
        --------------
        1. Files with ``mod_id`` metadata:
           group by mod (``group_type: "mod"``) → relative folder → files
        2. Files without mod metadata:
           group by parent folder (``group_type: "folder"``) → files
        3. ``name`` = basename of path, ``exists`` = os.path.exists(path)
        4. Sort: groups by title, files by name
        """
        # Intermediate structure: {group_key: group_dict}
        mod_groups: Dict[str, Any] = {}
        folder_groups: Dict[str, Any] = {}

        for f in self._files:
            meta = self._metadata.get(f, {})
            mod_id = meta.get("mod_id")
            mod_name = meta.get("mod_name", mod_id)
            parent = os.path.dirname(f)
            name = os.path.basename(f)
            exists = os.path.exists(f)
            rel_path = meta.get("relative_path")
            source = meta.get("source", "manual")
            handler = meta.get("handler")

            file_entry = {
                "path": f,
                "name": name,
                "relative_path": rel_path,
                "parent_folder": parent,
                "source": source,
                "mod_id": mod_id,
                "mod_name": mod_name,
                "handler": handler,
                "exists": exists,
                "selected": True,
            }

            if mod_id:
                # Group by mod
                if mod_id not in mod_groups:
                    mod_groups[mod_id] = {
                        "group_type": "mod",
                        "group_id": mod_id,
                        "title": mod_name or mod_id,
                        "subtitle": None,
                        "children": {},
                    }
                # Sub-group by relative path folder
                folder_key = os.path.dirname(rel_path) if rel_path else parent
                if folder_key not in mod_groups[mod_id]["children"]:
                    mod_groups[mod_id]["children"][folder_key] = {
                        "group_type": "folder",
                        "group_id": folder_key,
                        "title": folder_key,
                        "files": [],
                    }
                mod_groups[mod_id]["children"][folder_key]["files"].append(file_entry)
            else:
                # Group by parent folder
                folder_key = parent or "/"
                if folder_key not in folder_groups:
                    folder_groups[folder_key] = {
                        "group_type": "folder",
                        "group_id": folder_key,
                        "title": folder_key,
                        "files": [],
                    }
                folder_groups[folder_key]["files"].append(file_entry)

        # Convert intermediate structure to sorted list
        result: List[Dict[str, Any]] = []

        for g in sorted(mod_groups.values(), key=lambda x: x["title"]):
            children = g.pop("children", {})
            if children:
                sorted_children = sorted(
                    children.values(), key=lambda x: x["title"]
                )
                for child in sorted_children:
                    child["files"] = sorted(
                        child["files"], key=lambda x: x["name"]
                    )
                g["children"] = sorted_children
            result.append(g)

        for g in sorted(folder_groups.values(), key=lambda x: x["title"]):
            g["files"] = sorted(g["files"], key=lambda x: x["name"])
            result.append(g)

        return result

    # ------------------------------------------------------------------
    #  Diagnostics
    # ------------------------------------------------------------------

    def _collect_diagnostics(self) -> List[Dict[str, Any]]:
        """Gather warnings about the current draft state."""
        diag: List[Dict[str, Any]] = []
        missing_count = 0
        for f in self._files:
            if not os.path.exists(f):
                missing_count += 1
                if missing_count <= 5:  # Limit to avoid huge responses
                    diag.append({
                        "level": "warning",
                        "code": "FILE_NOT_FOUND",
                        "message": f"File does not exist on disk: {f}",
                        "details": {"path": f},
                    })
        if missing_count > 5:
            diag.append({
                "level": "info",
                "code": "MORE_MISSING_FILES",
                "message": f"... and {missing_count - 5} more missing files",
                "details": {"total_missing": missing_count},
            })
        return diag
