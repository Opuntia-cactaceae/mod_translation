from typing import Dict
from ..domain.entities import ProtectedText

#не маскировать теги
def protect_without_changes(text: str) -> ProtectedText:
    """
    Args:
        text: Original text.

    Returns:
        ProtectedText with identical original and protected text.
    """
    return ProtectedText(
        original_text=text,
        protected_text=text,
        protection_state={},
    )


def restore_without_changes(protected_text: str, protection_state: Dict[str, object]) -> str:
    """
    Args:
        protected_text: Text after LLM.
        protection_state: Ignored.

    Returns:
        Same protected_text.
    """
    return protected_text


class NoProtectionStrategy:
    def protect(self, text: str) -> ProtectedText:
        return protect_without_changes(text)

    def restore(self, protected_text: str, protection_state: Dict[str, object]) -> str:
        return restore_without_changes(protected_text, protection_state)


def build_no_protection_strategy() -> NoProtectionStrategy:
    return NoProtectionStrategy()