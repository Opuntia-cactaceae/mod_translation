import re
from typing import Dict
from ..domain.entities import ProtectedText

#что не ждали, а вот они слева направо
TOKEN_PATTERNS = [
    r"\$[A-Za-z0-9_]+\$",                 # $VAR$
    r"\[.+?\]",                           # [Root.GetName]
    r"£[A-Za-z0-9_]+£",                   # £food£
    r"§[A-Za-z0-9]|\§!",                  # §Y ... §!
    r"§[A-Za-z0-9](?:.|[\r\n])*?§!",      # секции §Y...§!
    r"\{[A-Za-z0-9_.:-]+\}",              # {VALUE}
    r"%(?:\d+\$)?[sd]",                   # printf
    r"\\n",                               # явные переносы
]

TOKEN_REGEX = re.compile("|".join(f"({p})" for p in TOKEN_PATTERNS), re.DOTALL)


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