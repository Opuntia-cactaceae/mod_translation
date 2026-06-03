"""Translation Validator — delegates to benchmark validators and rule-set protection.

Performs:
    * JSON array parsing and length check (composite validator)
    * Placeholder/token preservation check via ``ProtectionEngine``
    * Generic non-empty validation as fallback

The placeholder preservation check works through **protection state** (the
``<PH id="r{N}"/>`` placeholders in the text).  No hardcoded regex patterns
are used — all protection patterns live in rule sets.
"""

from typing import List, Optional, Dict, Any

from translator_app.diagnostics.models import ValidationResult, Diagnostic, DiagnosticLevel
from translator_app.protection.engine import PROTECTED_PH_RE, PLACEHOLDER_RE
from translator_benchmark.validation.validation_registry import get_response_validator
from translator_benchmark.config.schema import ValidationConfig as BenchmarkValidationConfig


class TranslationValidator:
    """Validates translation output by delegating to benchmark validators.

    Performs:
        * JSON array parsing and length check (composite validator)
        * Placeholder/token preservation check (via ``<PH id="r{N}"/>`` tags)
        * Generic non-empty validation as fallback
    """

    def __init__(self, validator_name: str = "composite", options: Optional[Dict[str, Any]] = None):
        self._validator_name = validator_name
        self._options = options or {}
        self._benchmark_validator = None
        if validator_name and validator_name != "none":
            try:
                self._benchmark_validator = get_response_validator(
                    BenchmarkValidationConfig(
                        validator_name=validator_name,
                        options=self._options,
                    )
                )
            except KeyError:
                pass  # fall back to basic validation

    def validate_translation(
        self,
        source: str,
        target: str,
        expected_count: int = 1,
    ) -> ValidationResult:
        """Check that a translation is valid.

        Args:
            source: Original source text (or newline-joined texts for batch).
            target: Translated text (raw LLM response for batch).
            expected_count: Expected number of items (1 for single, >1 for batch).

        Returns:
            ValidationResult with ``is_valid`` flag and diagnostics.
        """
        result = ValidationResult(is_valid=True)

        # 1. Basic non-empty check
        if not target or not target.strip():
            result.is_valid = False
            result.add_diagnostic(Diagnostic(
                level=DiagnosticLevel.ERROR,
                message="Translation is empty",
                code="EMPTY_TRANSLATION",
            ))
            return result

        # 2. Empty source → accept anything
        if not source or not source.strip():
            return result

        # 3. Placeholder preservation check (rule-set-based)
        #    Count protected placeholders in source vs target
        source_ph_count = len(PROTECTED_PH_RE.findall(source))
        target_ph_count = len(PROTECTED_PH_RE.findall(target))

        if source_ph_count > 0:
            if target_ph_count < source_ph_count:
                result.is_valid = False
                result.add_diagnostic(Diagnostic(
                    level=DiagnosticLevel.ERROR,
                    message=f"Lost {source_ph_count - target_ph_count} protected placeholder(s) "
                            f"(source had {source_ph_count}, target has {target_ph_count})",
                    code="PLACEHOLDER_LOST",
                ))

            # Check for mutated placeholder IDs (missing IDs that were in source)
            source_ids = set(PLACEHOLDER_RE.findall(source))
            target_ids = set(PLACEHOLDER_RE.findall(target))
            lost_ids = source_ids - target_ids
            for ph_id in sorted(lost_ids):
                result.is_valid = False
                result.add_diagnostic(Diagnostic(
                    level=DiagnosticLevel.ERROR,
                    message=f"Lost protected placeholder: <PH id=\"{ph_id}\"/>",
                    code="PLACEHOLDER_LOST",
                ))

        # NOTE: PLACEHOLDER_LEAKED detection has been moved to the adapter
        # layer (_detect_and_handle_restore_leaks in core_adapter.py) where
        # it is strategy-aware and can fail the unit properly.  A global
        # regex-based check here would be wrong because it does not know
        # whether protection is enabled or which strategy is active.

        # 4. Benchmark validator check (JSON parsing, etc.)
        if self._benchmark_validator is not None:
            # For batch validation, target is the raw LLM response
            protected_texts = source.split("\n") if expected_count > 1 else [source]
            if expected_count > 1:
                bv_result = self._benchmark_validator.validate_batch_response(
                    target, protected_texts
                )
            else:
                bv_result = self._benchmark_validator.validate_single_response(
                    target, source
                )

            if bv_result.errors:
                result.is_valid = False
                for err in bv_result.errors:
                    result.add_diagnostic(Diagnostic(
                        level=DiagnosticLevel.ERROR,
                        message=str(err),
                        code="VALIDATION_FAILED",
                    ))

        return result


def validate_translation(
    source: str,
    target: str,
    validator_name: str = "composite",
    options: Optional[Dict[str, Any]] = None,
    expected_count: int = 1,
) -> ValidationResult:
    """Convenience function for one-shot validation."""
    validator = TranslationValidator(validator_name=validator_name, options=options)
    return validator.validate_translation(source, target, expected_count)
