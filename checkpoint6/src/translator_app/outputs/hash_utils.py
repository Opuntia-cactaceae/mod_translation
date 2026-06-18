"""Shared hash utilities for content-addressed analysis validity.

Provides a single, consistent hashing function used across scanner,
editor service, and analysis service to compute content fingerprints.
"""

import hashlib
from pathlib import Path
from typing import Optional


def hash_content(content: str) -> str:
    """SHA-256 fingerprint of text content, truncated to 16 hex chars.

    Uses stable UTF-8 normalization so that the same logical text
    always produces the same hash regardless of platform encoding.
    """
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def read_and_hash(path: str) -> Optional[str]:
    """Read a UTF-8 text file and return its content hash.

    Returns ``None`` if the file does not exist or cannot be read.
    """
    try:
        content = Path(path).read_text(encoding="utf-8")
        return hash_content(content)
    except (OSError, RuntimeError):
        return None
