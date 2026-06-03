"""RealRuntime — real LLM translation runtime backed by translator_benchmark.

Bridges the adapter-level interface (``translate_batch(texts) -> list[str]``,
``translate_single(text) -> str``) with the benchmark ``ModelRuntime`` protocol
which operates on chat-format messages and returns ``RuntimeCallResult``.

Responsibilities:
    * Creating a benchmark ``ModelRuntime`` (Groq / DeepSeek) from config
    * Resolving API keys via ``SecretsService``
    * Building chat messages from ``PromptConfig`` templates
    * Parsing LLM responses (JSON arrays for batch, plain text for single)
    * Retry on transport / parsing failures
    * Logging and diagnostics integration
"""

from __future__ import annotations

import json
import time
import logging
from typing import Any, Dict, List, Optional, Tuple

from translator_benchmark.runtime.runtime_registry import get_runtime
from translator_benchmark.config.schema import RuntimeConfig as BenchmarkRuntimeConfig

from translator_app.translation.config import TranslationConfig
from translator_app.translation.trace_models import TraceEventSeverity, TraceEventType
from translator_app.languages import resolve_display_name as resolve_language_name

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Known batch-capable profiles that return JSON arrays
_BATCH_JSON_PROFILES = frozenset({"json_batch", "strict_json_batch"})

# Chatbot/meta reply patterns that should never be accepted as translations
_CHATBOT_REPLY_PATTERNS = [
    "it seems like you didn't type anything",
    "please provide text",
    "please go ahead and ask your question",
    "i can't translate because",
    "as an ai language model",
    "i am an ai language model",
    "i cannot translate",
    "i'm unable to translate",
    "i don't see any text",
    "there is no text",
    "no text provided",
    "you haven't provided",
    "you didn't provide any",
    "you didn't type anything",
    "i don't see anything",
    "it looks like you didn't",
    "can't process your request",
    "i'll do my best to help",
]


def _preview_text(text: str, max_chars: int = 1000) -> str:
    """Truncate *text* to *max_chars* for preview/trace logging."""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "..."


def detect_chatbot_reply(text: str) -> bool:
    """Check whether a translation response looks like a chatbot/meta reply.

    Returns ``True`` if the text (lower-cased, stripped) contains any of
    the known chatbot reply patterns.
    """
    lower = text.lower().strip()
    for pattern in _CHATBOT_REPLY_PATTERNS:
        if pattern in lower:
            return True
    return False


