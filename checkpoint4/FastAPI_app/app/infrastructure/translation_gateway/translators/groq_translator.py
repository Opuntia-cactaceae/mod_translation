from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Optional, Sequence

import anyio
from groq import Groq

from app.application.common.errors import GatewayTimeout, GatewayUnavailable, ValidationError
from app.application.common.ports import ModelInfo, TranslateCommand, TranslateResult
from app.application.common.types import TimeoutMode
from app.infrastructure.translation_gateway.interfaces import ModelRoutedTranslator
from app.infrastructure.translation_gateway.tag_integrity import compute_tag_integrity

_JSON_FENCE_RE = re.compile(r"^\s*```[a-zA-Z0-9_-]*\s*|\s*```\s*$", re.MULTILINE)

_TOKEN_PATTERNS = [
    r"\$[A-Za-z0-9_]+\$",                 # $VAR$
    r"\[.+?\]",                           # [Root.GetName]
    r"£[A-Za-z0-9_]+£",                   # £food£
    r"§[A-Za-z0-9]|\§!",                  # §Y ... §!
    r"§[A-Za-z0-9](?:.|[\r\n])*?§!",      # секции §Y...§!
    r"\{[A-Za-z0-9_.:-]+\}",              # {VALUE}
    r"%(?:\d+\$)?[sd]",                   # printf
    r"\\n",                               # явные переносы
]

_TOKEN_REGEX = re.compile("|".join(f"({p})" for p in _TOKEN_PATTERNS), re.DOTALL)

_PH_RESTORE_RE = re.compile(
    r"""
    (?ix)
    (?:<|&lt;)
    [\s\u200B\uFEFF]*
    ph\b
    [^>]*?
    \bid\s*=\s*
    (?:\\{0,2}["'“”‘’])?
    (k\d+)
    (?:\\{0,2}["'“”‘’])?
    [^>]*?
    /?
    [\s\u200B\uFEFF]*
    (?:>|&gt;)
    """,
    re.IGNORECASE | re.VERBOSE | re.DOTALL,
)

@dataclass(frozen=True)
class _RetryCfg:
    """
    Purpose:
        Конфигурация ретраев/бэкоффа и локального троттлинга.

    Input:
        max_attempts: int — максимальное число попыток.
        base_backoff: float — базовая задержка (сек).
        max_backoff: float — верхняя граница задержки (сек).
        tps: float — ограничение частоты вызовов (транзакций/сек) на адаптер.

    Output:
        None.

    Side Effects:
        Нет.

    Notes:
        Используется GroqTranslator для вычисления backoff и минимального интервала вызовов.
    """
    max_attempts: int
    base_backoff: float
    max_backoff: float
    tps: float


class _KeyPool:
    """
    Purpose:
        Хранилище состояния API-ключей (текущий индекс, блокировки, отключённые ключи).

    Input:
        keys: Sequence[str] — список ключей (строки).

    Output:
        None.

    Side Effects:
        Инициализирует внутреннее mutable-состояние:
        - index (текущий ключ),
        - blocked_until (таймштампы блокировки),
        - disabled (набор отключённых ключей).

    Notes:
        Может быть общим (shared pool) или per-request (provider_keys override).
        Пустой пул считается ошибкой конфигурации и приводит к RuntimeError.
    """

    def __init__(self, keys: Sequence[str]):
        """
        Purpose:
            Создать пул ключей и инициализировать состояние.

        Input:
            keys: Sequence[str] — исходный список ключей.

        Output:
            None.

        Side Effects:
            Нормализует ключи (strip), заполняет blocked_until и disabled.

        Notes:
            blocked_until по умолчанию = 0.0 для всех ключей.
        """
        self.keys: list[str] = [k.strip() for k in keys if k and k.strip()]
        if not self.keys:
            raise RuntimeError("Empty key pool")

        self.index: int = 0
        now = 0.0
        self.blocked_until: dict[str, float] = {k: now for k in self.keys}
        self.disabled: set[str] = set()


