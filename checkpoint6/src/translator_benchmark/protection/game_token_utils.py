"""Canonical game token protection implementation.

Replaces game-specific token patterns with ``<PH id="k{N}"/>`` placeholders
so that LLMs can translate the surrounding text without corrupting tokens.

Supports the same token patterns as the original checkpoint3
``token_utils.py``, now self-contained inside checkpoint6.

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
from typing import Dict, Tuple

TOKEN_PATTERNS = [
    r"\$[A-Za-z0-9_]+\$",                 # $VAR$
    r"\[.+?\]",                            # [Root.GetName]
    r"£[A-Za-z0-9_]+£",                    # £food£
    r"§[A-Za-z0-9]|\§!",                   # §Y … §!
    r"§[A-Za-z0-9](?:.|[\r\n])*?§!",       # секции §Y…§!
    r"\{[A-Za-z0-9_.:-]+\}",               # {VALUE}
    r"%(?:\d+\$)?[sd]",                    # printf
    r"\\n",                                 # явные переносы
]

TOKEN_REGEX = re.compile("|".join(f"({p})" for p in TOKEN_PATTERNS), re.DOTALL)


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