class RealRuntime:
    """Real translation runtime using translator_benchmark ModelRuntime.

    Implements the same duck-typed interface as ``MockRuntime``:
        * ``translate_batch(texts: list[str]) -> list[str]``
        * ``translate_single(text: str) -> str``

    Making it a drop-in replacement in ``TranslationCoreAdapter``.
    """

    def __init__(
        self,
        config: TranslationConfig,
        secrets_service: Any,
        logging_service: Any = None,
        diagnostics_service: Any = None,
        trace_service: Any = None,
    ):
        """
        Args:
            config: Fully assembled translation config.
            secrets_service: Service to resolve API key values by ID.
            logging_service: Optional LoggingService for event logging.
            diagnostics_service: Optional DiagnosticsService for diagnostics.
            trace_service: Optional TranslationTraceService for structured
                           trace event recording.
        """
        self._config = config
        self._secrets = secrets_service
        self._log = logging_service
        self._diag = diagnostics_service
        self._trace = trace_service

        self._model_runtime = self._create_model_runtime()

    # ------------------------------------------------------------------
    # Public API (duck-type compatible with MockRuntime)
    # ------------------------------------------------------------------

    def translate_batch(self, texts: List[str]) -> Tuple[List[str], Optional[str]]:
        """Translate a list of texts in batch mode.

        Builds chat messages from the prompt config, calls the benchmark
        runtime, parses the JSON array response, and returns a tuple of
        (translated_strings, raw_response).

        ``raw_response`` is the raw LLM output text — used by the
        TranslationValidator for content validation.

        Args:
            texts: Source texts to translate.

        Returns:
            Tuple of (list of translated strings, raw LLM response text).

        Raises:
            RuntimeError: If all retry attempts are exhausted.
        """
        messages = self._build_batch_messages(texts)
        max_retries = max(0, int(self._config.runtime.max_retries or 0))  # количество retry-повторов ПОСЛЕ первой попытки
        total_attempts = max_retries + 1  # значит max_retries=3 → 4 total attempts
        last_error: Optional[str] = None

        # --- Trace: prompt_built ---
        if self._trace is not None:
            system_content = messages[0]["content"] if messages else ""
            user_content = messages[1]["content"] if len(messages) > 1 else ""
            prompt_data = {
                "mode": "batch",
                "text_count": len(texts),
                "prompt_profile": self._config.prompt.profile_name,
                "src_lang": self._config.src_lang,
                "dst_lang": self._config.dst_lang,
                "system_message_preview": _preview_text(system_content),
                "user_message_preview": _preview_text(user_content),
            }
            if self._config.prompt.log_prompts:
                prompt_data["messages"] = messages
            self._trace.add_event(
                event_type=TraceEventType.PROMPT_BUILT,
                provider=self._config.runtime.provider,
                model=self._config.runtime.model,
                src_lang=self._config.src_lang,
                dst_lang=self._config.dst_lang,
                message=f"Batch prompt built for {len(texts)} texts",
                data=prompt_data,
            )

        for attempt in range(total_attempts):
            self._emit_runtime_event("runtime_call_started", "batch", attempt)

            # --- Trace: runtime_request_started ---
            if self._trace is not None:
                self._trace.add_event(
                    event_type=TraceEventType.RUNTIME_REQUEST_STARTED,
                    provider=self._config.runtime.provider,
                    model=self._config.runtime.model,
                    severity=TraceEventSeverity.INFO,
                    message=f"Batch attempt {attempt + 1}/{total_attempts}",
                    data={"mode": "batch", "attempt": attempt + 1, "text_count": len(texts)},
                )

            try:
                result = self._model_runtime.translate_batch(messages)

                if result is None:
                    raise RuntimeError("Runtime returned None")

                if result.success and result.raw_text:
                    raw_response = result.raw_text
                    # --- Trace: runtime_response_received ---
                    if self._trace is not None:
                        response_data = {
                            "mode": "batch",
                            "attempt": attempt + 1,
                            "model": self._config.runtime.model,
                            "http_status": 200,
                        }
                        if self._config.save_raw_responses:
                            response_data["raw_response"] = raw_response
                        self._trace.add_event(
                            event_type=TraceEventType.RUNTIME_RESPONSE_RECEIVED,
                            provider=self._config.runtime.provider,
                            model=self._config.runtime.model,
                            severity=TraceEventSeverity.INFO,
                            message=f"Batch response received (attempt {attempt + 1})",
                            data=response_data,
                        )

                    parsed = self._parse_batch_response(raw_response, len(texts))
                    self._emit_runtime_event("runtime_call_finished", "batch", attempt)
                    return parsed, raw_response

                # Runtime returned success=False — собираем все доступные детали
                parts = []
                if result.error_type:
                    parts.append(f"[{result.error_type}]")
                parts.append(result.error_message or "batch returned success=False")
                if result.raw_text:
                    parts.append(f"raw_text={result.raw_text!r}")
                last_error = " ".join(parts)
                self._emit_diagnostic("API_ERROR", f"Batch attempt {attempt + 1} failed: {last_error}")

                # --- Trace: runtime_response_received with error ---
                if self._trace is not None:
                    err_data = {
                        "mode": "batch",
                        "attempt": attempt + 1,
                        "model": self._config.runtime.model,
                        "error": last_error,
                        "error_type": result.error_type or "API_ERROR",
                    }
                    # Detect HTTP 429 / rate limit from error message
                    err_lower = (result.error_message or "").lower()
                    if "429" in (result.error_message or "") or "too many requests" in err_lower or "rate limit" in err_lower or "rate_limit" in (result.error_type or ""):
                        err_data["http_status"] = 429
                    self._trace.add_event(
                        event_type=TraceEventType.RUNTIME_RESPONSE_RECEIVED,
                        provider=self._config.runtime.provider,
                        model=self._config.runtime.model,
                        severity=TraceEventSeverity.WARN,
                        message=f"Batch API error (attempt {attempt + 1})",
                        data=err_data,
                    )

            except Exception as exc:
                last_error = str(exc)
                self._emit_diagnostic("API_ERROR", f"Batch attempt {attempt + 1} exception: {last_error}")

                # --- Trace: runtime error event ---
                if self._trace is not None:
                    err_data = {
                        "mode": "batch",
                        "attempt": attempt + 1,
                        "model": self._config.runtime.model,
                        "error": last_error,
                    }
                    # Detect HTTP 429 / rate limit from exception message
                    exc_lower = str(exc).lower()
                    if "429" in str(exc) or "too many requests" in exc_lower or "rate limit" in exc_lower:
                        err_data["http_status"] = 429
                    self._trace.add_event(
                        event_type=TraceEventType.RUNTIME_RESPONSE_RECEIVED,
                        provider=self._config.runtime.provider,
                        model=self._config.runtime.model,
                        severity=TraceEventSeverity.WARN,
                        message=f"Batch API exception (attempt {attempt + 1})",
                        data=err_data,
                    )

            # Log retry
            if attempt < total_attempts - 1:
                self._emit_runtime_event("retry_attempt", "batch", attempt, error=last_error)
                # --- Trace: retry_attempt ---
                if self._trace is not None:
                    retry_data = {"mode": "batch", "attempt": attempt + 1, "error": last_error}
                    # Detect rate limit for retry metadata
                    if last_error:
                        rl_lower = last_error.lower()
                        if "429" in last_error or "too many requests" in rl_lower or "rate limit" in rl_lower:
                            retry_data["http_status"] = 429
                            retry_data["retry_reason"] = "rate_limit"
                    self._trace.add_event(
                        event_type=TraceEventType.RETRY_ATTEMPT,
                        provider=self._config.runtime.provider,
                        model=self._config.runtime.model,
                        severity=TraceEventSeverity.WARN,
                        message=f"Retry batch attempt {attempt + 2}/{total_attempts}",
                        data=retry_data,
                    )

        # All retries exhausted
        error_msg = f"Batch translation failed after {total_attempts} attempts: {last_error}"
        self._emit_diagnostic("API_ERROR", error_msg)
        # --- Trace: final failure ---
        if self._trace is not None:
            self._trace.add_event(
                event_type=TraceEventType.BATCH_FAILED,
                provider=self._config.runtime.provider,
                model=self._config.runtime.model,
                severity=TraceEventSeverity.ERROR,
                message=error_msg,
                data={"mode": "batch", "error": last_error},
            )
        raise RuntimeError(error_msg)

    def translate_single(self, text: str) -> str:
        """Translate a single text.

        Builds chat messages, calls the benchmark runtime, and returns
        the raw response text.

        Args:
            text: Source text to translate.

        Returns:
            Translated text string.

        Raises:
            RuntimeError: If all retry attempts are exhausted.
        """
        messages = self._build_single_messages(text)
        max_retries = max(0, int(self._config.runtime.max_retries or 0))  # количество retry-повторов ПОСЛЕ первой попытки
        total_attempts = max_retries + 1  # значит max_retries=3 → 4 total attempts
        last_error: Optional[str] = None

        # --- Trace: prompt_built ---
        if self._trace is not None:
            system_content = messages[0]["content"] if messages else ""
            user_content = messages[1]["content"] if len(messages) > 1 else ""
            prompt_data = {
                "mode": "single",
                "text_count": 1,
                "prompt_profile": self._config.prompt.profile_name,
                "src_lang": self._config.src_lang,
                "dst_lang": self._config.dst_lang,
                "system_message_preview": _preview_text(system_content),
                "user_message_preview": _preview_text(user_content),
            }
            if self._config.prompt.log_prompts:
                prompt_data["messages"] = messages
            self._trace.add_event(
                event_type=TraceEventType.PROMPT_BUILT,
                provider=self._config.runtime.provider,
                model=self._config.runtime.model,
                src_lang=self._config.src_lang,
                dst_lang=self._config.dst_lang,
                message="Single prompt built",
                data=prompt_data,
            )

        for attempt in range(total_attempts):
            self._emit_runtime_event("runtime_call_started", "single", attempt)

            # --- Trace: runtime_request_started ---
            if self._trace is not None:
                self._trace.add_event(
                    event_type=TraceEventType.RUNTIME_REQUEST_STARTED,
                    provider=self._config.runtime.provider,
                    model=self._config.runtime.model,
                    severity=TraceEventSeverity.INFO,
                    message=f"Single attempt {attempt + 1}/{total_attempts}",
                    data={"mode": "single", "attempt": attempt + 1},
                )

            try:
                result = self._model_runtime.translate_single(messages)

                if result is None:
                    raise RuntimeError("Runtime returned None")

                if result.success and result.raw_text is not None:
                    # --- Trace: runtime_response_received ---
                    if self._trace is not None:
                        response_data = {
                            "mode": "single",
                            "attempt": attempt + 1,
                            "model": self._config.runtime.model,
                            "http_status": 200,
                        }
                        if self._config.save_raw_responses:
                            response_data["raw_response"] = result.raw_text
                        self._trace.add_event(
                            event_type=TraceEventType.RUNTIME_RESPONSE_RECEIVED,
                            provider=self._config.runtime.provider,
                            model=self._config.runtime.model,
                            severity=TraceEventSeverity.INFO,
                            message=f"Single response received (attempt {attempt + 1})",
                            data=response_data,
                        )

                    self._emit_runtime_event("runtime_call_finished", "single", attempt)
                    return result.raw_text

                # Runtime returned success=False — собираем все доступные детали
                parts = []
                if result.error_type:
                    parts.append(f"[{result.error_type}]")
                parts.append(result.error_message or "single returned success=False")
                if result.raw_text:
                    parts.append(f"raw_text={result.raw_text!r}")
                last_error = " ".join(parts)
                self._emit_diagnostic("API_ERROR", f"Single attempt {attempt + 1} failed: {last_error}")

                # --- Trace: single error event ---
                if self._trace is not None:
                    err_data = {
                        "mode": "single",
                        "attempt": attempt + 1,
                        "model": self._config.runtime.model,
                        "error": last_error,
                        "error_type": result.error_type or "API_ERROR",
                    }
                    err_lower = (result.error_message or "").lower()
                    if "429" in (result.error_message or "") or "too many requests" in err_lower or "rate limit" in err_lower or "rate_limit" in (result.error_type or ""):
                        err_data["http_status"] = 429
                    self._trace.add_event(
                        event_type=TraceEventType.RUNTIME_RESPONSE_RECEIVED,
                        provider=self._config.runtime.provider,
                        model=self._config.runtime.model,
                        severity=TraceEventSeverity.WARN,
                        message=f"Single API error (attempt {attempt + 1})",
                        data=err_data,
                    )

            except Exception as exc:
                last_error = str(exc)
                self._emit_diagnostic("API_ERROR", f"Single attempt {attempt + 1} exception: {last_error}")

                # --- Trace: single exception event ---
                if self._trace is not None:
                    err_data = {
                        "mode": "single",
                        "attempt": attempt + 1,
                        "model": self._config.runtime.model,
                        "error": last_error,
                    }
                    exc_lower = str(exc).lower()
                    if "429" in str(exc) or "too many requests" in exc_lower or "rate limit" in exc_lower:
                        err_data["http_status"] = 429
                    self._trace.add_event(
                        event_type=TraceEventType.RUNTIME_RESPONSE_RECEIVED,
                        provider=self._config.runtime.provider,
                        model=self._config.runtime.model,
                        severity=TraceEventSeverity.WARN,
                        message=f"Single API exception (attempt {attempt + 1})",
                        data=err_data,
                    )

            if attempt < total_attempts - 1:
                self._emit_runtime_event("retry_attempt", "single", attempt, error=last_error)
                # --- Trace: retry_attempt ---
                if self._trace is not None:
                    retry_data = {"mode": "single", "attempt": attempt + 1, "error": last_error}
                    if last_error:
                        rl_lower = last_error.lower()
                        if "429" in last_error or "too many requests" in rl_lower or "rate limit" in rl_lower:
                            retry_data["http_status"] = 429
                            retry_data["retry_reason"] = "rate_limit"
                    self._trace.add_event(
                        event_type=TraceEventType.RETRY_ATTEMPT,
                        provider=self._config.runtime.provider,
                        model=self._config.runtime.model,
                        severity=TraceEventSeverity.WARN,
                        message=f"Retry single attempt {attempt + 2}/{total_attempts}",
                        data=retry_data,
                    )

        error_msg = f"Single translation failed after {total_attempts} attempts: {last_error}"
        self._emit_diagnostic("API_ERROR", error_msg)
        # --- Trace: final failure ---
        if self._trace is not None:
            self._trace.add_event(
                event_type=TraceEventType.BATCH_FAILED,
                provider=self._config.runtime.provider,
                model=self._config.runtime.model,
                severity=TraceEventSeverity.ERROR,
                message=error_msg,
                data={"mode": "single", "error": last_error},
            )
        raise RuntimeError(error_msg)

    # ------------------------------------------------------------------
    # Internal: benchmark runtime creation
    # ------------------------------------------------------------------

    def _create_model_runtime(self) -> Any:
        """Create a translator_benchmark ModelRuntime from config.

        Resolves the API key via SecretsService and constructs a benchmark
        ``RuntimeConfig`` to pass to the registry's ``get_runtime()``.

        Returns:
            A ``ModelRuntime`` instance (GroqRuntime / DeepSeekRuntime).

        Raises:
            RuntimeError: If the API key cannot be resolved or the provider
                         is unknown.
        """
        api_key_value = self._resolve_api_key()

        bench_config = BenchmarkRuntimeConfig(
            provider=self._config.runtime.provider,
            model_name=self._config.runtime.model,
            api_keys=[api_key_value] if api_key_value else [],
            fallback_models=list(self._config.runtime.fallback_models),
            timeout_sec=self._config.runtime.timeout_sec,
            max_retries=self._config.runtime.max_retries,
            max_requests_per_minute=self._config.runtime.max_requests_per_minute,
            temperature=self._config.runtime.temperature,
            max_completion_tokens=self._config.runtime.max_completion_tokens,
        )

        try:
            return get_runtime(bench_config)
        except KeyError as exc:
            raise RuntimeError(f"Unknown provider: {exc}") from exc

    def _resolve_api_key(self) -> Optional[str]:
        """Resolve the API key value from SecretsService.

        Returns:
            The raw API key string, or None if no api_key_id is configured.

        Raises:
            RuntimeError: If the configured api_key_id does not exist in
                         the secrets store.
        """
        key_id = self._config.runtime.api_key_id
        if not key_id:
            return None

        if self._secrets is None:
            raise RuntimeError(
                f"API key ID '{key_id}' configured but no SecretsService provided"
            )

        record = self._secrets.get_key(key_id)
        if record is None:
            raise RuntimeError(f"API key not found: {key_id}")
        return record.value

    # ------------------------------------------------------------------
    # Internal: message building
    # ------------------------------------------------------------------

    def _build_batch_messages(self, texts: List[str]) -> List[Dict[str, str]]:
        """Build chat messages for a batch translation request.

        Uses config.prompt.batch_system_prompt and batch_user_template
        with ``{texts}``, ``{src_lang}``, ``{dst_lang}``,
        ``{src_lang_code}``, ``{dst_lang_code}`` substitutions.

        Args:
            texts: Source texts to include in the prompt.

        Returns:
            List of chat messages (dicts with role/content keys).
        """
        prompt = self._config.prompt
        src_lang_code = self._config.src_lang
        dst_lang_code = self._config.dst_lang
        src_lang = resolve_language_name(src_lang_code)
        dst_lang = resolve_language_name(dst_lang_code)
        texts_json = json.dumps(texts, ensure_ascii=False)

        subst: Dict[str, str] = {
            "texts": texts_json,
            "src_lang": src_lang,
            "dst_lang": dst_lang,
            "src_lang_code": src_lang_code,
            "dst_lang_code": dst_lang_code,
        }

        system_content = prompt.batch_system_prompt.format(**subst)
        user_content = prompt.batch_user_template.format(**subst)

        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ]
        return messages

    def _build_single_messages(self, text: str) -> List[Dict[str, str]]:
        """Build chat messages for a single translation request.

        Uses config.prompt.single_system_prompt and single_user_template
        with ``{text}``, ``{texts}``, ``{src_lang}``, ``{dst_lang}``,
        ``{src_lang_code}``, ``{dst_lang_code}`` substitutions.

        Args:
            text: Source text to include in the prompt.

        Returns:
            List of chat messages (dicts with role/content keys).
        """
        prompt = self._config.prompt
        src_lang_code = self._config.src_lang
        dst_lang_code = self._config.dst_lang
        src_lang = resolve_language_name(src_lang_code)
        dst_lang = resolve_language_name(dst_lang_code)
        texts_json = json.dumps([text], ensure_ascii=False)

        subst: Dict[str, str] = {
            "text": text,
            "texts": texts_json,
            "src_lang": src_lang,
            "dst_lang": dst_lang,
            "src_lang_code": src_lang_code,
            "dst_lang_code": dst_lang_code,
        }

        system_content = prompt.single_system_prompt.format(**subst)
        user_content = prompt.single_user_template.format(**subst)

        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ]
        return messages

    # ------------------------------------------------------------------
    # Internal: response parsing
    # ------------------------------------------------------------------

    def _parse_batch_response(self, raw_text: str, expected_count: int) -> List[str]:
        """Parse the raw LLM response for a batch request.

        For json_batch / strict_json_batch profiles, expects a JSON
        array of strings.

        Args:
            raw_text: Raw response text from the LLM.
            expected_count: Expected number of items.

        Returns:
            List of translated strings.

        Raises:
            RuntimeError: If the response cannot be parsed or the count
                         is wrong (when strict profile is configured).
        """
        text = raw_text.strip()

        # Try to extract JSON array from markdown code fences
        if text.startswith("```"):
            # Find the first [ after the opening ```
            start = text.find("[")
            end = text.rfind("]")
            if start != -1 and end != -1 and end > start:
                text = text[start:end + 1]

        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Invalid JSON in batch response: {exc}") from exc

        if not isinstance(parsed, list):
            raise RuntimeError(
                f"Batch response is not a JSON array: got {type(parsed).__name__}"
            )

        # Check all items are strings
        if not all(isinstance(item, str) for item in parsed):
            raise RuntimeError(
                "Batch response contains non-string items"
            )

        # Count validation — only raise for strict profiles
        profile = self._config.prompt.profile_name
        if profile in _BATCH_JSON_PROFILES and len(parsed) != expected_count:
            raise RuntimeError(
                f"Batch response count mismatch: expected {expected_count}, "
                f"got {len(parsed)}"
            )

        return parsed

    # ------------------------------------------------------------------
    # Internal: logging / diagnostics
    # ------------------------------------------------------------------

    def _emit_runtime_event(
        self,
        event: str,
        mode: str,
        attempt: int,
        error: Optional[str] = None,
    ) -> None:
        """Emit a runtime event to the logging service."""
        if self._log is None:
            return

        context: Dict[str, Any] = {
            "provider": self._config.runtime.provider,
            "model": self._config.runtime.model,
            "mode": mode,
            "attempt": attempt + 1,
        }
        if error is not None:
            context["error"] = error

        if event == "runtime_call_started":
            self._log.info(module="runtime", message=event, context=context)
        elif event == "runtime_call_finished":
            self._log.info(module="runtime", message=event, context=context)
        elif event == "retry_attempt":
            self._log.warning(module="runtime", message=event, context=context)

    def _emit_diagnostic(self, code: str, message: str) -> None:
        """Emit a diagnostic event to the diagnostics service."""
        if self._diag is None:
            return
        self._diag.add_error(
            code=code,
            message=message,
            entity_type="runtime",
        )
