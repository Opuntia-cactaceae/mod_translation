"""System/Filesystem API router.

Provides endpoints for browsing the local filesystem so the frontend
can implement a path-picker UI without requiring native file dialogs.
"""

import os
import platform
import stat
import subprocess
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter

from translator_app.backend.errors import APIError, PERMISSION_DENIED
from translator_app.backend.path_utils import canonicalize_path, expand_user_path
from translator_app.backend.schemas.system import (
    HomeResponse,
    PathInfoRequest,
    PathInfoResponse,
    ListDirectoryRequest,
    ListDirectoryResponse,
    DirectoryItem,
    RevealPathRequest,
    RevealPathResponse,
)

router = APIRouter(tags=["system"])

PATH_NOT_FOUND = "PATH_NOT_FOUND"
PATH_NOT_READABLE = "PATH_NOT_READABLE"
PATH_NOT_DIRECTORY = "PATH_NOT_DIRECTORY"


def _resolve_path(path_str: str) -> Path:
    """Resolve a path string to an absolute, fully-resolved Path."""
    return expand_user_path(path_str)


@router.post("/api/system/path-info", response_model=PathInfoResponse)
def get_path_info(body: PathInfoRequest):
    """Return metadata about a single file-system path."""
    p = _resolve_path(body.path)

    if not p.exists():
        return PathInfoResponse(
            path=str(p),
            exists=False,
            parent=str(p.parent) if p.parent else None,
            name=p.name,
        )

    can_read = os.access(str(p), os.R_OK)
    can_write = os.access(str(p), os.W_OK)

    return PathInfoResponse(
        path=str(p),
        exists=True,
        is_file=p.is_file(),
        is_directory=p.is_dir(),
        can_read=can_read,
        can_write=can_write,
        parent=str(p.parent) if p.parent else None,
        name=p.name,
    )


@router.post("/api/system/list-directory", response_model=ListDirectoryResponse)
def list_directory(body: ListDirectoryRequest):
    """List entries in a directory with optional filtering."""
    p = _resolve_path(body.path)

    if not p.exists():
        raise APIError(
            code=PATH_NOT_FOUND,
            message=f"Path not found: {body.path}",
            status_code=404,
        )

    if not p.is_dir():
        raise APIError(
            code=PATH_NOT_DIRECTORY,
            message=f"Path is not a directory: {body.path}",
            status_code=400,
        )

    if not os.access(str(p), os.R_OK):
        raise APIError(
            code=PERMISSION_DENIED,
            message=f"Path not readable: {body.path}",
            status_code=403,
        )

    try:
        entries = list(p.iterdir())
    except PermissionError:
        raise APIError(
            code=PERMISSION_DENIED,
            message=f"Cannot list directory: {body.path}",
            status_code=403,
        )

    # Normalise extension list for comparison
    valid_exts = (
        [ext.lower() if ext.startswith(".") else f".{ext.lower()}" for ext in body.extensions]
        if body.extensions
        else None
    )

    items: list[DirectoryItem] = []

    for entry in entries:
        # Hidden files filter
        if not body.show_hidden and entry.name.startswith("."):
            continue

        try:
            st = entry.stat()
        except OSError:
            continue

        is_dir = stat.S_ISDIR(st.st_mode)
        is_file = stat.S_ISREG(st.st_mode)

        if not is_dir and not is_file:
            continue

        item_type = "directory" if is_dir else "file"

        # Mode filter
        if body.mode == "directories" and item_type != "directory":
            continue
        if body.mode == "files" and item_type != "file":
            continue

        # Extension filter (files only)
        if valid_exts and item_type == "file":
            ext = entry.suffix.lower()
            if ext not in valid_exts:
                continue

        size_bytes = st.st_size if is_file else None
        modified_at = datetime.fromtimestamp(st.st_mtime).isoformat()

        items.append(
            DirectoryItem(
                name=entry.name,
                path=canonicalize_path(entry),
                type=item_type,
                size_bytes=size_bytes,
                modified_at=modified_at,
            )
        )

    # Sort: directories first, then files; alphabetically within each group
    items.sort(key=lambda x: (0 if x.type == "directory" else 1, x.name.lower()))

    parent = str(p.parent) if p.parent else None

    return ListDirectoryResponse(
        path=str(p),
        parent=parent,
        items=items,
        diagnostics=[],
    )


@router.get("/api/system/home", response_model=HomeResponse)
def get_home():
    """Return the current user's home directory path."""
    return HomeResponse(home=str(Path.home()))


@router.post("/api/system/reveal-path", response_model=RevealPathResponse)
def reveal_path(body: RevealPathRequest):
    """Open the given path in the system file manager.

    On macOS uses ``open -R`` (reveal in Finder).
    On Linux uses ``xdg-open`` on the parent directory.
    On Windows uses ``explorer /select``.
    """
    p = expand_user_path(body.path)

    if not p.exists():
        return RevealPathResponse(
            success=False,
            message=f"Path does not exist: {body.path}",
        )

    system = platform.system()

    try:
        if system == "Darwin":
            if p.is_file():
                subprocess.run(["open", "-R", str(p)], check=True)
            else:
                subprocess.run(["open", str(p)], check=True)
        elif system == "Linux":
            target = p.parent if p.is_file() else p
            subprocess.run(["xdg-open", str(target)], check=True)
        elif system == "Windows":
            subprocess.run(["explorer", "/select,", str(p)], check=True)
        else:
            return RevealPathResponse(
                success=False,
                message=f"Unsupported platform: {system}",
            )
    except subprocess.CalledProcessError as e:
        return RevealPathResponse(
            success=False,
            message=f"Failed to open path: {e}",
        )
    except FileNotFoundError:
        return RevealPathResponse(
            success=False,
            message="File manager command not found on this system",
        )

    return RevealPathResponse(
        success=True,
        message=f"Opened: {p}",
    )
