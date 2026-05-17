import re
from typing import List


def mask_secret(secret: str, visible_chars: int = 4, mask_char: str = "*") -> str:
    """Mask a secret string, showing only the last ``visible_chars`` characters.

    * Empty string  → empty string.
    * Short secret  → all characters replaced with ``mask_char``.
    * Normal secret → last N characters visible, rest masked.
    """
    if not secret:
        return ""
    if len(secret) <= visible_chars:
        return mask_char * len(secret)
    visible = secret[-visible_chars:]
    masked = mask_char * (len(secret) - visible_chars)
    return masked + visible


_KNOWN_API_KEY_PATTERNS = [
    # sk-... (OpenAI, DeepSeek, etc.)
    re.compile(r"(sk-[A-Za-z0-9]{10,})"),
    # gsk_... (Groq)
    re.compile(r"(gsk_[A-Za-z0-9]{10,})"),
]


def sanitize_text(text: str, known_keys: List[str] = None) -> str:
    """Remove known API keys from a text string (for log sanitisation).

    * Replaces all recognised key patterns (``sk-...``, ``gsk_...``).
    * Also replaces any literal key values passed via ``known_keys``.
    * Returns the sanitised string — never reveals the raw key.
    """
    result = text
    for pattern in _KNOWN_API_KEY_PATTERNS:
        result = pattern.sub("***", result)
    if known_keys:
        for key in known_keys:
            if key and len(key) > 4:
                result = result.replace(key, "***")
    return result
