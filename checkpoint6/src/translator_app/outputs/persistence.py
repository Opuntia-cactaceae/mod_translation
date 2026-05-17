"""OutputPersistenceService — unified write+manifest-register layer.

Ensures that every translated output file written to disk is also
registered in the ``OutputManifestCollector``.  This is the single
authoritative path for writing translated output files.

Usage::

    svc = OutputPersistenceService()
    svc.set_job_context("job-1", output_root="/out", source_root="/src")

    # Writes file AND registers in manifest
    svc.write_translated_file(
        output_path="/out/mod/file.txt",
        content="translated content",
        source_path="/src/mod/file.txt",
    )

    # At job completion, pop collector and write manifest:
    collector = svc.pop_collector("job-1")
    if collector:
        collector.write(output_root)
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from translator_app.outputs.manifest import OutputManifestCollector

logger = logging.getLogger(__name__)


class OutputPersistenceError(Exception):
    """Raised when output persistence operations fail."""


class OutputPersistenceService:
    """Writes translated output files and registers them in the manifest.

    Maintains per-job ``OutputManifestCollector`` instances.  Every
    ``write_translated_file()`` call persists content to disk and
    registers the file in the collector.

    Call ``pop_collector()`` at job completion to obtain the collector
    for writing the final ``.output_manifest.json``.
    """

    def __init__(self):
        self._collectors: Dict[str, OutputManifestCollector] = {}
        self._lock = threading.Lock()
        # Per-job context metadata
        self._job_names: Dict[str, str] = {}
        self._job_source_roots: Dict[str, str] = {}
        self._job_output_roots: Dict[str, str] = {}
        self._job_game_ids: Dict[str, str] = {}
        # Per-job mod context (legacy — one mod per job).
        # Used as fallback when no per-file context is available.
        self._job_mod_ids: Dict[str, str] = {}
        self._job_mod_names: Dict[str, str] = {}
        # Per-file mod context: job_id -> {source_path -> {mod_id, mod_name}}
        # This is the primary source for multi-mod jobs.
        self._job_file_contexts: Dict[str, Dict[str, Dict[str, str]]] = {}

    # ------------------------------------------------------------------
    # Job context management
    # ------------------------------------------------------------------

    def set_job_context(
        self,
        job_id: str,
        job_name: str = "",
        source_root: str = "",
        output_root: str = "",
        game_id: str = "",
        mod_id: str = "",
        mod_name: str = "",
    ) -> None:
        """DEPRECATED: Prefer :meth:`set_job_file_contexts` for per-file mod metadata.

        Set (or update) the context for a job.  The *mod_id* and *mod_name*
        parameters are a legacy fallback — they apply the SAME mod to every
        file in the job.  New code should call ``set_job_file_contexts()``
        to set per-file mod context.

        Context is stored separately and used to initialise the collector
        on first write.

        Args:
            job_id: The job's unique identifier.
            job_name: Human-readable job name.
            source_root: Root directory for source files.
            output_root: Root directory for translated output files.
            game_id: Game identifier (e.g. "stellaris").
            mod_id: Mod identifier (e.g. "1234567890").
            mod_name: Human-readable mod name.
        """
        self._job_names[job_id] = job_name
        self._job_source_roots[job_id] = source_root
        self._job_output_roots[job_id] = output_root
        self._job_game_ids[job_id] = game_id
        self._job_mod_ids[job_id] = mod_id
        self._job_mod_names[job_id] = mod_name

    def set_job_file_contexts(
        self,
        job_id: str,
        file_contexts: Dict[str, Dict[str, str]],
    ) -> None:
        """Set per-file mod context for a job.

        Each source file path maps to a dict that may contain keys like
        ``mod_id`` and ``mod_name``.  When ``write_translated_file()`` is
        called for a source file, these values are passed to the manifest
        collector so the output manifest groups entries by the correct mod.

        Args:
            job_id: The job's unique identifier.
            file_contexts: Dict mapping **normalised** source file paths to
                           their context dicts (``mod_id``, ``mod_name``, etc.).
        """
        self._job_file_contexts[job_id] = dict(file_contexts)

    def get_collector(self, job_id: str) -> Optional[OutputManifestCollector]:
        """Return the collector for *job_id*, or ``None`` if not yet created."""
        with self._lock:
            return self._collectors.get(job_id)

    def pop_collector(self, job_id: str) -> Optional[OutputManifestCollector]:
        """Remove and return the collector for *job_id*, or ``None``.

        This is intended to be called at job completion to write the
        final manifest file.
        """
        with self._lock:
            collector = self._collectors.pop(job_id, None)
            # Clean up context too
            self._job_names.pop(job_id, None)
            self._job_source_roots.pop(job_id, None)
            self._job_output_roots.pop(job_id, None)
            self._job_game_ids.pop(job_id, None)
            self._job_mod_ids.pop(job_id, None)
            self._job_mod_names.pop(job_id, None)
            self._job_file_contexts.pop(job_id, None)
            return collector

    def has_collector(self, job_id: str) -> bool:
        """Return True if a collector exists for *job_id*."""
        with self._lock:
            return job_id in self._collectors

    def has_job_context(self, job_id: str) -> bool:
        """Return True if job context (name/root/game) has been set for *job_id*."""
        return job_id in self._job_names

    # ------------------------------------------------------------------
    # Write + register  (for new job-output files)
    # ------------------------------------------------------------------

    def write_translated_file(
        self,
        job_id: str,
        output_path: str,
        content: str,
        source_path: str = "",
        parsed_file: Any = None,
        file_units: Optional[List[Any]] = None,
        encoding: str = "utf-8",
        metadata: Optional[Dict[str, Any]] = None,
        warnings: Optional[List[Any]] = None,
    ) -> None:
        """Write a translated file to disk and register it in the manifest.

        This is the ONE method that both writes content and registers
        the file — it is impossible to call one without the other.

        Args:
            job_id: The job this file belongs to.
            output_path: Absolute path to write to.
            content: File content to write.
            source_path: Absolute path to the source file.
            parsed_file: Optional parsed file object (for parser metadata).
            file_units: Optional list of translation units (for entry counts).
            encoding: File encoding (default utf-8).
            metadata: Additional file-level metadata.
            warnings: Optional list of ``OutputManifestWarning`` objects.
        """
        # 1. Write file to disk
        output_dir = os.path.dirname(output_path)
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
        with open(output_path, "w", encoding=encoding) as f:
            f.write(content)

        # 2. Register with collector
        collector = self._get_or_create_collector(job_id)
        if collector is None:
            logger.debug(
                "No collector for job %s; skipping manifest registration of %s",
                job_id, output_path,
            )
            return

        out_path = Path(output_path).resolve() if output_path else Path()
        src_path = Path(source_path).resolve() if source_path else Path()

        # Compute relative paths
        output_root_path = Path(collector.output_root).resolve() if collector.output_root else Path()
        source_root_path = Path(collector.source_root).resolve() if collector.source_root else Path()

        rel_translated = _compute_relative(out_path, output_root_path)
        rel_source = _compute_relative(src_path, source_root_path)

        # Extract parser/file metadata
        parser_id = ""
        file_ext = out_path.suffix.lstrip(".") if out_path.suffix else ""
        entries_count = len(file_units) if file_units else 0

        if parsed_file is not None:
            try:
                ft = parsed_file.file_type
                if ft is not None:
                    cat = ft.category
                    if cat is not None:
                        parser_id = cat.value if hasattr(cat, "value") else str(cat)
                    if not file_ext and ft.extensions:
                        file_ext = ft.extensions[0].lstrip(".")
            except Exception:
                pass

        from translator_app.outputs.manifest import OutputManifestWarning as ManWarning

        # Resolve mod context: per-file takes priority, job-level is fallback.
        file_ctx: Dict[str, str] = {}
        if job_id in self._job_file_contexts:
            file_ctx = self._job_file_contexts[job_id].get(source_path, {})
        mod_id = file_ctx.get("mod_id", "") or self._job_mod_ids.get(job_id, "")
        mod_name = file_ctx.get("mod_name", "") or self._job_mod_names.get(job_id, "")

        collector.register_file(
            source_file_path=str(src_path) if src_path.exists() else source_path,
            translated_file_path=str(out_path) if out_path.exists() else output_path,
            relative_source_path=rel_source,
            relative_translated_path=rel_translated,
            file_name=out_path.name,
            file_ext=file_ext,
            parser_id=parser_id,
            mod_id=mod_id,
            mod_name=mod_name,
            entries_count=entries_count,
            translated_entries_count=entries_count,
            warnings=[ManWarning(**w) if isinstance(w, dict) else w for w in (warnings or [])],
            metadata=metadata or {},
        )

    # ------------------------------------------------------------------
    # Write only — no manifest registration (for existing files, editor saves)
    # ------------------------------------------------------------------

    def write_existing_output_file(
        self,
        job_id: str,  # kept for API consistency with write_translated_file
        output_path: str,
        content: str,
        encoding: str = "utf-8",
    ) -> None:
        """Write an *existing* output file to disk without manifest registration.

        Unlike ``write_translated_file()``, this method **only** writes the
        file content — it does **not** register the file in the
        ``OutputManifestCollector``.  This is the correct method for editor
        saves, where the file was already registered during the original
        job execution and the on-disk manifest should remain a snapshot of
        the job's original output.

        Args:
            job_id: The job this file belongs to (informational only).
            output_path: Absolute path to write to.
            content: File content to write.
            encoding: File encoding (default utf-8).
        """
        output_dir = os.path.dirname(output_path)
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
        with open(output_path, "w", encoding=encoding) as f:
            f.write(content)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_or_create_collector(self, job_id: str) -> Optional[OutputManifestCollector]:
        """Get or create the collector for *job_id*."""
        with self._lock:
            collector = self._collectors.get(job_id)
            if collector is not None:
                return collector

            if job_id not in self._job_names:
                # No context set for this job — cannot create collector
                return None

            collector = OutputManifestCollector()
            collector.set_job_info(
                job_id=job_id,
                job_name=self._job_names.get(job_id, ""),
                source_root=self._job_source_roots.get(job_id, ""),
                output_root=self._job_output_roots.get(job_id, ""),
                game_id=self._job_game_ids.get(job_id, ""),
            )
            self._collectors[job_id] = collector
            return collector


def _compute_relative(path: Path, root: Path) -> str:
    """Compute POSIX relative path from *root* to *path*."""
    if not root or not path:
        return path.name
    try:
        return path.relative_to(root).as_posix()
    except (ValueError, OSError):
        return path.name
