import json
from typing import List, Optional, Tuple
from .repair import extract_first_json_array


def parse_json_array_response(raw_response: str) -> Tuple[Optional[List[str]], List[str]]:
    """
    Args:
        raw_response: Raw response text.

    Returns:
        Tuple of (parsed list or None, list of errors).
    """
    errors = []
    array_str = extract_first_json_array(raw_response)
    if not array_str:
        errors.append("No JSON array found in response")
        return None, errors

    try:
        parsed = json.loads(array_str)
    except json.JSONDecodeError as e:
        errors.append(f"JSON decode error: {e}")
        return None, errors

    if not isinstance(parsed, list):
        errors.append(f"Expected JSON array, got {type(parsed).__name__}")
        return None, errors

    items = ["" if x is None else str(x) for x in parsed]
    return items, errors


def check_batch_length(items: List[str], expected_count: int) -> List[str]:
    """
    Args:
        items: Parsed items.
        expected_count: Expected count.

    Returns:
        List of errors.
    """
    errors = []
    if len(items) != expected_count:
        errors.append(f"Expected {expected_count} items, got {len(items)}")
    return errors