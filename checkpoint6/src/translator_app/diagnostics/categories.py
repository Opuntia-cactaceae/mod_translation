"""Runtime error categories for human-readable diagnostics.

Maps raw exceptions and error strings to standardised categories
with user-friendly messages, badge labels, and colours.
"""

from __future__ import annotations

from enum import Enum
from typing import Dict, Optional, Tuple


class RuntimeErrorCategory(str, Enum):
    """Human-readable categories for translation runtime failures."""

    RATE_LIMIT = "rate_limit"
    AUTH_ERROR = "auth_error"
    NETWORK_ERROR = "network_error"
    TIMEOUT = "timeout"
    JSON_PARSE_ERROR = "json_parse_error"
    VALIDATION_ERROR = "validation_error"
    EMPTY_RESPONSE = "empty_response"
    MODEL_OVERLOADED = "model_overloaded"
    COUNT_MISMATCH = "count_mismatch"
    PROVIDER_ERROR = "provider_error"
    UNKNOWN = "unknown"

    @property
    def label(self) -> str:
        return _CATEGORY_META[self]["label"]

    @property
    def description(self) -> str:
        return _CATEGORY_META[self]["description"]

    @property
    def badge_class(self) -> str:
        return _CATEGORY_META[self]["badge"]

    @property
    def icon(self) -> str:
        return _CATEGORY_META[self]["icon"]


_CATEGORY_META: Dict[RuntimeErrorCategory, Dict[str, str]] = {
    RuntimeErrorCategory.RATE_LIMIT: {
        "label": "Rate limit reached",
        "description": "The provider temporarily rejected requests. "
                       "The job can usually be resumed later.",
        "badge": "badge-warning",
        "icon": "⟳",
    },
    RuntimeErrorCategory.AUTH_ERROR: {
        "label": "Authentication error",
        "description": "The API key is missing, invalid, or expired. "
                       "Check your API keys in Settings.",
        "badge": "badge-error",
        "icon": "🔑",
    },
    RuntimeErrorCategory.NETWORK_ERROR: {
        "label": "Network error",
        "description": "A connection error occurred. "
                       "Check your internet connection and provider status.",
        "badge": "badge-error",
        "icon": "🌐",
    },
    RuntimeErrorCategory.TIMEOUT: {
        "label": "Request timed out",
        "description": "The provider took too long to respond. "
                       "The job can be retried.",
        "badge": "badge-warning",
        "icon": "⏱",
    },
    RuntimeErrorCategory.JSON_PARSE_ERROR: {
        "label": "Response parse error",
        "description": "The provider returned an unexpected response format. "
                       "The job will retry or fall back to single-mode translation.",
        "badge": "badge-warning",
        "icon": "📄",
    },
    RuntimeErrorCategory.VALIDATION_ERROR: {
        "label": "Validation error",
        "description": "The translated output did not pass validation checks. "
                       "The affected units have been marked as failed.",
        "badge": "badge-error",
        "icon": "✓",
    },
    RuntimeErrorCategory.EMPTY_RESPONSE: {
        "label": "Empty response",
        "description": "The provider returned an empty response. "
                       "The unit will be retried.",
        "badge": "badge-warning",
        "icon": "∅",
    },
    RuntimeErrorCategory.MODEL_OVERLOADED: {
        "label": "Model overloaded",
        "description": "The model is currently overloaded or unavailable. "
                       "Try a different model or provider.",
        "badge": "badge-warning",
        "icon": "⚡",
    },
    RuntimeErrorCategory.COUNT_MISMATCH: {
        "label": "Translation count mismatch",
        "description": "The provider returned a different number of translations "
                       "than expected. Falling back to single-mode translation.",
        "badge": "badge-warning",
        "icon": "≠",
    },
    RuntimeErrorCategory.PROVIDER_ERROR: {
        "label": "Provider error",
        "description": "The translation provider returned an error. "
                       "Check the provider status and configuration.",
        "badge": "badge-error",
        "icon": "⚙",
    },
    RuntimeErrorCategory.UNKNOWN: {
        "label": "Unknown error",
        "description": "An unexpected error occurred. "
                       "Check the trace events for details.",
        "badge": "badge-error",
        "icon": "?",
    },
}

# -- Keywords used for heuristic matching in error messages --
_CATEGORY_KEYWORDS: Dict[RuntimeErrorCategory, Tuple[str, ...]] = {
    RuntimeErrorCategory.RATE_LIMIT: (
        "rate limit", "rate_limit", "too many requests", "429",
        "resource exhausted", "quota exceeded",
    ),
    RuntimeErrorCategory.AUTH_ERROR: (
        "auth", "api key", "unauthorized", "forbidden", "401", "403",
        "invalid key", "permission denied", "not authenticated",
    ),
    RuntimeErrorCategory.NETWORK_ERROR: (
        "network", "connection", "dns", "econnrefused", "econnreset",
        "connection refused", "connection reset", "name or service not known",
        "socket", "proxy",
    ),
    RuntimeErrorCategory.TIMEOUT: (
        "timeout", "timed out", "time out",
    ),
    RuntimeErrorCategory.JSON_PARSE_ERROR: (
        "json", "parse", "decode", "expecting value", "unexpected token",
        "invalid character",
    ),
    RuntimeErrorCategory.EMPTY_RESPONSE: (
        "empty", "no response", "returned none", "empty response",
    ),
    RuntimeErrorCategory.MODEL_OVERLOADED: (
        "overloaded", "model not found", "model unavailable",
        "model capacity", "backoff",
    ),
    RuntimeErrorCategory.COUNT_MISMATCH: (
        "count mismatch", "expected", "got",
    ),
    RuntimeErrorCategory.VALIDATION_ERROR: (
        "validation", "invalid", "malformed",
    ),
}


def categorise_error(error_message: str, exception_type: Optional[str] = None) -> RuntimeErrorCategory:
    """Map an error message and optional exception type to a category.

    Uses heuristic keyword matching.  Falls back to ``UNKNOWN`` when
    no keywords match.
    """
    if not error_message:
        return RuntimeErrorCategory.UNKNOWN

    msg_lower = error_message.lower()

    for category, keywords in _CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in msg_lower:
                return category

    return RuntimeErrorCategory.UNKNOWN
