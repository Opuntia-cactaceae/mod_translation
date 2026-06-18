import time
import json
import logging
from typing import List, Dict, Optional
from .base import ModelRuntime
from .key_pool import create_key_pool, acquire_next_key, mark_key_rate_limited
from .retry_policy import classify_error, parse_retry_after, should_retry, compute_retry_delay_sec
from ..domain.results import RuntimeCallResult
from ..domain.enums import ResponseOutcomeType
from ..config.schema import RuntimeConfig

logger = logging.getLogger(__name__)

try:
    from openai import OpenAI
    from openai.types.chat import ChatCompletion
    DEEPSEEK_AVAILABLE = True
except ImportError:
    DEEPSEEK_AVAILABLE = False
    OpenAI = None
    ChatCompletion = None

# --------------------------------------------------------------------------
# Deprecated model alias mapping (DeepSeek API 2026 deprecation)
#
# As of 2026, deepseek-chat and deepseek-reasoner are deprecated
# (EOL 2026-07-24) in favour of deepseek-v4-flash.  Old names
# are transparently rewritten so existing jobs / saved configs
# continue to work without manual migration.
#
# deepseek-chat    → deepseek-v4-flash (non-thinking mode)
# deepseek-reasoner → deepseek-v4-flash (thinking/reasoning mode)
# --------------------------------------------------------------------------

_DEPRECATED_ALIASES: dict[str, str] = {
    "deepseek-chat": "deepseek-v4-flash",
    "deepseek-reasoner": "deepseek-v4-flash",
}

# --------------------------------------------------------------------------
# Thinking mode indicators — when the user explicitly asked for reasoning,
# we forward an extra_body hint so DeepSeek enables thinking.  The actual
# response may still contain reasoning_content even without the hint
# (handled in _call_api).  Non-thinking models ignore the hint.
# --------------------------------------------------------------------------

_THINKING_MODEL_PATTERNS = frozenset({"reasoner", "r1", "thinking"})


def _wants_thinking(model_name: str) -> bool:
    """Return True if the model name implies reasoning/thinking mode."""
    lower = model_name.lower()
    return any(pattern in lower for pattern in _THINKING_MODEL_PATTERNS)


def _rewrite_model(model_name: str) -> tuple[str, bool]:
    """Rewrites deprecated aliases and returns (canonical_name, wants_thinking).

    Returns:
        (actual model name to send to API, whether thinking should be requested).
    """
    canonical = _DEPRECATED_ALIASES.get(model_name, model_name)
    # Only request thinking if the ORIGINAL name asked for it
    thinking = _wants_thinking(model_name)
    return canonical, thinking


