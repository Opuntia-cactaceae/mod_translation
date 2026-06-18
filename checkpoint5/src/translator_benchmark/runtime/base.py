from typing import Protocol, List, Dict
from ..domain.results import RuntimeCallResult


class ModelRuntime(Protocol):
    def translate_batch(self, messages: List[Dict[str, str]]) -> RuntimeCallResult:
        """
        Args:
            messages: Chat API messages.

        Returns:
            RuntimeCallResult.
        """
        ...

    def translate_single(self, messages: List[Dict[str, str]]) -> RuntimeCallResult:
        """
        Args:
            messages: Chat API messages.

        Returns:
            RuntimeCallResult.
        """
        ...