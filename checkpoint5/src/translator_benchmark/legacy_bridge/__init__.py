"""
Legacy bridge module for integrating old translator code.
"""

from .token_utils_adapter import legacy_protect_tokens, legacy_restore_tokens
from .calc_metric_adapter import (
    legacy_compute_scores,
    legacy_check_compilability,
    legacy_get_tag_summary,
)

__all__ = [
    "legacy_protect_tokens",
    "legacy_restore_tokens",
    "legacy_compute_scores",
    "legacy_check_compilability",
    "legacy_get_tag_summary",
]