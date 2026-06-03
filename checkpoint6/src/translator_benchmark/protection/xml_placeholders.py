"""XML-style placeholder protection strategy.

Replaces game tokens with ``<protected id="xml{N}"/>`` placeholders.
Patterns are derived from ``BUILTIN_RULES_DATA`` (single source of truth).
No hardcoded regex patterns are defined in this module.
"""

import re
from typing import Dict, List

from translator_app.protection.builtin_rules import BUILTIN_RULES_DATA
from translator_app.protection.engine import (
    PlaceholderLeakInfo,
    register_strategy_detector,
)
from ..domain.entities import ProtectedText

# Combined regex built from the canonical builtin rules
TOKEN_REGEX = re.compile(
    "|".join(f"({rule['pattern']})" for rule in BUILTIN_RULES_DATA),
    re.DOTALL,
)


def protect_with_xml_placeholders(text: str) -> ProtectedText:
    """
    Args:
        text: Original text.

    Returns:
        ProtectedText with protected text and mapping state.
    """
    mapping: Dict[str, str] = {}
    idx = 0

    def repl(m):
        nonlocal idx
        original = m.group(0)
        key = f"xml{idx}"
        idx += 1
        mapping[key] = original
        return f"<protected id=\"{key}\"/>"

    protected_text = re.sub(TOKEN_REGEX, repl, text)
    return ProtectedText(
        original_text=text,
        protected_text=protected_text,
        protection_state={"mapping": mapping},
    )


def restore_from_xml_placeholders(protected_text: str, protection_state: Dict[str, object]) -> str:
    """
    Args:
        protected_text: Text after LLM.
        protection_state: Protection state containing mapping.

    Returns:
        Restored text.
    """
    mapping = protection_state.get("mapping", {})
    pattern = r"""
        (?ix)
        (?:<|&lt;)
        [\s\u200B\uFEFF]*
        protected\b
        [^>]*?
        \bid\s*=\s*
        (?:\\{0,2}["'“”‘’])?
        (xml\d+)
        (?:\\{0,2}["'“”‘’])?
        [^>]*?
        /?
        [\s\u200B\uFEFF]*
        (?:>|&gt;)
    """
    regex = re.compile(pattern, re.IGNORECASE | re.VERBOSE | re.DOTALL)
    restored = regex.sub(lambda m: mapping.get(m.group(1), m.group(0)), protected_text)
    return restored


class XmlPlaceholdersProtectionStrategy:

    def protect(self, text: str) -> ProtectedText:
        return protect_with_xml_placeholders(text)

    def restore(self, protected_text: str, protection_state: Dict[str, object]) -> str:
        return restore_from_xml_placeholders(protected_text, protection_state)


def build_xml_placeholders_strategy() -> XmlPlaceholdersProtectionStrategy:
    return XmlPlaceholdersProtectionStrategy()


# ---------------------------------------------------------------------------
# Strategy-aware leak detection for "xml_placeholders"
# ---------------------------------------------------------------------------

_XML_PH_RE = re.compile(r'<protected\s+id="xml(\d+)"\s*/>')


def detect_xml_placeholders_leaks(
    text: str,
    mapping: Dict[str, str],
) -> List[PlaceholderLeakInfo]:
    """Detect unrestored ``<protected id="xml{N}"/>`` placeholders.

    This is the detector for the benchmark ``"xml_placeholders"``
    protection strategy.  Scans *text* for ``<protected id="xml{N}"/>``
    tags whose IDs are missing from the restore *mapping*.
    """
    leaks: List[PlaceholderLeakInfo] = []
    for m in _XML_PH_RE.finditer(text):
        ph_id = f"xml{m.group(1)}"
        if ph_id not in mapping:
            leaks.append(PlaceholderLeakInfo(
                placeholder_id=ph_id,
                raw_match=m.group(0),
                strategy_name="xml_placeholders",
                mapping_size=len(mapping),
            ))
    return leaks


# Register with the engine's dispatch table
register_strategy_detector("xml_placeholders", detect_xml_placeholders_leaks)