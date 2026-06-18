"""Path utility helpers for the backend API.

Provides:
- Safe expansion of user-facing paths (``~``) before filesystem operations.
- ``canonicalize_path`` — resolves symlinks, normalises for identity use.
- ``same_path`` — compares two paths for logical equality.

Canonical path contract
-----------------------
1. All paths used as identity / storage keys must be ``Path.resolve()`` —
   this resolves symlinks, ``..``, ``.``, and makes the path absolute.
2. Path strings must be absolute (no relative paths, no ``~``).
3. Symlinks must be resolved so the same file always produces the same key.
4. No trailing separators.
5. Display paths MAY differ from canonical identity paths — the UI can show
   the original path, but internal keys / storage use the canonical form.
"""

import os
from pathlib import Path


def expand_user_path(path: str) -> Path:
    """Expand ``~`` to the user's home directory and resolve to absolute.

    Args:
        path: A filesystem path string (e.g. ``~/Documents``, ``/abs/path``).

    Returns:
        An absolute, resolved :class:`Path`.

    Notes:
        - Empty or whitespace-only strings are returned as-is (no expansion).
    """
    stripped = path.strip()
    if not stripped:
        return Path(stripped)
    return Path(os.path.expanduser(stripped)).resolve()


def canonicalize_path(path: str | Path) -> str:
    """Canonical form of a filesystem path for use as an identity key.

    Resolves symlinks, normalises ``..`` / ``.``, makes absolute, strips
    trailing separators, and returns a stable string so the same file
    always yields the same key.

    This is intentionally *not* strict — if the path does not exist, the
    function falls back to resolving the parent (if available) and
    appending the name.  This ensures that paths to files that may be
    created later still produce a stable canonical form.

    Args:
        path: A filesystem path (string or ``Path``).

    Returns:
        A canonical absolute path string suitable for use as an identity key.

    Examples::

        >>> canonicalize_path("/foo/bar/../baz")
        "/foo/baz"
        >>> canonicalize_path("/symlink_to_baz")  # if symlink points to /foo/baz
        "/foo/baz"
    """
    p = Path(path) if not isinstance(path, Path) else path

    # Try a full resolve first — this handles symlinks and normalisation.
    try:
        return str(p.resolve(strict=False))
    except (OSError, RuntimeError):
        pass

    # Fallback: resolve the parent (which should exist), then join the name.
    # This gives us a canonical parent + original filename for paths that
    # may not exist yet (e.g. planned output paths).
    try:
        parent = p.parent.resolve(strict=False)
        return str(parent / p.name)
    except (OSError, RuntimeError):
        # Last resort: just do a basic resolve (strips ``..`` / ``.``)
        return str(p.resolve())


def same_path(a: str | Path, b: str | Path) -> bool:
    """Return ``True`` if *a* and *b* point to the same filesystem entry.

    Both paths are canonicalised before comparison, so symlinks,
    ``..``-containing paths, and different forms of the same file all
    compare equal.

    Args:
        a: First filesystem path.
        b: Second filesystem path.

    Returns:
        ``True`` if both paths resolve to the same canonical location.
    """
    return canonicalize_path(a) == canonicalize_path(b)


def safe_resolve(path: Path) -> Path:
    """Resolve *path* without raising on non-existent entries.

    Unlike ``Path.resolve(strict=True)`` (which raises ``FileNotFoundError``
    when the path does not exist), this method falls back gracefully:
    it resolves the parent first, then appends the file name.

    This is useful when you need a canonical path for a file that may
    not yet exist on disk (e.g. a planned output path).

    Args:
        path: The path to resolve.

    Returns:
        A resolved ``Path`` (absolute, symlinks resolved where possible).
    """
    return Path(canonicalize_path(path))
