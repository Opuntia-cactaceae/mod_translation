# localization_translator/token_utils.py
import re
from typing import Dict, Tuple


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


def protect_tokens(text: str) -> Tuple[str, Dict[str, str]]:
    mapping: Dict[str, str] = {}
    idx = 0

    def repl(m):
        nonlocal idx
        original = m.group(0)
        key = f"k{idx}"
        idx += 1
        mapping[key] = original
        return f"<PH id=\"{key}\"/>"

    protected = re.sub(TOKEN_REGEX, repl, text)
    return protected, mapping


def restore_tokens(text: str, mapping: Dict[str, str]) -> str:
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