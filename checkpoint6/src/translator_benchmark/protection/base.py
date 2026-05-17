from typing import Protocol, Dict
from ..domain.entities import ProtectedText


class ProtectionStrategy(Protocol):
    def protect(self, text: str) -> ProtectedText:
        """
        Args:
            text: Original source text.

        Returns:
            ProtectedText object.
        """
        ...

    def restore(self, protected_text: str, protection_state: Dict[str, object]) -> str:
        """
        Args:
            protected_text: Text after LLM (may contain placeholders).
            protection_state: State saved during protection.

        Returns:
            Restored text.
        """
        ...