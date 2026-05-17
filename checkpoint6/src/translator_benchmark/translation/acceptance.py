from typing import List, Optional, Dict, Any
from ..domain.entities import ProtectedText, AcceptedTranslation
from ..domain.results import RowProcessingResult, RuntimeCallResult, ValidationResult
from ..protection.base import ProtectionStrategy


def restore_protected_translation(
    protected_text: str,
    protection_state: Dict[str, object],
    protection_strategy: ProtectionStrategy,
) -> str:
    """
    восстанавливаем теги

    Args:
        protected_text: Translation text with placeholders.
        protection_state: State saved during protection.
        protection_strategy: Protection strategy instance.

    Returns:
        Restored translation.
    """
    return protection_strategy.restore(protected_text, protection_state)


def build_accepted_translation(
    row_id: str,
    protected_text: str,
    final_text: str,
    model_name: str,
    prompt_profile: str,
    protection_strategy: str,
    validator_name: str,
) -> AcceptedTranslation:
    """
    Args:
        row_id: Dataset row identifier.
        protected_text: Protected source text (with placeholders).
        final_text: Restored final translation.
        model_name: Name of the model used.
        prompt_profile: Name of the prompt profile used.
        protection_strategy: Name of the protection strategy used.
        validator_name: Name of the validator used.

    Returns:
        AcceptedTranslation.
    """
    return AcceptedTranslation(
        row_id=row_id,
        protected_text=protected_text,
        final_text=final_text,
        restored_text=final_text,
        model_name=model_name,
        prompt_profile=prompt_profile,
        protection_strategy=protection_strategy,
        validator_name=validator_name,
    )


def compute_row_result(
    row_id: str,
    protected_text_obj: ProtectedText,
    runtime_results: List[RuntimeCallResult],
    validation_result: ValidationResult,
    protection_strategy: ProtectionStrategy,
) -> RowProcessingResult:
    """
    Args:
        row_id: Dataset row identifier.
        protected_text_obj: Protected text object.
        runtime_results: List of runtime attempts (including retries).
        validation_result: Final validation result.
        protection_strategy: Protection strategy.

    Returns:
        RowProcessingResult.
    """
    accepted_translation = None
    error_message = None
    status = "pending"

    if validation_result.status.name == "VALID" and validation_result.parsed_items:
        translated_item = validation_result.parsed_items[0] if validation_result.parsed_items else ""
        if translated_item:
            restored = restore_protected_translation(
                translated_item,
                protected_text_obj.protection_state,
                protection_strategy,
            )
            model_name = ""
            if runtime_results:
                last_result = runtime_results[-1]
                model_name = last_result.used_model or ""
            protection_strategy_name = protection_strategy.__class__.__name__
            accepted_translation = build_accepted_translation(
                row_id=row_id,
                protected_text=protected_text_obj.protected_text,
                final_text=restored,
                model_name=model_name,
                prompt_profile="",  # TODO может оно и не надо..........
                protection_strategy=protection_strategy_name,
                validator_name="",  # TODO
            )
            status = "completed"
        else:
            error_message = "Empty translation after validation"
            status = "failed"
    elif validation_result.status.name == "INVALID":
        error_message = "; ".join(validation_result.errors) if validation_result.errors else "Validation failed"
        status = "failed"
    elif validation_result.status.name == "FALLBACK_REQUIRED":
        status = "pending_fallback"
    else:
        status = "pending"

    attempt_count = len(runtime_results)
    retry_count = sum(1 for r in runtime_results if r.retry_reason)
    repair_applied = any(r.repair_applied for r in runtime_results)
    fallback_used = any(r.fallback_triggered for r in runtime_results)
    total_input_tokens = sum(r.input_token_count or 0 for r in runtime_results)
    total_output_tokens = sum(r.output_token_count or 0 for r in runtime_results)
    total_tokens = sum(r.total_token_count or 0 for r in runtime_results)

    return RowProcessingResult(
        row_id=row_id,
        source_text=protected_text_obj.original_text,
        reference_text=protected_text_obj.reference_text,
        accepted_translation=accepted_translation,
        attempt_count=attempt_count,
        status=status,
        error_message=error_message,
        retry_count=retry_count,
        repair_applied=repair_applied,
        fallback_used=fallback_used,
        total_input_tokens=total_input_tokens if total_input_tokens > 0 else None,
        total_output_tokens=total_output_tokens if total_output_tokens > 0 else None,
        total_tokens=total_tokens if total_tokens > 0 else None,
    )