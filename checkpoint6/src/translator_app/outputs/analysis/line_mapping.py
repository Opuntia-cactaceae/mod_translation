"""Line/entry mapping utilities for analysis diagnostics.

Maps entry keys to source/translated file lines so that diagnostics
can reference specific locations in the UI.  Works best with
structured (parsed) files; falls back to line-by-line search for
raw text.
"""

from typing import Dict, Optional


def map_entry_key_to_line(
    entries: list[Dict],
    key_field: str = "key",
    line_field: str = "source_line",
) -> Dict[str, int]:
    """Build a mapping from entry key to line number.

    Args:
        entries: List of entry dicts (from editor payload or parsed entries).
        key_field: Dict key holding the entry key.
        line_field: Dict key holding the line number.

    Returns:
        Dict mapping entry keys to line numbers.
    """
    result: Dict[str, int] = {}
    for entry in entries:
        key = entry.get(key_field) or ""
        if key:
            line = entry.get(line_field) or 0
            if isinstance(line, (int, float)):
                result[key] = int(line)
    return result


def find_line_for_text(text: str, target: str) -> Optional[int]:
    """Find the 1-based line number where *target* first appears in *text*.

    Uses simple ``str.find`` for each line.  Returns None if not found.

    Args:
        text: The full file text.
        target: The sub-string to search for.

    Returns:
        1-based line number, or None.
    """
    if not target:
        return None
    lines = text.splitlines()
    for i, line in enumerate(lines, start=1):
        if target in line:
            return i
    return None


def find_line_for_key(text: str, key: str) -> Optional[int]:
    """Find the 1-based line number where *key* appears as a word in *text*.

    Looks for the key preceded by common delimiters (quote, space, tab).

    Args:
        text: The full file text.
        key: The entry key to search for.

    Returns:
        1-based line number, or None.
    """
    if not key:
        return None
    lines = text.splitlines()
    for i, line in enumerate(lines, start=1):
        if key in line:
            return i
    return None