class GroqTranslator(ModelRoutedTranslator):
    """
    Purpose:
        Провайдер перевода через Groq (ModelRoutedTranslator).

    Input:
        default_api_keys: Optional[Sequence[str]] — дефолтные ключи (shared pool).
        max_tokens: int — ограничение токенов ответа.
        temperature: float — температура генерации.

    Output:
        Экземпляр провайдера, реализующий:
            translate_one / translate_batch / list_models / list_languages / supports_model.

    Side Effects:
        Читает конфиг из окружения для моделей и ретраев:
            - GROQ_MODELS
            - GROQ_MAX_ATTEMPTS / GROQ_BACKOFF_BASE_SECONDS / GROQ_BACKOFF_MAX_SECONDS / GROQ_RATE_LIMIT_TPS
        Кэширует клиентов Groq по ключам (для shared pool).
        Использует anyio.Lock для синхронизации доступа к shared pool.

    Notes:
        - Ключи по нашей архитектуре могут приходить из API (provider_keys) и не хранятся в settings.
        - Если default_api_keys не заданы и provider_keys отсутствуют => ValidationError.
        - Groq SDK синхронный, поэтому вызов выполняется в worker thread (anyio.to_thread).
    """

    def __init__(
            self,
            *,
            models_csv: str,
            languages_csv: str = "",
            max_attempts: int = 5,
            backoff_base_seconds: float = 0.7,
            backoff_max_seconds: float = 20.0,
            rate_limit_tps: float = 2.0,
            default_api_keys: Optional[Sequence[str]] = None,
            max_tokens: int = 2048,
            temperature: float = 0.2,
    ):
        """
        Purpose:
            Инициализировать GroqTranslator и загрузить конфигурацию.

        Input:
            default_api_keys: Optional[Sequence[str]] — ключи для shared pool (опционально).
            max_tokens: int — max_tokens для Groq chat.completions.
            temperature: float — temperature для Groq chat.completions.

        Output:
            None.

        Side Effects:
            Валидирует GROQ_MODELS, строит модельный каталог, создаёт shared пул ключей (если задан),
            и создаёт lock.

        Notes:
            - В случае пустых/битых env значений по моделям/ретраям бросает RuntimeError.
            - default_api_keys может быть None: тогда требуется provider_keys на каждом запросе.
        """
        self._max_tokens = max_tokens
        self._temperature = temperature

        raw_models = (models_csv or "").strip()
        if not raw_models:
            raise RuntimeError("GROQ_MODELS is empty or not set")

        self._models: dict[str, str] = {
            m.strip(): f"Groq {m.strip()}"
            for m in raw_models.split(",")
            if m.strip()
        }
        if not self._models:
            raise RuntimeError("No valid models in GROQ_MODELS")

        self._languages_csv = (languages_csv or "").strip()

        self._retry_cfg = _RetryCfg(
            max_attempts=max(1, int(max_attempts)),
            base_backoff=max(0.05, float(backoff_base_seconds)),
            max_backoff=max(0.2, float(backoff_max_seconds)),
            tps=max(0.01, float(rate_limit_tps)),
        )

        self._last_call_ts = 0.0
        self._min_interval = 1.0 / self._retry_cfg.tps

        keys = [k.strip() for k in (default_api_keys or []) if k and k.strip()]
        self._default_pool: Optional[_KeyPool] = _KeyPool(keys) if keys else None

        self._clients: dict[str, Groq] = {}
        self._lock = anyio.Lock()

    def check_corrupted(self, source_text: str, translated_text: str) -> bool:
        """
            Purpose:
                Определить, является ли результат перевода поврежденным на основе теговой метрики.

            Input:
                source_text: str — исходный текст (reference).
                translated_text: str — переведённый текст (candidate).

            Output:
                bool — True если перевод считается "corrupted", иначе False.

            Side Effects:
                Нет.
            """
        scores = compute_tag_integrity(source_text, translated_text)
        return scores.final == 0.0

    def supports_model(self, model_id: str) -> bool:
        """
        Purpose:
            Проверить, поддерживается ли модель адаптером.

        Input:
            model_id: str — идентификатор модели.

        Output:
            bool — True если модель есть в GROQ_MODELS.

        Side Effects:
            Нет.
        """
        return model_id in self._models

    async def list_models(self) -> list[ModelInfo]:
        """
        Purpose:
            Вернуть список моделей (meta) для API.

        Input:
            None.

        Output:
            list[ModelInfo] — список доступных моделей.

        Side Effects:
            Нет.
        """
        return [ModelInfo(id=k, title=v) for k, v in self._models.items()]

    async def list_languages(self) -> list[str]:
        """
        Purpose:
            Вернуть список поддерживаемых языков (meta) для API.

        Input:
            None.

        Output:
            list[str] — список кодов языков.
        """
        raw = self._languages_csv
        if not raw:
            return []
        return [lang.strip() for lang in raw.split(",") if lang.strip()]


    def _system_prompt_single(self, src: str, tgt: str) -> str:
        """
        Purpose:
            Сформировать system prompt для одиночного перевода.

        Input:
            src: str — исходный язык.
            tgt: str — целевой язык.

        Output:
            str — system prompt.

        Side Effects:
            Нет.
        """
        return (
            "You are a professional game localizer. "
            f"Translate user-visible text from {src} to {tgt}. "
            "Do NOT translate or alter content inside <PH id=.../> tags. "
            "Preserve placeholders, variables, icons, color codes, and explicit newlines. "
            "Return ONLY the translated string without additional commentary."
        )

    def _system_prompt_batch(self, src: str, tgt: str) -> str:
        """
        Purpose:
            Сформировать system prompt для batch перевода.

        Input:
            src: str — исходный язык.
            tgt: str — целевой язык.

        Output:
            str — system prompt.

        Side Effects:
            Нет.
        """
        return (
            "You are a professional game localizer. "
            f"Translate user-visible text from {src} to {tgt}. "
            "Do NOT translate or alter content inside <PH id=.../> tags. "
            "Preserve placeholders, variables, icons, color codes, and explicit newlines. "
            "Return ONLY a JSON array of translated strings, same length and order as input."
        )


    def _status_code(self, e: Exception) -> Optional[int]:
        """
        Purpose:
            Достать HTTP status_code из исключения Groq/HTTP.

        Input:
            e: Exception — пойманная ошибка.

        Output:
            Optional[int] — status_code или None.

        Side Effects:
            Нет.
        """
        code = getattr(e, "status_code", None)
        if isinstance(code, int):
            return code
        resp = getattr(e, "response", None)
        sc = getattr(resp, "status_code", None) if resp is not None else None
        return sc if isinstance(sc, int) else None

    def _headers(self, e: Exception) -> dict[str, str]:
        """
        Purpose:
            Достать HTTP headers из исключения.

        Input:
            e: Exception — пойманная ошибка.

        Output:
            dict[str, str] — заголовки или пустой dict.

        Side Effects:
            Нет.
        """
        resp = getattr(e, "response", None)
        hdrs = getattr(resp, "headers", None) if resp is not None else None
        if isinstance(hdrs, dict):
            return hdrs
        hdrs2 = getattr(e, "headers", None)
        return hdrs2 if isinstance(hdrs2, dict) else {}

    def _parse_retry_after(self, e: Exception) -> Optional[float]:
        """
        Purpose:
            Извлечь Retry-After из headers (секунды) для rate-limit сценариев.

        Input:
            e: Exception — пойманная ошибка.

        Output:
            Optional[float] — seconds или None.

        Side Effects:
            Нет.
        """
        headers = self._headers(e)
        val = headers.get("retry-after") or headers.get("Retry-After")
        if not val:
            return None
        try:
            return float(val)
        except ValueError:
            pass
        num = ""
        for ch in str(val):
            if ch.isdigit() or ch == ".":
                num += ch
            elif num:
                break
        try:
            return float(num) if num else None
        except ValueError:
            return None

    def _is_rate_limit(self, e: Exception) -> bool:
        """
        Purpose:
            Определить, является ли ошибка rate-limit (429).

        Input:
            e: Exception — пойманная ошибка.

        Output:
            bool — True если похоже на 429/rate limit.

        Side Effects:
            Нет.
        """
        sc = self._status_code(e)
        if sc == 429:
            return True
        msg = str(e).lower()
        return "rate limit" in msg or "too many requests" in msg or "429" in msg

    def _is_timeout(self, e: Exception) -> bool:
        """
        Purpose:
            Определить, является ли ошибка таймаутом.

        Input:
            e: Exception — пойманная ошибка.

        Output:
            bool — True если это timeout.

        Side Effects:
            Нет.
        """
        name = type(e).__name__.lower()
        if name in {"apitimeouterror", "timeout", "readtimeouterror"}:
            return True
        return isinstance(e, TimeoutError)

    def _is_hard_auth_or_billing(self, e: Exception) -> bool:
        """
        Purpose:
            Определить "жёсткие" ошибки доступа/биллинга (ключ нужно отключить).

        Input:
            e: Exception — пойманная ошибка.

        Output:
            bool — True если status_code в (401, 402, 403).

        Side Effects:
            Нет.
        """
        sc = self._status_code(e)
        return sc in (401, 402, 403)


    def _strip_code_fences(self, s: str) -> str:
        """
        Purpose:
            Удалить markdown code fences из ответа модели (best effort).

        Input:
            s: str — исходная строка ответа.

        Output:
            str — строка без ```...```.

        Side Effects:
            Нет.
        """
        s = s.strip()
        if "```" not in s:
            return s
        return _JSON_FENCE_RE.sub("", s).strip()

    def _extract_json_array(self, s: str) -> Optional[str]:
        """
        Purpose:
            Вырезать JSON array из произвольного ответа.

        Input:
            s: str — строка ответа (может содержать лишний текст).

        Output:
            Optional[str] — строка JSON массива или None.

        Side Effects:
            Нет.
        """
        s = self._strip_code_fences(s)
        if not s:
            return None
        if s.lstrip().startswith("[") and s.rstrip().endswith("]"):
            return s
        i1, i2 = s.find("["), s.rfind("]")
        if i1 != -1 and i2 != -1 and i2 > i1:
            return s[i1 : i2 + 1]
        return None


    async def _throttle(self) -> None:
        """
        Purpose:
            Локально ограничить частоту вызовов к провайдеру (tps).

        Input:
            None.

        Output:
            None.

        Side Effects:
            Может сделать async sleep.

        Notes:
            Использует self._last_call_ts и минимальный интервал (1/tps).
        """
        delta = time.time() - self._last_call_ts
        if delta < self._min_interval:
            await anyio.sleep(self._min_interval - delta)

    def _calc_backoff(self, attempt: int) -> float:
        """
        Purpose:
            Посчитать задержку backoff для попытки.

        Input:
            attempt: int — номер попытки (0..N-1).

        Output:
            float — задержка в секундах.

        Side Effects:
            Нет.
        """
        backoff = self._retry_cfg.base_backoff * (2 ** attempt)
        return min(backoff, self._retry_cfg.max_backoff)


    def _client_for_key(self, key: str) -> Groq:
        """
        Purpose:
            Получить (или создать) Groq client для ключа (кэшируется для shared pool).

        Input:
            key: str — API ключ.

        Output:
            Groq — клиент SDK.

        Side Effects:
            Может создать и закэшировать новый Groq(api_key=...).

        Notes:
            Для provider_keys override клиенты создаются на лету, без кэша.
        """
        c = self._clients.get(key)
        if c is None:
            c = Groq(api_key=key)
            self._clients[key] = c
        return c

    def _pick_available_key_index(self, pool: _KeyPool) -> int:
        """
        Purpose:
            Выбрать доступный ключ из пула (учитывая blocked_until и disabled).

        Input:
            pool: _KeyPool — пул ключей.

        Output:
            int — индекс выбранного ключа.

        Side Effects:
            Нет.
        """
        now = time.time()

        cur = pool.index
        cur_key = pool.keys[cur]
        if cur_key not in pool.disabled and pool.blocked_until.get(cur_key, 0.0) <= now:
            return cur

        for i, k in enumerate(pool.keys):
            if k in pool.disabled:
                continue
            if pool.blocked_until.get(k, 0.0) <= now:
                return i

        waits = [
            pool.blocked_until.get(k, 0.0) - now
            for k in pool.keys
            if k not in pool.disabled
        ]
        if not waits:
            raise GatewayUnavailable("All Groq API keys are disabled")

        sleep_for = max(0.0, min(waits))
        raise GatewayTimeout(f"All Groq keys are temporarily blocked; retry after {sleep_for:.2f}s")

    def _make_pool_from_provider_keys(self, provider_keys: Optional[Sequence[str]]) -> _KeyPool:
        """
        Purpose:
            Построить пул ключей для запроса.

        Input:
            provider_keys: Optional[Sequence[str]] — ключи, переданные через gateway.

        Output:
            _KeyPool — пул ключей, который будет использоваться для запроса.

        Raises:
            ValidationError — если ключи не переданы и отсутствует default pool.

        Notes:
            - Если provider_keys переданы — создаётся per-request пул (override).
            - Иначе используется shared пул, если он задан при инициализации.
        """
        override = [k.strip() for k in (provider_keys or []) if k and k.strip()]
        if override:
            return _KeyPool(override)

        if self._default_pool is None:
            raise ValidationError("provider_keys is required for GroqTranslator")

        return self._default_pool

    async def _apply_error_to_pool(self, pool: _KeyPool, key: str, e: Exception, attempt: int) -> None:
        """
        Purpose:
            Применить эффект ошибки к пулу ключей (disable или block until).

        Input:
            pool: _KeyPool — пул ключей.
            key: str — ключ, на котором произошла ошибка.
            e: Exception — пойманная ошибка.
            attempt: int — номер попытки.

        Output:
            None.

        Side Effects:
            Может:
              - добавить key в pool.disabled (401/402/403),
              - обновить pool.blocked_until[key].
        """
        if self._is_hard_auth_or_billing(e):
            pool.disabled.add(key)
            return

        if self._is_rate_limit(e):
            ra = self._parse_retry_after(e)
            seconds = ra if ra and ra > 0 else self._calc_backoff(attempt)
        elif self._is_timeout(e):
            seconds = self._calc_backoff(attempt)
        else:
            seconds = self._calc_backoff(attempt)

        until = time.time() + max(0.0, seconds)
        prev = pool.blocked_until.get(key, 0.0)
        if until > prev:
            pool.blocked_until[key] = until


    async def _call_chat(self, client: Groq, *, model: str, messages: list[dict[str, Any]]) -> str:
        """
        Purpose:
            Унифицированный вызов Groq chat.completions в отдельном потоке.

        Input:
            client: Groq — SDK клиент.
            model: str — id модели.
            messages: list[dict[str, Any]] — сообщения chat API.

        Output:
            str — content первого choice (обрезанный).

        Side Effects:
            Делает сетевой вызов через Groq SDK (в worker thread).
        """

        def _sync_call() -> str:
            resp = client.chat.completions.create(
                model=model,
                temperature=self._temperature,
                max_tokens=self._max_tokens,
                messages=messages,
            )
            return (resp.choices[0].message.content or "").strip()

        return await anyio.to_thread.run_sync(_sync_call)

    async def translate_one(
            self,
            cmd: TranslateCommand,
            *,
            provider_keys: Optional[Sequence[str]] = None,
            timeout_mode: TimeoutMode = "wait",
    ) -> TranslateResult:
        """
        Purpose:
            Перевести один текст через Groq с ретраями и ротацией ключей.

        Input:
            cmd: TranslateCommand — параметры перевода.
            provider_keys: Optional[Sequence[str]] — ключи на запрос (override).
                Если не переданы/пустые — используется default pool (если задан),
                иначе возбуждается ValidationError.
            timeout_mode: TimeoutMode — режим таймаутов ("wait"|"fail").

        Output:
            TranslateResult — результат перевода (status="ok"|"corrupted").

        Side Effects:
            Может обновлять состояние пулов ключей, выполнять sleep и делать сетевые вызовы.

        Raises:
            ValidationError — если ключи не переданы и default pool отсутствует.
            GatewayTimeout/GatewayUnavailable — при сетевых/протокольных ошибках.
        """
        if not self.supports_model(cmd.model_id):
            raise GatewayUnavailable(f"Unsupported Groq model: {cmd.model_id}")

        system = self._system_prompt_single(cmd.source_lang, cmd.target_lang)

        override_keys = [k.strip() for k in (provider_keys or []) if k and k.strip()]
        use_override = bool(override_keys)
        pool = self._make_pool_from_provider_keys(override_keys or None)

        last_err: Optional[Exception] = None

        for attempt in range(self._retry_cfg.max_attempts):
            await self._throttle()

            if not use_override:
                async with self._lock:
                    pool.index = self._pick_available_key_index(pool)
                    key = pool.keys[pool.index]
                    client = self._client_for_key(key)
            else:
                pool.index = self._pick_available_key_index(pool)
                key = pool.keys[pool.index]
                client = Groq(api_key=key)

            protected_src, mapping = self._protect_tokens(cmd.source_text)
            try:
                text = await self._call_chat(
                    client,
                    model=cmd.model_id,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": protected_src},
                    ],
                )
                self._last_call_ts = time.time()

            except Exception as e:
                self._last_call_ts = time.time()
                last_err = e

                if timeout_mode == "fail" and self._is_timeout(e):
                    raise GatewayTimeout("Groq timeout") from e

                await self._apply_error_to_pool(pool, key, e, attempt)
                pool.index = (pool.index + 1) % len(pool.keys)
                await anyio.sleep(0.01)
                continue

            restored = self._restore_tokens(text, mapping)
            is_corrupted = self.check_corrupted(protected_src, restored)
            return TranslateResult(
                request_id=cmd.request_id,
                translated_text=restored,
                status="corrupted" if is_corrupted else "ok",
                error_message=None,
            )

        if last_err and self._is_timeout(last_err):
            raise GatewayTimeout("Groq timeout") from last_err
        raise GatewayUnavailable("Groq unavailable") from last_err

    async def translate_batch(
            self,
            cmds: Sequence[TranslateCommand],
            *,
            provider_keys: Optional[Sequence[str]] = None,
            timeout_mode: TimeoutMode = "wait",
    ) -> list[TranslateResult]:
        """
        Purpose:
            Перевести batch текстов одним запросом к Groq (одна модель на batch).

        Input:
            cmds: Sequence[TranslateCommand] — команды перевода (одинаковые model_id/langs).
            provider_keys: Optional[Sequence[str]] — ключи на запрос (override).
                Если не переданы/пустые — используется default pool (если задан),
                иначе возбуждается ValidationError.
            timeout_mode: TimeoutMode — режим таймаутов ("wait"|"fail").

        Output:
            list[TranslateResult] — результаты в порядке входа.

        Side Effects:
            Может обновлять состояние пулов ключей, выполнять sleep и делать сетевые вызовы.

        Raises:
            ValidationError — если ключи не переданы и default pool отсутствует.
            GatewayTimeout/GatewayUnavailable — при сетевых/протокольных ошибках.
        """
        if not cmds:
            return []

        model_id = cmds[0].model_id
        if any(c.model_id != model_id for c in cmds):
            raise GatewayUnavailable("GroqTranslator requires single model_id per batch")
        if not self.supports_model(model_id):
            raise GatewayUnavailable(f"Unsupported Groq model: {model_id}")

        system = self._system_prompt_batch(cmds[0].source_lang, cmds[0].target_lang)
        protected_list: list[str] = []
        mappings: list[dict[str, str]] = []
        for c in cmds:
            p, m = self._protect_tokens(c.source_text)
            protected_list.append(p)
            mappings.append(m)

        user_payload = json.dumps(protected_list, ensure_ascii=False)

        override_keys = [k.strip() for k in (provider_keys or []) if k and k.strip()]
        use_override = bool(override_keys)
        pool = self._make_pool_from_provider_keys(override_keys or None)

        last_err: Optional[Exception] = None

        for attempt in range(self._retry_cfg.max_attempts):
            await self._throttle()

            if not use_override:
                async with self._lock:
                    pool.index = self._pick_available_key_index(pool)
                    key = pool.keys[pool.index]
                    client = self._client_for_key(key)
            else:
                pool.index = self._pick_available_key_index(pool)
                key = pool.keys[pool.index]
                client = Groq(api_key=key)

            try:
                raw = await self._call_chat(
                    client,
                    model=model_id,
                    messages=[
                        {"role": "system", "content": system},
                        {
                            "role": "user",
                            "content": (
                                    "Translate this JSON array. "
                                    "Respond with a JSON array ONLY, no commentary:\n"
                                    + user_payload
                            ),
                        },
                    ],
                )
                self._last_call_ts = time.time()

            except Exception as e:
                self._last_call_ts = time.time()
                last_err = e

                if timeout_mode == "fail" and self._is_timeout(e):
                    raise GatewayTimeout("Groq batch timeout") from e

                await self._apply_error_to_pool(pool, key, e, attempt)
                pool.index = (pool.index + 1) % len(pool.keys)
                await anyio.sleep(0.01)
                continue

            array_str = self._extract_json_array(raw)
            if not array_str:
                raise GatewayUnavailable("Groq batch returned non-JSON-array response")

            try:
                out = json.loads(array_str)
            except json.JSONDecodeError as e:
                raise GatewayUnavailable("Groq batch returned invalid JSON array") from e

            if not isinstance(out, list) or len(out) != len(cmds):
                raise GatewayUnavailable("Groq batch returned JSON array with wrong type or length")

            results: list[TranslateResult] = []
            for cmd, translated_protected, mapping in zip(cmds, out, mappings):
                translated_protected = "" if translated_protected is None else str(translated_protected)

                restored = self._restore_tokens(translated_protected, mapping)

                is_corrupted = self.check_corrupted(cmd.source_text, restored)
                results.append(
                    TranslateResult(
                        request_id=cmd.request_id,
                        translated_text=restored,
                        status="corrupted" if is_corrupted else "ok",
                        error_message=None,
                    )
                )
            return results

        if last_err and self._is_timeout(last_err):
            raise GatewayTimeout("Groq batch timeout") from last_err
        raise GatewayUnavailable("Groq batch failed") from last_err

    def _protect_tokens(self, text: str) -> tuple[str, dict[str, str]]:
        """
        Purpose:
            Замаскировать плейсхолдеры/токены в тексте перед отправкой в LLM,
            чтобы модель не переводила/не ломала их.

        Input:
            text: str — исходный текст, содержащий токены (например $VAR$, {VALUE}, §Y...§!, [Root.GetName], \\n и т.д.).

        Output:
            tuple[str, dict[str, str]]:
                - protected_text: str — текст, где все найденные токены заменены на <PH id="kN"/>.
                - mapping: dict[str, str] — отображение kN -> оригинальный токен, для восстановления после перевода.

        Side Effects:
            Нет.

        Notes:
            - Шаблоны токенов задаются через _TOKEN_REGEX.
            - Идентификаторы генерируются последовательно: k0, k1, k2...
            - Формат плейсхолдера фиксированный: <PH id="kN"/> (на него ориентируется restore).
        """
        mapping: dict[str, str] = {}
        idx = 0

        def repl(m: re.Match) -> str:
            nonlocal idx
            original = m.group(0)
            key = f"k{idx}"
            idx += 1
            mapping[key] = original
            return f'<PH id="{key}"/>'

        protected = re.sub(_TOKEN_REGEX, repl, text)
        return protected, mapping

    def _restore_tokens(self, text: str, mapping: dict[str, str]) -> str:
        """
        Purpose:
            Восстановить замаскированные токены после ответа LLM:
            заменить <PH id="kN"/> обратно на оригинальные значения из mapping.

        Input:
            text: str — текст после LLM (может содержать <PH .../> или их «покорёженные» варианты).
            mapping: dict[str, str] — отображение kN -> оригинальный токен, полученное из _protect_tokens().

        Output:
            str — текст, где плейсхолдеры <PH id="kN"/> заменены на исходные токены.

        Side Effects:
            Нет.

        Notes:
            - Восстановление делается по _PH_RESTORE_RE (best effort):
                * поддерживает <PH ...>, <ph ...>, пробелы/мусор внутри,
                * поддерживает HTML-экранирование &lt; / &gt;,
                * поддерживает разные кавычки и экранирование.
            - Если mapping пустой — возвращаем text как есть.
            - Если плейсхолдер не найден в mapping — оставляем его как есть.
        """
        if not mapping:
            return text
        return _PH_RESTORE_RE.sub(lambda m: mapping.get(m.group(1), m.group(0)), text)