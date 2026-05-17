"""Job output location resolver — determines output_root and source_root for a job.

Reads from the existing ``JobManager`` / ``JobRepository`` rather than
parsing the database directly.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from translator_app.jobs.manager import JobManager
from translator_app.jobs.models import JobStatus, TranslationJob
from translator_app.translation.config import TranslationConfig, config_from_dict

logger = logging.getLogger(__name__)


class JobOutputLocationError(Exception):
    """Raised when output/source roots cannot be determined for a job."""


@dataclass
class JobOutputLocations:
    """Resolved output and source directories for a translation job."""

    job_id: str
    output_root: str
    source_root: str
    game_id: str = ""
    job_name: str = ""
    completed_at: Optional[str] = None
    status: str = ""


@dataclass
class JobOutputLocationResolver:
    """Resolves output_root and source_root for a given job_id.

    Resolution order for output_root:
        1. ``job.output_root_dir`` (set by execution on completion).
        2. ``config.output.output_dir`` from the job's config snapshot.
        3. Fallback to ``TRANSLATOR_APP_OUTPUT_DIR`` / ``<data_dir>/outputs``.

    Resolution order for source_root:
        1. ``config.output.root_dir`` from the job's config snapshot.
        2. Common parent directory of all ``job.file_paths``.
        3. If only one source file — its parent directory.
    """

    job_manager: JobManager

    def resolve(self, job_id: str) -> JobOutputLocations:
        """Resolve output and source roots for the given job.

        Raises ``JobOutputLocationError`` if the job cannot be found.
        """
        job = self.job_manager.get_job(job_id)
        if job is None:
            raise JobOutputLocationError(f"Job not found: {job_id}")

        output_root = self._resolve_output_root(job)
        source_root = self._resolve_source_root(job)

        if not output_root:
            raise JobOutputLocationError(
                f"Cannot determine output_root for job {job_id}: "
                f"no output_root_dir, no config.output.output_dir"
            )

        return JobOutputLocations(
            job_id=job_id,
            output_root=output_root,
            source_root=source_root,
            game_id=self._get_game_id(job),
            job_name=job.name,
            completed_at=self._get_completed_at(job),
            status=job.status.value if job.status else "",
        )

    def _resolve_output_root(self, job: TranslationJob) -> str:
        """Resolve the output root directory for a job."""
        # Priority 1: output_root_dir from the job
        if job.output_root_dir:
            return str(Path(job.output_root_dir).resolve())

        # Priority 2: config.output.output_dir
        config = self._get_config(job)
        if config and config.output and config.output.output_dir:
            return str(Path(config.output.output_dir).resolve())

        # Priority 3: global output dir from storage paths
        from translator_app.storage.paths import get_output_dir
        global_dir = get_output_dir()
        if global_dir:
            return str(Path(global_dir).resolve())

        return ""

    def _resolve_source_root(self, job: TranslationJob) -> str:
        """Resolve the source root directory for a job."""
        # Priority 1: config.output.root_dir
        config = self._get_config(job)
        if config and config.output and config.output.root_dir:
            return str(Path(config.output.root_dir).resolve())

        # Priority 2: common parent of all source file paths
        if job.file_paths:
            resolved = [Path(p).resolve() for p in job.file_paths]
            if len(resolved) == 1:
                return str(resolved[0].parent)
            # Find common ancestor
            common = self._common_parent(resolved)
            if common:
                return str(common)
            # Fallback: parent of the first file
            return str(resolved[0].parent)

        return ""

    @staticmethod
    def _get_config(job: TranslationJob) -> Optional[TranslationConfig]:
        """Rehydrate TranslationConfig from job.config if possible."""
        if job.config is None:
            return None
        if isinstance(job.config, TranslationConfig):
            return job.config
        if isinstance(job.config, dict):
            return config_from_dict(job.config)
        return None

    @staticmethod
    def _get_game_id(job: TranslationJob) -> str:
        config = JobOutputLocationResolver._get_config(job)
        if config:
            return config.game
        return ""

    @staticmethod
    def _get_completed_at(job: TranslationJob) -> Optional[str]:
        if job.status == JobStatus.COMPLETED and job.updated_at:
            if hasattr(job.updated_at, "isoformat"):
                return job.updated_at.isoformat()
            return str(job.updated_at)
        return None

    @staticmethod
    def _common_parent(paths: list) -> Optional[Path]:
        """Find the common ancestor directory of all paths."""
        if not paths:
            return None
        # Start with the first path's parts
        try:
            common = Path(paths[0]).resolve()
            for p in paths[1:]:
                p_resolved = Path(p).resolve()
                # Walk up until we find a common parent
                while common != p_resolved and not str(p_resolved).startswith(str(common)):
                    common = common.parent
                    if str(common) == "/":
                        return None
            return common
        except (ValueError, OSError):
            return None


# Backward-compatible alias
TranslationJobOutputLocationResolver = JobOutputLocationResolver
