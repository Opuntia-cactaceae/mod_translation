"""Thin compatibility wrapper around the canonical game_token_utils module.

This adapter exists only to preserve the ``legacy_protect_tokens`` /
``legacy_restore_tokens`` public API for existing callers.  No path hacks,
no optional imports, no external repository dependencies.

New code should import directly from
``translator_benchmark.protection.game_token_utils``.
"""

from typing import Dict, Tuple

from translator_benchmark.protection.game_token_utils import (
    protect_tokens as legacy_protect_tokens,
    restore_tokens as legacy_restore_tokens,
)

__all__ = [
    "legacy_protect_tokens",
    "legacy_restore_tokens",
]
