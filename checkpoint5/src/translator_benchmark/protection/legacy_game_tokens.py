from typing import Dict
from ..domain.entities import ProtectedText
from ..legacy_bridge.token_utils_adapter import legacy_protect_tokens, legacy_restore_tokens


def protect_with_legacy_tokens(text: str) -> ProtectedText:
    """
    Args:
        text: Original text.

    Returns:
        ProtectedText with protected text and mapping state.
    """
    protected_text, mapping = legacy_protect_tokens(text)
    return ProtectedText(
        original_text=text,
        protected_text=protected_text,
        protection_state={"mapping": mapping},
    )


def restore_with_legacy_tokens(protected_text: str, protection_state: Dict[str, object]) -> str:
    """
    Args:
        protected_text: Text after LLM.
        protection_state: Protection state containing mapping.

    Returns:
        Restored text.
    """
    mapping = protection_state.get("mapping", {})
    return legacy_restore_tokens(protected_text, mapping)


class LegacyGameTokensProtectionStrategy:
    def protect(self, text: str) -> ProtectedText:
        return protect_with_legacy_tokens(text)

    def restore(self, protected_text: str, protection_state: Dict[str, object]) -> str:
        return restore_with_legacy_tokens(protected_text, protection_state)


def build_legacy_game_tokens_strategy() -> LegacyGameTokensProtectionStrategy:
    return LegacyGameTokensProtectionStrategy()