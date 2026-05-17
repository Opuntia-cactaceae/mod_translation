"""In-memory draft job selection service.

Holds the "draft" collection of files the user has selected for a
translation job, along with per-file metadata (mod context).

Design decisions
----------------
*State is kept in-memory only.*  A backend restart resets the draft,
which is acceptable since the draft is a temporary selection that
survives page navigation but does not need to survive server restarts.
Optional JSON persistence can be added later by writing to a file on
every mutation and reading on startup.

*All file paths are canonicalised* (symlinks resolved, absolute) so
that the same file always produces the same identity key regardless of
how its path was expressed by the frontend.  Relative paths are
preserved as-is.
"""

import logging
import os
from typing import Any, Dict, List, Optional

from translator_app.backend.path_utils import canonicalize_path

logger = logging.getLogger(__name__)


class DraftJobSelectionService:
    """Holds the in-memory draft job selection state."""

    def __init__(self) -> None:
        self._files: List[str] = []
        self._metadata: Dict[str, Dict[str, Any]] = {}

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
    #  Public API
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

    def get_state(self) -> Dict[str, Any]:
        """Return the full draft state as a serialisable dict."""
        return {
            "files": self.files,
            "file_metadata": self.file_metadata,
            "count": self.count,
        }

    def add_files(
        self,
        file_paths: List[str],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Add files to the draft.  Deduplicates by canonical path.

        If *metadata* is provided, it is associated with every file
        added in this call (useful for bulk-add from a single mod).
        """
        existing_canonical = {self._canonicalise(f) for f in self._files}
        new_paths: List[str] = []
        for p in file_paths:
            cp = self._canonicalise(p)
            if cp not in existing_canonical:
                existing_canonical.add(cp)
                new_paths.append(cp)
                self._files.append(cp)

            # Store / merge metadata for this file
            if metadata and (metadata.get("mod_id") or metadata.get("mod_name")):
                existing = self._metadata.get(cp, {})
                merged = {**existing, **metadata}
                self._metadata[cp] = merged

    def remove_files(self, file_paths: List[str]) -> None:
        """Remove files from the draft.  Canonical comparison."""
        remove_canonical = {self._canonicalise(p) for p in file_paths}
        self._files = [f for f in self._files if f not in remove_canonical]
        # Also clean up metadata for removed files
        for cp in remove_canonical:
            self._metadata.pop(cp, None)

    def set_files(
        self,
        files: List[str],
        file_metadata: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> None:
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
            self._metadata = {k: v for k, v in self._metadata.items() if k in canonical_set}

    def clear(self) -> None:
        """Remove all files and metadata."""
        self._files.clear()
        self._metadata.clear()

    def get_file_metadata_for_path(self, path: str) -> Optional[Dict[str, Any]]:
        """Return metadata for a specific file path (canonical lookup)."""
        cp = self._canonicalise(path)
        return self._metadata.get(cp)
