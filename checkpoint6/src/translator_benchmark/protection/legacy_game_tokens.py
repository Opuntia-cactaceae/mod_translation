from typing import Dict

from ..domain.entities import ProtectedText
from .game_token_utils import protect_tokens as _protect_tokens, restore_tokens as _restore_tokens


def protect_with_legacy_tokens(text: str) -> ProtectedText:
    """Replace game tokens with ``<PH id="k{N}"/>`` placeholders.

    Args:
        text: Original text.

    Returns:
        ProtectedText with protected text and mapping state.
    """
    protected_text, mapping = _protect_tokens(text)
    return ProtectedText(
        original_text=text,
        protected_text=protected_text,
        protection_state={"mapping": mapping},
    )


def restore_with_legacy_tokens(protected_text: str, protection_state: Dict[str, object]) -> str:
    """Restore ``<PH id="k{N}"/>`` placeholders to original tokens.

    Args:
        protected_text: Text after LLM.
        protection_state: Protection state containing mapping.

    Returns:
        Restored text.
    """
    mapping = protection_state.get("mapping", {})
    str_mapping = {k: str(v) for k, v in mapping.items()}
    return _restore_tokens(protected_text, str_mapping)


class LegacyGameTokensProtectionStrategy:
    def protect(self, text: str) -> ProtectedText:
        return protect_with_legacy_tokens(text)

    def restore(self, protected_text: str, protection_state: Dict[str, object]) -> str:
        return restore_with_legacy_tokens(protected_text, protection_state)


def build_legacy_game_tokens_strategy() -> LegacyGameTokensProtectionStrategy:
    return LegacyGameTokensProtectionStrategy()
