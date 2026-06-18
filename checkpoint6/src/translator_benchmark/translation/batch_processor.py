import json
from typing import List, Tuple, Dict, Any, Optional
from ..runtime.base import ModelRuntime
from ..validation.base import ResponseValidator
from ..protection.base import ProtectionStrategy
from ..prompts.base import PromptProfile
from ..domain.results import RuntimeCallResult, ValidationResult, RowProcessingResult
from ..domain.entities import ProtectedText
from ..domain.enums import ResponseOutcomeType
from .acceptance import compute_row_result


class BatchProcessor:

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

    def process_batch(
        self,
        row_ids: List[str],
        protected_texts: List[ProtectedText],
    ) -> Tuple[List[RowProcessingResult], List[Dict[str, Any]]]:
        """
        Args:
            row_ids: List of row identifiers.
            protected_texts: List of protected text objects.

        Returns:
            Tuple of (list of RowProcessingResult, list of attempt dicts for saving).
        """
        if len(row_ids) != len(protected_texts):
            raise ValueError("row_ids and protected_texts must have same length")

        attempts = []
        protected_strings = [pt.protected_text for pt in protected_texts]

        messages = self._build_batch_messages(protected_strings)

        runtime_result = self.runtime.translate_batch(messages)
        attempt_data = self._runtime_result_to_attempt(
            runtime_result, row_ids, "batch", protected_strings
        )
        attempts.append(attempt_data)

        validation_result = self.validator.validate_batch_response(
            runtime_result.raw_text or "", protected_strings
        )

        if validation_result.should_fallback_to_single:
            attempts[-1]["fallback_triggered"] = True
            attempts[-1]["response_outcome_type"] = ResponseOutcomeType.FALLBACK_TO_SINGLE.name
            return self._fallback_to_single(row_ids, protected_texts, attempts)

        if validation_result.status.name != "VALID":
            results = []
            for row_id, pt in zip(row_ids, protected_texts):
                row_runtime_results = [runtime_result]
                row_result = compute_row_result(
                    row_id=row_id,
                    protected_text_obj=pt,
                    runtime_results=row_runtime_results,
                    validation_result=validation_result,
                    protection_strategy=self.protection_strategy,
                )
                results.append(row_result)
            return results, attempts

        parsed_items = validation_result.parsed_items or []
        results = []
        for idx, (row_id, pt) in enumerate(zip(row_ids, protected_texts)):
            item_validation = ValidationResult(
                status=validation_result.status,
                parsed_items=[parsed_items[idx]] if idx < len(parsed_items) else [],
                errors=validation_result.errors,
                repair_actions=validation_result.repair_actions,
                should_retry=False,
                should_fallback_to_single=False,
            )
            row_runtime_results = [runtime_result]
            row_result = compute_row_result(
                row_id=row_id,
                protected_text_obj=pt,
                runtime_results=row_runtime_results,
                validation_result=item_validation,
                protection_strategy=self.protection_strategy,
            )
            results.append(row_result)

        return results, attempts

    def _build_batch_messages(self, protected_texts: List[str]) -> List[Dict[str, str]]:
        return self.prompt_profile.build_batch_messages(
            texts=protected_texts,
            src_lang=self.src_lang,
            dst_lang=self.dst_lang,
        )

    def _runtime_result_to_attempt(
        self,
        runtime_result: RuntimeCallResult,
        row_ids: List[str],
        request_kind: str,
        protected_texts: List[str],
    ) -> Dict[str, Any]:
        return {
            "row_ids": row_ids,
            "attempt_no": runtime_result.attempt_no
            if hasattr(runtime_result, 'attempt_no') and runtime_result.attempt_no is not None
            else (runtime_result.retry_count + 1
                  if hasattr(runtime_result, 'retry_count') and runtime_result.retry_count is not None
                  else 1),
            "request_kind": request_kind,
            "used_model": runtime_result.used_model,
            "used_key_index": runtime_result.used_key_index,
            "raw_request": json.dumps(protected_texts),
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

    def _fallback_to_single(
        self,
        row_ids: List[str],
        protected_texts: List[ProtectedText],
        previous_attempts: List[Dict[str, Any]],
    ) -> Tuple[List[RowProcessingResult], List[Dict[str, Any]]]:
        from .single_processor import SingleProcessor

        single_processor = SingleProcessor(
            runtime=self.runtime,
            validator=self.validator,
            protection_strategy=self.protection_strategy,
            prompt_profile=self.prompt_profile,
            src_lang=self.src_lang,
            dst_lang=self.dst_lang,
            experiment_id=self.experiment_id,
            db_path=self.db_path,
            max_retries=self.max_retries,
        )

        all_results = []
        all_attempts = previous_attempts.copy()

        for row_id, pt in zip(row_ids, protected_texts):
            row_result, row_attempts = single_processor.process_single(row_id, pt, is_fallback=True)
            all_results.append(row_result)
            all_attempts.extend(row_attempts)

        return all_results, all_attempts