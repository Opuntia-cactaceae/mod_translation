import json
from typing import Any, Optional


def safe_json_loads(text: str) -> Optional[Any]:
    """
    Args:
        text: JSON string.

    Returns:
        Parsed object or None.
    """
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None


def safe_json_dumps(data: Any) -> str:
    """
    Args:
        data: Serializable data.

    Returns:
        JSON string.
    """
    return json.dumps(data, sort_keys=True, ensure_ascii=False, indent=None)