#штука для работы с дипсикусом, как старая с гроком
#надеюсь я просто опишу его в ридмишке
class DeepSeekRuntime(ModelRuntime):

    def __init__(self, runtime_config: RuntimeConfig):
        if not DEEPSEEK_AVAILABLE:
            raise ImportError("OpenAI SDK not installed. Install with: pip install openai")
        self.config = runtime_config

        # Rewrite deprecated aliases
        _, _ = _rewrite_model(runtime_config.model_name)

        self.key_pool = create_key_pool(runtime_config.api_keys)
        self.models = [runtime_config.model_name] + runtime_config.fallback_models
        self.key_index = 0
        self.model_index = 0
        self.model_rate_limited_until: Dict[str, float] = {model: 0.0 for model in self.models}
        self.last_call = 0.0
        self.min_interval = 0.0
        if runtime_config.max_requests_per_minute and runtime_config.max_requests_per_minute > 0:
            self.min_interval = 60.0 / runtime_config.max_requests_per_minute
        self.client: Optional[OpenAI] = None
        self._current_key_index: Optional[int] = None

    def _ensure_client(self, key_index: int, key: str):
        if self.client is None or self._current_key_index != key_index:
            base_url = self.config.base_url or "https://api.deepseek.com"
            self.client = OpenAI(api_key=key, base_url=base_url)
            self._current_key_index = key_index

    def _pick_available_pair(self) -> tuple[int, str, str]:
        while True:
            now = time.time()
            cur_key_idx = self.key_index
            cur_model_idx = self.model_index
            cur_key = self.key_pool.get_key_by_index(cur_key_idx)
            cur_model = self.models[cur_model_idx]

            key_until = self.key_pool.get_key_rate_limit_until(cur_key_idx)
            model_until = self.model_rate_limited_until.get(cur_model, 0.0)
            if key_until <= now and model_until <= now:
                self._ensure_client(cur_key_idx, cur_key)
                return cur_key_idx, cur_key, cur_model

            best_pair = None
            best_wait = None

            for ki in range(len(self.key_pool.keys)):
                ku = self.key_pool.get_key_rate_limit_until(ki)
                for mi, model in enumerate(self.models):
                    mu = self.model_rate_limited_until.get(model, 0.0)
                    wait = max(ku - now, mu - now)
                    if wait <= 0:
                        best_pair = (ki, mi)
                        break
                    if best_wait is None or wait < best_wait:
                        best_wait = wait
                if best_pair is not None:
                    break

            if best_pair is not None:
                old_key, old_model = cur_key, cur_model
                self.key_index, self.model_index = best_pair
                new_key = self.key_pool.get_key_by_index(self.key_index)
                new_model = self.models[self.model_index]
                self._ensure_client(self.key_index, new_key)
                return self.key_index, new_key, new_model

            sleep_for = max(best_wait or 0.0, 0.0)
            time.sleep(sleep_for)

    def _apply_global_throttle(self):
        if self.min_interval <= 0:
            return
        delta = time.time() - self.last_call
        if delta < self.min_interval:
            time.sleep(self.min_interval - delta)

    def _mark_model_rate_limited(self, model: str, cooldown_sec: float):
        until = time.time() + cooldown_sec
        prev = self.model_rate_limited_until.get(model, 0.0)
        if until > prev:
            self.model_rate_limited_until[model] = until

    def _mark_key_rate_limited(self, key_index: int, cooldown_sec: float):
        self.key_pool.mark_key_rate_limited(key_index, cooldown_sec)

    def _call_api(self, messages: List[Dict[str, str]], is_batch: bool) -> RuntimeCallResult:
        max_retries = self.config.max_retries
        timeout_sec = self.config.timeout_sec
        temperature = self.config.temperature
        max_completion_tokens = self.config.max_completion_tokens
        base_url = self.config.base_url or "https://api.deepseek.com"

        last_exception = None
        used_key_index = None
        used_key_model = None

        for attempt in range(1, max_retries + 1):
            try:
                self._apply_global_throttle()
                key_idx, key, model = self._pick_available_pair()
                used_key_index = key_idx
                used_key_model = model

                # Rewrite deprecated aliases and determine thinking mode
                canonical_model, thinking = _rewrite_model(model)
                self._ensure_client(key_idx, key)

                start_time = time.time()

                logger.debug(
                    "deepseek request: provider=deepseek model=%s canonical=%s "
                    "thinking=%s base_url=%s attempt=%d/%d timeout=%.1fs",
                    model, canonical_model, thinking,
                    base_url, attempt, max_retries, timeout_sec,
                )

                extra_body = (
                    {"thinking": {"type": "enabled"}} if thinking else None
                )

                completion: ChatCompletion = self.client.chat.completions.create(
                    model=canonical_model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_completion_tokens,
                    timeout=timeout_sec,
                    extra_body=extra_body,
                )
                latency_ms = int((time.time() - start_time) * 1000)
                self.last_call = time.time()

                # DeepSeek R1 / reasoning models may return reasoning_content
                # with an empty or near-empty content field.  Try content first,
                # fall back to reasoning_content, then default to "".
                message = completion.choices[0].message
                content = getattr(message, "content", None)
                reasoning = getattr(message, "reasoning_content", None)
                raw_text = (content or reasoning or "").strip()

                logger.debug(
                    "deepseek response: model=%s canonical=%s content_len=%d "
                    "reasoning_len=%d raw_text_len=%d preview=%r",
                    model, canonical_model,
                    len(content) if content else 0,
                    len(reasoning) if reasoning else 0,
                    len(raw_text),
                    raw_text[:300],
                )

                usage = completion.usage
                input_tokens = usage.prompt_tokens if usage else None
                output_tokens = usage.completion_tokens if usage else None
                total_tokens = usage.total_tokens if usage else None

                outcome = ResponseOutcomeType.ACCEPTED_WITHOUT_RETRY if attempt == 1 else ResponseOutcomeType.ACCEPTED_AFTER_RETRY

                return RuntimeCallResult(
                    success=True,
                    raw_text=raw_text,
                    latency_ms=latency_ms,
                    used_model=canonical_model,
                    used_key_index=key_idx,
                    input_token_count=input_tokens,
                    output_token_count=output_tokens,
                    total_token_count=total_tokens,
                    response_outcome_type=outcome,
                    retry_reason=None,
                    repair_applied=False,
                    fallback_triggered=False,
                )

            except Exception as e:
                last_exception = e
                error_type = classify_error(e)
                retry_after = parse_retry_after(e)

                # --- Detailed connection error diagnostics ---
                exc_name = type(e).__name__
                exc_repr = repr(e)
                exc_cause = getattr(e, "__cause__", None)
                exc_context = getattr(e, "__context__", None)
                cause_repr = repr(exc_cause) if exc_cause else None
                context_repr = repr(exc_context) if exc_context else None
                status_code = getattr(e, "status_code", None)

                logger.warning(
                    "deepseek error: attempt=%d/%d error_type=%s exc=%s "
                    "repr=%s status=%s cause=%s context=%s base_url=%s "
                    "model=%s canonical=%s thinking=%s",
                    attempt, max_retries, error_type, exc_name,
                    exc_repr[:300], status_code,
                    (cause_repr or "")[:200], (context_repr or "")[:200],
                    base_url, model, canonical_model, thinking,
                )

                if error_type == "billing":
                    break

                if error_type == "rate_limit":
                    if used_key_index is not None:
                        cooldown = retry_after or 30.0
                        self._mark_key_rate_limited(used_key_index, cooldown)
                    if used_key_model is not None:
                        cooldown = retry_after or 30.0
                        self._mark_model_rate_limited(used_key_model, cooldown)

                if error_type == "timeout":
                    if used_key_index is not None:
                        cooldown = retry_after or 10.0 * attempt
                        self._mark_key_rate_limited(used_key_index, cooldown)

                if not should_retry(error_type, attempt, max_retries):
                    break

                delay = compute_retry_delay_sec(error_type, attempt, retry_after)
                time.sleep(delay)

        # Build a rich error message including the exception type and cause
        exc_name = type(last_exception).__name__ if last_exception else ""
        exc_cause = getattr(last_exception, "__cause__", None) if last_exception else None
        cause_msg = f"; caused by {type(exc_cause).__name__}: {exc_cause}" if exc_cause else ""

        error_msg = (
            f"[{error_type}] {exc_name}: {last_exception}{cause_msg}"
            if last_exception else f"[{error_type}] Unknown error"
        )
        outcome = (
            self._determine_outcome(last_exception, error_type)
            if last_exception else ResponseOutcomeType.UNKNOWN_ERROR
        )

        return RuntimeCallResult(
            success=False,
            raw_text=None,
            latency_ms=0,
            used_model=used_key_model or self.config.model_name,
            used_key_index=used_key_index,
            error_type=error_type,
            error_message=error_msg,
            input_token_count=None,
            output_token_count=None,
            total_token_count=None,
            response_outcome_type=outcome,
            retry_reason=error_type,
            repair_applied=False,
            fallback_triggered=False,
        )

    def _determine_outcome(self, exception: Exception, error_type: str) -> ResponseOutcomeType:
        if error_type == "rate_limit":
            return ResponseOutcomeType.RATE_LIMITED
        if error_type == "timeout":
            return ResponseOutcomeType.TIMEOUT
        if error_type in ("billing", "auth"):
            return ResponseOutcomeType.TRANSPORT_ERROR
        if error_type in ("dns", "tls", "connection"):
            return ResponseOutcomeType.TRANSPORT_ERROR
        return ResponseOutcomeType.UNKNOWN_ERROR

    def translate_batch(self, messages: List[Dict[str, str]]) -> RuntimeCallResult:
        return self._call_api(messages, is_batch=True)

    def translate_single(self, messages: List[Dict[str, str]]) -> RuntimeCallResult:
        return self._call_api(messages, is_batch=False)


def create_deepseek_runtime(runtime_config: RuntimeConfig) -> DeepSeekRuntime:
    return DeepSeekRuntime(runtime_config)