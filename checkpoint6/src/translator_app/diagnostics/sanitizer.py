import re
from typing import Any, Dict, List, Optional, Union

from translator_app.secrets.masking import sanitize_text


class LogSanitizer:
    """Sanitizes log messages to prevent leaking sensitive information.

    Integrates with ``secrets.masking.sanitize_text`` to catch common
    API key patterns (``sk-...``, ``gsk_...``) and also performs generic
    header/token scrubbing.

    Supports sanitization of both plain text messages and nested
    dict/list context structures.
    """

    API_KEY_PATTERN = re.compile(
        r'(api[_-]?key|apikey|secret|token)\s*[:=]\s*["\']?([^"\'&\s]+)',
        re.IGNORECASE,
    )
    AUTHORIZATION_PATTERN = re.compile(
        r'(Authorization|Bearer)\s+(\S+)', re.IGNORECASE,
    )

    SENSITIVE_KEYS = {
        "api_key", "api-key", "apikey",
        "secret", "secret_key", "secret-key",
        "token", "access_token", "bearer",
        "password", "passwd",
        "authorization",
    }

    def __init__(self, known_keys: Optional[List[str]] = None):
        self._known_keys = known_keys or []

    @classmethod
    def sanitize(cls, message: str, known_keys: List[str] = None) -> str:
        """Mask sensitive data in a log message.

        * Replaces known API key patterns (sk-..., gsk_...).
        * Replaces literal key values if ``known_keys`` is provided.
        * Replaces generic ``api_key: value`` / ``Authorization: Bearer ...``.
        """
        # Run the generic key-pattern sanitizer first
        message = sanitize_text(message, known_keys=known_keys)

        # Run the generic header/token patterns
        message = cls.API_KEY_PATTERN.sub(r'\1: "***"', message)
        message = cls.AUTHORIZATION_PATTERN.sub(r'\1 ***', message)
        return message

    @classmethod
    def sanitize_context(
        cls,
        context: Any,
        known_keys: Optional[List[str]] = None,
    ) -> Any:
        """Recursively sanitize a context dict/list, masking sensitive values.

        * Scalar strings are sanitized via ``sanitize()``.
        * Dict keys whose name matches a sensitive pattern have their
          values replaced with ``"***"``.
        * Nested dicts/lists are processed recursively.
        * Everything else is returned unchanged.
        """
        known_keys = known_keys or []

        if isinstance(context, dict):
            return {
                k: cls._sanitize_context_value(k, v, known_keys)
                for k, v in context.items()
            }
        if isinstance(context, list):
            return [cls.sanitize_context(item, known_keys) for item in context]
        if isinstance(context, str):
            return cls.sanitize(context, known_keys=known_keys)
        return context

    @classmethod
    def _sanitize_context_value(
        cls,
        key: str,
        value: Any,
        known_keys: List[str],
    ) -> Any:
        """Sanitize a single context value, checking the key name."""
        # If the key itself is sensitive, mask the value entirely
        key_lower = key.lower().replace("-", "_").replace(" ", "_")
        if key_lower in cls.SENSITIVE_KEYS:
            return "***"

        # Recurse for nested structures
        if isinstance(value, dict):
            return cls.sanitize_context(value, known_keys)
        if isinstance(value, list):
            return [cls.sanitize_context(item, known_keys) for item in value]
        if isinstance(value, str):
            return cls.sanitize(value, known_keys=known_keys)
        return value

    @classmethod
    def sanitize_entry_message(cls, message: str, known_keys: Optional[List[str]] = None) -> str:
        """Alias for ``sanitize()``."""
        return cls.sanitize(message, known_keys=known_keys)
