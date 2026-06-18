import re
from typing import List

PLACEHOLDER_PATTERNS = [
    r"\$[A-Za-z0-9_]+\$",                 # $VAR$
    r"\[.+?\]",                            # [Root.GetName]
    r"£[A-Za-z0-9_]+£",                    # £food£
    r"§[A-Za-z0-9]|\§!",                   # §Y ... §!
    r"%\d*[sd]",                           # printf
    r"<protected[^>]*/>",                  # <protected id="xml0"/>
    r'<PH\s+id="[^"]+"/>',                 # <PH id="k0"/>
]


def extract_placeholders(text: str) -> List[str]:
    """
    Args:
        text: Text possibly containing placeholders.

    Returns:
        List of placeholder strings found in text.
    """
    found: List[str] = []
    for pattern in PLACEHOLDER_PATTERNS:
        matches = re.findall(pattern, text)
        found.extend(matches)
    return found


def compare_placeholders(source_text: str, candidate_text: str) -> List[str]:
    """
    Compare placeholders in source vs candidate translation.

    Args:
        source_text: Source text with placeholders.
        candidate_text: Candidate translation.

    Returns:
        List of lost placeholder strings (present in source but missing in candidate).
    """
    source_placeholders = set(extract_placeholders(source_text))
    candidate_placeholders = set(extract_placeholders(candidate_text))
    lost = source_placeholders - candidate_placeholders
    return sorted(lost)
