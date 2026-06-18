"""Output path resolution for generic translation files.

Provides ``resolve_output_path`` which determines where a translated file
should be written based on the ``TranslationConfig.output`` settings,
the source file path, and an optional root directory for relative path
preservation.

This is the single entry point used by ``JobExecutionService`` when the
job's game type is ``"generic"``.  Stellaris jobs continue to use the
legacy ``OutputNamingService``.
"""

import os
import time
from pathlib import Path
from typing import Optional

from translator_app.translation.config import TranslationConfig


def resolve_output_path(
    source_path: str,
    config: TranslationConfig,
    root_dir: Optional[str] = None,
) -> str:
    """Resolve the full output path for a translated generic file.

    Logic:
        1. Determine the base output directory:
           - ``config.output.output_dir`` if non-empty, otherwise
             the parent directory of ``source_path``.
        2. If ``preserve_relative_path`` is ``True`` and a root directory
           is available (from ``config.output.root_dir``, or the
           ``root_dir`` parameter), compute the relative path of the
           source file inside the root and mirror the tree layout under
           the output directory.
        3. Otherwise, place the file directly in the output directory
           using the source file's basename.
        4. If ``config.output.filename_suffix`` is non-empty, insert it
           before the file extension (e.g. ``file.json`` →
           ``file_translated.json``).
        5. Check for naming conflicts and apply auto-rename or backup
           according to ``config.output.overwrite`` and
           ``config.output.backup``.

    Args:
        source_path: Absolute path to the original source file.
        config: The assembled ``TranslationConfig`` (includes the
            ``output`` sub-config).
        root_dir: Optional root directory override.  Falls back to
            ``config.output.root_dir``.

    Returns:
        The absolute output path where the translated file should be
        written.
    """
    out = config.output

    # 1. Base output directory
    output_dir = out.output_dir.strip() if out.output_dir else ""
    if not output_dir:
        output_dir = os.path.dirname(os.path.abspath(source_path))
    else:
        output_dir = os.path.abspath(output_dir)

    # 2. Determine root directory for relative path preservation
    effective_root = root_dir or (out.root_dir.strip() if out.root_dir else None)

    if out.preserve_relative_path and effective_root:
        root = os.path.abspath(effective_root)
        try:
            rel = os.path.relpath(os.path.abspath(source_path), root)
            # Prevent going above root (e.g. "../../etc")
            if not rel.startswith(".."):
                output_dir = os.path.join(output_dir, os.path.dirname(rel))
        except ValueError:
            # On Windows different drives, fallback to basename
            pass

    # 3. Build the filename
    basename = os.path.basename(source_path)
    name, ext = os.path.splitext(basename)

    # 4. Apply suffix
    if out.filename_suffix:
        # Only add suffix if not already present
        if not name.endswith(out.filename_suffix):
            name = f"{name}{out.filename_suffix}"

    output_filename = f"{name}{ext}"
    output_path = os.path.join(output_dir, output_filename)

    # 5. Conflict handling
    if os.path.exists(output_path):
        if out.overwrite:
            if out.backup:
                backup_path = _build_backup_path(output_path)
                os.rename(output_path, backup_path)
        else:
            output_path = _ensure_unique(output_path)

    return output_path


def _ensure_unique(path: str) -> str:
    """Return a unique file path by appending ``_1``, ``_2`` … if needed.

    ``file.json`` → ``file_1.json`` (if ``file.json`` exists)
    ``file_1.json`` → ``file_2.json`` (if ``file_1.json`` exists)
    """
    p = Path(path)
    if not p.exists():
        return path

    stem = p.stem
    suffix = p.suffix
    parent = p.parent

    counter = 1
    while True:
        candidate = parent / f"{stem}_{counter}{suffix}"
        if not candidate.exists():
            return str(candidate)
        counter += 1


def _build_backup_path(path: str) -> str:
    """Build a backup path for the given file.

    ``file.json`` → ``file_backup_<timestamp>.json``
    """
    p = Path(path)
    timestamp = int(time.time())
    backup_name = f"{p.stem}_backup_{timestamp}{p.suffix}"
    return str(p.parent / backup_name)
