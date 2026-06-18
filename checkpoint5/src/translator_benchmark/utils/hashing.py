import hashlib


def sha1_text(text: str) -> str:
    """
    Args:
        text: Input string.

    Returns:
        Hex digest.
    """
    return hashlib.sha1(text.encode("utf-8")).hexdigest()