"""Canonical game token protection implementation.

Replaces game-specific token patterns with ``<PH id="k{N}"/>`` placeholders
so that LLMs can translate the surrounding text without corrupting tokens.

The token patterns are derived from ``BUILTIN_RULES_DATA`` in
``translator_app.protection.builtin_rules`` — the single source of truth.
No hardcoded regex patterns are defined in this module.

Supported patterns:

  * ``$VAR$``, ``$rare_crystals$`` — dollar variables
  * ``[Root.GetName]`` — script tags
  * ``£rare_crystals£`` — pound icons
  * ``§Y``, ``§G``, ``§P``, ``§!`` — colour/style tokens
  * ``§Y ... §!`` — coloured sections
  * ``{VALUE}``, ``{key.name}`` — curly-brace placeholders
  * ``%d``, ``%s``, ``%1$s`` — printf tokens
  * ``\\n`` — literal newlines
"""

import re
from typing import Dict, List, Tuple

from translator_app.protection.builtin_rules import BUILTIN_RULES_DATA
from translator_app.protection.engine import (
    PlaceholderLeakInfo,
    register_strategy_detector,
)

# Combined regex built from the canonical builtin rules (single source of truth)
TOKEN_REGEX = re.compile(
    "|".join(f"({rule['pattern']})" for rule in BUILTIN_RULES_DATA),
    re.DOTALL,
)


def protect_tokens(text: str) -> Tuple[str, Dict[str, str]]:
    """Replace known game token patterns with ``<PH id="k{N}"/>`` placeholders.

    Args:
        text: Original source text containing game tokens.

    Returns:
        ``(protected_text, mapping)`` where *mapping* maps placeholder keys
        (e.g. ``"k0"``) to their original token values.
    """
    mapping: Dict[str, str] = {}
    idx = 0

    def _replacer(m: re.Match) -> str:
        nonlocal idx
        original = m.group(0)
        key = f"k{idx}"
        idx += 1
        mapping[key] = original
        return f'<PH id="{key}"/>'

    protected = re.sub(TOKEN_REGEX, _replacer, text)
    return protected, mapping


def restore_tokens(text: str, mapping: Dict[str, str]) -> str:
    """Restore ``<PH id="k{N}"/>`` placeholders back to original tokens.

    The regex is intentionally flexible to handle HTML entities, zero-width
    spaces, varied quoting styles, and other common LLM output corruptions.

    Args:
        text: Text (possibly after LLM translation) containing ``<PH …/>`` tags.
        mapping: Mapping from placeholder keys to original token values.

    Returns:
        Text with all recognised placeholders replaced by their original tokens.
    """
    pattern = r"""
        (?ix)
        (?:<|&lt;)
        [\s\u200B\uFEFF]*
        ph\b
        [^>]*?
        \bid\s*=\s*
        (?:\\{0,2}["'“”‘’])?
        (k\d+)
        (?:\\{0,2}["'“”‘’])?
        [^>]*?
        /?
        [\s\u200B\uFEFF]*
        (?:>|&gt;)
    """
    regex = re.compile(pattern, re.IGNORECASE | re.VERBOSE | re.DOTALL)
    return regex.sub(lambda m: mapping.get(m.group(1), m.group(0)), text)


# ---------------------------------------------------------------------------
# Strategy-aware leak detection for "legacy_game_tokens"
# ---------------------------------------------------------------------------

_LEGACY_PH_RE = re.compile(r'<PH\s+id="k(\d+)"\s*/>')


def detect_legacy_game_tokens_leaks(
    text: str,
    mapping: Dict[str, str],
) -> List[PlaceholderLeakInfo]:
    """Detect unrestored ``<PH id="k{N}"/>`` placeholders.

    This is the detector for the benchmark ``"legacy_game_tokens"``
    protection strategy.  Scans *text* for ``<PH id="k{N}"/>`` tags
    whose IDs are missing from the restore *mapping*.
    """
    leaks: List[PlaceholderLeakInfo] = []
    for m in _LEGACY_PH_RE.finditer(text):
        ph_id = f"k{m.group(1)}"
        if ph_id not in mapping:
            leaks.append(PlaceholderLeakInfo(
                placeholder_id=ph_id,
                raw_match=m.group(0),
                strategy_name="legacy_game_tokens",
                mapping_size=len(mapping),
            ))
    return leaks


# Register with the engine's dispatch table
register_strategy_detector("legacy_game_tokens", detect_legacy_game_tokens_leaks)
