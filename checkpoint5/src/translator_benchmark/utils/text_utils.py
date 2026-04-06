def normalize_whitespace(text: str) -> str:
    """
    Args:
        text: Input text.

    Returns:
        Normalized text.
    """
    return " ".join(text.split())


def truncate_text(text: str, max_len: int) -> str:
    """
    Args:
        text: Input text.
        max_len: Maximum length.

    Returns:
        Truncated text (with ellipsis if truncated).
    """
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."