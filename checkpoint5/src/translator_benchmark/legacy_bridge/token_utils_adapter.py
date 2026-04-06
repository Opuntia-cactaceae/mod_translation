import sys
import os
from typing import Dict, Tuple


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
legacy_path = os.path.join(PROJECT_ROOT, '..', 'checkpoint3', 'llm_tranlator', 'translator_code')
if legacy_path not in sys.path:
    sys.path.insert(0, legacy_path)

try:
    from token_utils import protect_tokens, restore_tokens
    HAS_LEGACY_TOKEN_UTILS = True
except ImportError as e:
    HAS_LEGACY_TOKEN_UTILS = False
    def protect_tokens(text: str) -> Tuple[str, Dict[str, str]]:
        return text, {}
    def restore_tokens(text: str, mapping: Dict[str, str]) -> str:
        return text


def legacy_protect_tokens(text: str) -> Tuple[str, Dict[str, object]]:
    """
    обертка над заменятельем на плейсхолдеры

    Args:
        text: Original text.

    Returns:
        Tuple of (protected_text, mapping).
    """
    if not HAS_LEGACY_TOKEN_UTILS:
        return text, {}
    protected, mapping = protect_tokens(text)
    return protected, mapping


def legacy_restore_tokens(text: str, mapping: Dict[str, object]) -> str:
    """
    обертка над токенвозвращательинатор

    Args:
        text: Text with placeholders.
        mapping: Mapping from placeholder IDs to original tokens.

    Returns:
        Restored text.
    """
    if not HAS_LEGACY_TOKEN_UTILS:
        return text
    str_mapping = {k: str(v) for k, v in mapping.items()}
    return restore_tokens(text, str_mapping)