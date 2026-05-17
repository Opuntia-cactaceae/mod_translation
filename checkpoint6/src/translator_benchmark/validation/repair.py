def strip_markdown_code_fences(raw_response: str) -> str:
    """
    Args:
        raw_response: Raw response text.

    Returns:
        Cleaned text.
    """
    s = raw_response.strip()
    if s.startswith("```"):
        lines = s.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        s = "\n".join(lines).strip()
    return s


def extract_first_json_array(raw_response: str) -> str | None:
    """
    Args:
        raw_response: Raw response text.

    Returns:
        JSON string or None.
    """
    s = strip_markdown_code_fences(raw_response)
    if not s:
        return None
    if s.lstrip().startswith("[") and s.rstrip().endswith("]"):
        return s
    i1, i2 = s.find("["), s.rfind("]")
    if i1 != -1 and i2 != -1 and i2 > i1:
        return s[i1: i2 + 1]
    return None


def normalize_single_translation(raw_response: str) -> str:
    """
    Args:
        raw_response: Raw response text.

    Returns:
        Normalized text.
    """
    s = strip_markdown_code_fences(raw_response)
    return s.strip()