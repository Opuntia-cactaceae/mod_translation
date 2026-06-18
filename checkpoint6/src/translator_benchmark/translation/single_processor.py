import json
import dataclasses
from typing import Tuple, Dict, Any, List
from ..runtime.base import ModelRuntime
from ..validation.base import ResponseValidator
from ..protection.base import ProtectionStrategy
from ..prompts.base import PromptProfile
from ..domain.results import RuntimeCallResult, ValidationResult, RowProcessingResult
from ..domain.enums import ValidationStatus
from ..domain.entities import ProtectedText
from .acceptance import compute_row_result


class SingleProcessor:

    def __init__(
        self,
        runtime: ModelRuntime,
        validator: ResponseValidator,
        protection_strategy: ProtectionStrategy,
        prompt_profile: PromptProfile,
        src_lang: str,
        dst_lang: str,
        experiment_id: str,
        db_path: str,
        max_retries: int = 3,
    ):
        self.runtime = runtime
        self.validator = validator
        self.protection_strategy = protection_strategy
        self.prompt_profile = prompt_profile
        self.src_lang = src_lang
        self.dst_lang = dst_lang
        self.experiment_id = experiment_id
        self.db_path = db_path
        self.max_retries = max_retries

    def process_single(
        self,
        row_id: str,
        protected_text: ProtectedText,
        is_fallback: bool = False,
    ) -> Tuple[RowProcessingResult, List[Dict[str, Any]]]:
        """
        Args:
            row_id: Row identifier.
            protected_text: Protected text object.
            is_fallback: Whether this single processing is triggered by batch fallback.

        Returns:
            Tuple of (RowProcessingResult, list of attempt dicts).
        """
        attempts = []
        max_retries = self.max_retries
        runtime_results = []

        for attempt_no in range(1, max_retries + 2):
            messages = self._build_single_messages(protected_text.protected_text)

            runtime_result = self.runtime.translate_single(messages)
            if is_fallback:
                runtime_result = dataclasses.replace(runtime_result, fallback_triggered=True)
            runtime_results.append(runtime_result)

            attempt_data = self._runtime_result_to_attempt(
                runtime_result, row_id, attempt_no, protected_text.protected_text
            )
            attempts.append(attempt_data)

            if not runtime_result.success:
                continue

            validation_result = self.validator.validate_single_response(
                runtime_result.raw_text or "", protected_text.protected_text
            )

            if validation_result.status.name == "VALID":
                row_result = compute_row_result(
                    row_id=row_id,
                    protected_text_obj=protected_text,
                    runtime_results=runtime_results,
                    validation_result=validation_result,
                    protection_strategy=self.protection_strategy,
                )
                return row_result, attempts
            else:
                break

        final_validation = ValidationResult(
            status=validation_result.status if 'validation_result' in locals() else ValidationStatus.INVALID,
            parsed_items=None,
            errors=validation_result.errors if 'validation_result' in locals() else ["All attempts failed"],
            repair_actions=[],
            should_retry=False,
            should_fallback_to_single=False,
        )
        row_result = compute_row_result(
            row_id=row_id,
            protected_text_obj=protected_text,
            runtime_results=runtime_results,
            validation_result=final_validation,
            protection_strategy=self.protection_strategy,
        )
        return row_result, attempts

    def _build_single_messages(self, protected_text: str) -> List[Dict[str, str]]:
        return self.prompt_profile.build_single_messages(
            text=protected_text,
            src_lang=self.src_lang,
            dst_lang=self.dst_lang,
        )

    def _runtime_result_to_attempt(
        self,
        runtime_result: RuntimeCallResult,
        row_id: str,
        attempt_no: int,
        protected_text: str,
    ) -> Dict[str, Any]:
        return {
            "row_id": row_id,
            "attempt_no": attempt_no,
            "request_kind": "single",
            "used_model": runtime_result.used_model,
            "used_key_index": runtime_result.used_key_index,
            "raw_request": json.dumps(protected_text),
            "raw_response": runtime_result.raw_text,
            "latency_ms": runtime_result.latency_ms,
            "status": "success" if runtime_result.success else "failed",
            "error_type": runtime_result.error_type,
            "error_message": runtime_result.error_message,
            "response_outcome_type": runtime_result.response_outcome_type.name if runtime_result.response_outcome_type else None,
            "retry_reason": runtime_result.retry_reason,
            "repair_applied": runtime_result.repair_applied,
            "fallback_triggered": runtime_result.fallback_triggered,
            "input_token_count": runtime_result.input_token_count,
            "output_token_count": runtime_result.output_token_count,
            "total_token_count": runtime_result.total_token_count,
        }