"""Path security for translated output file operations.

Ensures that file paths derived from ``output_file_id`` records stay
within the allowed output roots and that path traversal attacks are
blocked.
"""

from pathlib import Path
from typing import List, Optional, Set


class OutputPathSecurityError(Exception):
    """Raised when a path fails a security check."""

    def __init__(self, message: str, path: str = ""):
        self.message = message
        self.path = path
        super().__init__(message)


def resolve_and_validate(
    file_path: str,
    allowed_roots: Optional[List[str]] = None,
) -> Path:
    """Resolve *file_path* to an absolute path and validate it.

    Checks:
        1. Path resolution via ``Path.resolve()`` to eliminate
           symlinks and ``..`` components.
        2. If *allowed_roots* is provided, the resolved path must
           be within one of the allowed root directories.
        3. No path traversal (``..`` components) — this is covered
           by ``resolve()``.

    Args:
        file_path: The raw file path string.
        allowed_roots: Optional list of allowed root directories.

    Returns:
        The resolved :class:`Path`.

    Raises:
        OutputPathSecurityError: If validation fails.
    """
    try:
        resolved = Path(file_path).resolve()
    except (OSError, RuntimeError) as exc:
        raise OutputPathSecurityError(
            message=f"Failed to resolve path: {exc}",
            path=file_path,
        )

    if not resolved.exists():
        # We allow non-existing paths too (e.g., for save targets),
        # but we still check parent directory against allowed roots.
        parent = resolved.parent
        if not parent.exists():
            # Can't even resolve parent — reject
            raise OutputPathSecurityError(
                message=f"Parent directory does not exist: {parent}",
                path=str(resolved),
            )

    if allowed_roots:
        _check_allowed_root(resolved, allowed_roots)

    return resolved


def is_within_roots(path: Path, allowed_roots: List[str]) -> bool:
    """Check if *path* is within any of the *allowed_roots*.

    Both *path* and each root are resolved to absolute paths before
    comparison.
    """
    try:
        resolved = path.resolve()
    except (OSError, RuntimeError):
        return False

    for root_str in allowed_roots:
        try:
            root = Path(root_str).resolve()
        except (OSError, RuntimeError):
            continue
        if resolved == root or root in resolved.parents:
            return True

    return False


def _check_allowed_root(path: Path, allowed_roots: List[str]) -> None:
    """Check that *path* is within one of *allowed_roots*.

    Raises ``OutputPathSecurityError`` if not.
    """
    if not is_within_roots(path, allowed_roots):
        raise OutputPathSecurityError(
            message=f"Path is not within allowed output roots",
            path=str(path),
        )


def compute_allowed_roots(output_roots: Set[str]) -> List[str]:
    """Normalise a set of output root directories for path checks.

    Returns a deduplicated, resolved list of allowed roots.
    """
    seen: Set[str] = set()
    result: List[str] = []
    for root in sorted(output_roots):
        try:
            resolved = str(Path(root).resolve())
        except (OSError, RuntimeError):
            continue
        if resolved not in seen:
            seen.add(resolved)
            result.append(resolved)
    return result
