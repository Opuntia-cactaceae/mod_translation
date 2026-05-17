from typing import Protocol, List
from ..domain.results import ValidationResult


class ResponseValidator(Protocol):
    """Protocol for response validators."""

    def validate_batch_response(self, raw_response: str, protected_texts: List[str]) -> ValidationResult:
        """
        Args:
            raw_response: Raw response text from LLM.
            protected_texts: List of protected source texts.

        Returns:
            ValidationResult.
        """
        ...

    def validate_single_response(self, raw_response: str, protected_text: str) -> ValidationResult:
        """
        Args:
            raw_response: Raw response text from LLM.
            protected_text: Protected source text.

        Returns:
            ValidationResult.
        """
        ...