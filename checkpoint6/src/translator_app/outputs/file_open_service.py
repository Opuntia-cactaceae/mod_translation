"""Service for opening source/translated folders via the OS file manager.

The frontend never receives raw filesystem paths — all operations are
keyed by ``output_file_id`` only.  The backend resolves the file record,
validates the path via ``path_security``, then opens the parent directory
using the platform's native file manager (Finder, nautilus, explorer).
"""

import logging
import subprocess
import sys
from pathlib import Path
from typing import Any, List, Optional

from translator_app.backend.errors import APIError, NOT_FOUND, INTERNAL_ERROR
from translator_app.outputs.path_security import (
    OutputPathSecurityError,
    resolve_and_validate,
)
from translator_app.outputs.repository import TranslatedOutputFileRepository

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Platform-specific open commands
# ---------------------------------------------------------------------------

_OPEN_COMMANDS: dict = {
    "darwin": ["open"],
    "linux": ["xdg-open"],
    "win32": ["explorer"],
}


def _get_open_command() -> List[str]:
    """Return the platform-specific command to open a folder.

    Returns:
        A list of command arguments (e.g. ``["open"]`` on macOS).

    Raises:
        APIError: If the current platform is not supported.
    """
    platform = sys.platform
    cmd = _OPEN_COMMANDS.get(platform)
    if cmd is None:
        raise APIError(
            code="UNSUPPORTED_PLATFORM",
            message=(
                f"Opening folders is not supported on platform {platform!r}. "
                f"Supported platforms: darwin, linux, win32"
            ),
            status_code=400,
        )
    return list(cmd)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class FileOpenService:
    """Opens source or translated parent directories via the OS file manager.

    Usage::

        service = FileOpenService(repository=repo)
        service.open_source_folder(output_file_id="out_abc123")
        service.open_translated_folder(output_file_id="out_abc123")
    """

    def __init__(
        self,
        repository: TranslatedOutputFileRepository,
        allowed_roots: Optional[List[str]] = None,
        job_manager: Optional[Any] = None,
    ):
        self._repo = repository
        self._allowed_roots = list(allowed_roots) if allowed_roots else []
        self._job_manager = job_manager

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def open_source_folder(self, output_file_id: str) -> None:
        """Open the parent directory of the source file in the OS file manager.

        Args:
            output_file_id: The output file record id.

        Raises:
            APIError: If the file is not found, the path is invalid /
                      outside allowed roots, the platform is unsupported,
                      or the subprocess call fails.
        """
        output_file = self._get_file_or_error(output_file_id)
        source_path = output_file.source_file_path
        if not source_path:
            raise APIError(
                code="INVALID_REQUEST",
                message="Output file has no source file path",
                status_code=400,
            )
        self._open_parent(source_path)

    def open_translated_folder(self, output_file_id: str) -> None:
        """Open the parent directory of the translated file in the OS file manager.

        Args:
            output_file_id: The output file record id.

        Raises:
            APIError: If the file is not found, the path is invalid /
                      outside allowed roots, the platform is unsupported,
                      or the subprocess call fails.
        """
        output_file = self._get_file_or_error(output_file_id)
        translated_path = output_file.translated_file_path
        if not translated_path:
            raise APIError(
                code="INVALID_REQUEST",
                message="Output file has no translated file path",
                status_code=400,
            )
        self._open_parent(translated_path)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_file_or_error(self, output_file_id: str):
        """Fetch the output file record, raising a 404 APIError if missing."""
        output_file = self._repo.get_by_id(output_file_id)
        if not output_file:
            raise APIError(
                code=NOT_FOUND,
                message=f"Output file not found: {output_file_id}",
                status_code=404,
            )
        return output_file

    def _open_parent(self, file_path: str) -> None:
        """Validate *file_path* and open its parent directory.

        Steps:
            1. Resolve and validate the path via ``path_security``.
            2. Get the parent directory.
            3. Launch the platform-specific open command (non-blocking).

        Raises:
            APIError: On validation failure or subprocess error.
        """
        # Build effective allowed roots (static + dynamic from job manager)
        effective_roots = list(self._allowed_roots) if self._allowed_roots else None
        if self._job_manager is not None:
            try:
                for j in self._job_manager.list_jobs():
                    if j.output_root_dir:
                        root = str(Path(j.output_root_dir).resolve())
                        if effective_roots is None:
                            effective_roots = []
                        if root not in effective_roots:
                            effective_roots.append(root)
            except Exception:
                pass

        # Resolve and validate path
        try:
            resolved = resolve_and_validate(file_path, effective_roots)
        except OutputPathSecurityError as exc:
            raise APIError(
                code="PATH_TRAVERSAL",
                message=exc.message,
                details={"path": exc.path or file_path},
                status_code=403,
            ) from exc

        parent_dir = resolved.parent if resolved.is_file() else resolved

        if not parent_dir.exists():
            raise APIError(
                code="PATH_NOT_FOUND",
                message=f"Parent directory does not exist: {parent_dir}",
                details={"path": str(parent_dir)},
                status_code=404,
            )

        # Build platform command
        cmd = _get_open_command() + [str(parent_dir)]

        try:
            subprocess.Popen(cmd, shell=False)
        except (OSError, subprocess.SubprocessError) as exc:
            logger.error("Failed to open folder %s: %s", parent_dir, exc)
            raise APIError(
                code="FOLDER_OPEN_FAILED",
                message=f"Failed to open folder: {exc}",
                details={"path": str(parent_dir), "command": cmd},
                status_code=500,
            ) from exc

        logger.info("Opened folder: %s (cmd=%s)", parent_dir, cmd)
