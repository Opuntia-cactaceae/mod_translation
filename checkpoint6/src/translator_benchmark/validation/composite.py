from typing import List, Dict, Any
from .base import ResponseValidator
from .json_parse import parse_json_array_response, check_batch_length
from .repair import normalize_single_translation, strip_markdown_code_fences
from ..domain.results import ValidationResult
from ..domain.enums import ValidationStatus

#проверяем батч ответ на целостность и формат
class CompositeValidator(ResponseValidator):

    def __init__(self, options: Dict[str, Any]):
        self.options = options
        self.allow_fallback_on_json_error = options.get("allow_fallback_on_json_error", True)

    def validate_batch_response(self, raw_response: str, protected_texts: List[str]) -> ValidationResult:
        repair_actions = []
        errors = []
        expected_count = len(protected_texts)

        cleaned = strip_markdown_code_fences(raw_response)
        if cleaned != raw_response:
            repair_actions.append("stripped_code_fences")

        items, parse_errors = parse_json_array_response(cleaned)
        errors.extend(parse_errors)

        if items is None:
            status = ValidationStatus.FALLBACK_REQUIRED if self.allow_fallback_on_json_error else ValidationStatus.INVALID
            return ValidationResult(
                status=status,
                parsed_items=None,
                errors=errors,
                repair_actions=repair_actions,
                should_retry=False,
                should_fallback_to_single=self.allow_fallback_on_json_error,
            )

        length_errors = check_batch_length(items, expected_count)
        errors.extend(length_errors)

        if length_errors:
            return ValidationResult(
                status=ValidationStatus.FALLBACK_REQUIRED,
                parsed_items=items,
                errors=errors,
                repair_actions=repair_actions,
                should_retry=False,
                should_fallback_to_single=True,
            )

        return ValidationResult(
            status=ValidationStatus.VALID,
            parsed_items=items,
            errors=errors,
            repair_actions=repair_actions,
            should_retry=False,
            should_fallback_to_single=False,
        )

    def validate_single_response(self, raw_response: str, protected_text: str) -> ValidationResult:
        repair_actions = []
        errors = []

        cleaned = strip_markdown_code_fences(raw_response)
        if cleaned != raw_response:
            repair_actions.append("stripped_code_fences")

        normalized = normalize_single_translation(cleaned)
        # For single response, we accept any non-empty string
        if not normalized:
            errors.append("Empty translation")
            return ValidationResult(
                status=ValidationStatus.INVALID,
                parsed_items=None,
                errors=errors,
                repair_actions=repair_actions,
                should_retry=False,
                should_fallback_to_single=False,
            )

        return ValidationResult(
            status=ValidationStatus.VALID,
            parsed_items=[normalized],
            errors=errors,
            repair_actions=repair_actions,
            should_retry=False,
            should_fallback_to_single=False,
        )


def build_composite_validator(options: Dict[str, Any]) -> CompositeValidator:
    return CompositeValidator(options)