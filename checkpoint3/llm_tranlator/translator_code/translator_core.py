# localization_translator/translator_core.py
import json
import time
from typing import List, Dict, Optional
from groq import Groq
from .config import Config
from .logging_utils import write_log


class Translator:
    """
    Отвечает за:
    - выбор API-ключа и модели (основная + фоллбеки);
    - учёт локальных rate limit (429 + retry-after) для ключей и моделей;
    - обработку APITimeoutError (переключение ключа/ожидание);
    - глобальный троттлинг по TPS (cfg.rate_limit_tps);
    - батчевый и одиночный перевод.
    """

    def __init__(self, cfg: Config):
        self.cfg = cfg

        #ключи и модели
        self.api_keys: List[str] = cfg.api_keys
        self.api_key_index: int = 0

        self.models: List[str] = [cfg.model] + cfg.model_fallbacks
        self.model_index: int = 0

        # клиент Groq под текущий ключ
        self.client = Groq(api_key=self.api_keys[self.api_key_index])
        self._client_api_key = self.api_keys[self.api_key_index]

        #локальные rate-limit'ы для ключей и моделей
        now = 0.0
        self.key_rate_limited_until: Dict[str, float] = {
            k: now for k in self.api_keys
        }
        self.model_rate_limited_until: Dict[str, float] = {
            m: now for m in self.models
        }

        #глобальный троттлинг по TPS
        self.last_call = 0.0
        self.min_interval = 1.0 / max(cfg.rate_limit_tps, 0.01)

    # текущее состояние 

    def _current_key(self) -> str:
        return self.api_keys[self.api_key_index]

    def _current_model(self) -> str:
        return self.models[self.model_index]

    def _ensure_client(self):
        """
        Пересоздаёт клиента, если индекс ключа поменялся.
        """
        key = self._current_key()
        if key != self._client_api_key:
            self.client = Groq(api_key=key)
            self._client_api_key = key
            write_log(f"[Translator] Переключился на новый API ключ {key[:8]}…")

    # учёт rate limit и таймаутов 

    def _mark_key_rate_limited(self, key: str, retry_after: Optional[float]):
        if retry_after is None or retry_after <= 0:
            retry_after = 30.0
        until = time.time() + retry_after
        prev = self.key_rate_limited_until.get(key, 0.0)
        if until > prev:
            self.key_rate_limited_until[key] = until
            write_log(
                f"RATE LIMIT/TIMEOUT: ключ {key[:8]}… заблокирован на {retry_after:.1f} сек (до {until})"
            )

    def _mark_model_rate_limited(self, model: str, retry_after: Optional[float]):
        if retry_after is None or retry_after <= 0:
            retry_after = 30.0
        until = time.time() + retry_after
        prev = self.model_rate_limited_until.get(model, 0.0)
        if until > prev:
            self.model_rate_limited_until[model] = until
            write_log(
                f"RATE LIMIT: модель {model} заблокирована на {retry_after:.1f} сек (до {until})"
            )

    def _parse_retry_after(self, e: Exception) -> Optional[float]:
        """
        Достаём retry-after из e.response.headers / e.headers.
        Поддерживаем '2' и '2m59.56s' (берём первые цифры).
        """
        headers = None
        resp = getattr(e, "response", None)
        if resp is not None:
            headers = getattr(resp, "headers", None)
        if headers is None:
            headers = getattr(e, "headers", None)
        if not headers:
            return None

        val = headers.get("retry-after") or headers.get("Retry-After")
        if not val:
            return None

        try:
            return float(val)
        except ValueError:
            pass

        num = ""
        for ch in val:
            if ch.isdigit() or ch == ".":
                num += ch
            elif num:
                break
        try:
            return float(num) if num else None
        except ValueError:
            return None

    def _pick_available_pair(self):
        """
        Выбирает доступную пару (ключ, модель), у которых временная блокировка уже истекла.
        Если все комбинации под лимитом — ждёт до ближайшего разблокирования.
        """
        while True:
            now = time.time()
            cur_key_idx = self.api_key_index
            cur_model_idx = self.model_index
            cur_key = self.api_keys[cur_key_idx]
            cur_model = self.models[cur_model_idx]

            # 1) Пытаемся оставить текущую пару, если она не под лимитом
            key_until = self.key_rate_limited_until.get(cur_key, 0.0)
            model_until = self.model_rate_limited_until.get(cur_model, 0.0)
            if key_until <= now and model_until <= now:
                self._ensure_client()
                return

            # 2) Ищем любую доступную пару
            best_pair = None
            best_wait = None

            for ki, k in enumerate(self.api_keys):
                ku = self.key_rate_limited_until.get(k, 0.0)
                for mi, m in enumerate(self.models):
                    mu = self.model_rate_limited_until.get(m, 0.0)
                    wait = max(ku - now, mu - now)
                    if wait <= 0:
                        best_pair = (ki, mi)
                        break
                    if best_wait is None or wait < best_wait:
                        best_wait = wait
                if best_pair is not None:
                    break

            if best_pair is not None:
                old_key, old_model = self._current_key(), self._current_model()
                self.api_key_index, self.model_index = best_pair
                self._ensure_client()
                new_key, new_model = self._current_key(), self._current_model()
                if (new_key, new_model) != (old_key, old_model):
                    write_log(
                        f"RATE LIMIT/TIMEOUT: переключаюсь с (key={old_key[:8]}…, model={old_model}) "
                        f"на (key={new_key[:8]}…, model={new_model})"
                    )
                    print(
                        f"[Translator] Переключаюсь: key {old_key[:8]}…/model {old_model} "
                        f"-> key {new_key[:8]}…/model {new_model}"
                    )
                return

            # 3) Все пары под лимитом: ждём до ближайшего разблокирования
            sleep_for = max(best_wait or 0.0, 0.0)
            print(
                f"[Translator] Все ключи/модели в rate limit/timeout, сплю {sleep_for:.1f} сек..."
            )
            time.sleep(sleep_for)

    def _rate_limit(self):
        """
       выбираем доступную пару (ключ, модель) с учётом локальных окон rate limit / timeout
       применяем глобальный TPS-троттлинг
        """
        self._pick_available_pair()

        delta = time.time() - self.last_call
        if delta < self.min_interval:
            time.sleep(self.min_interval - delta)

    # типы ошибок 

    def _is_rate_limit(self, e: Exception) -> bool:
        code = getattr(e, "status_code", None)
        return code == 429

    def _is_billing_error(self, e: Exception) -> bool:
        code = getattr(e, "status_code", None)
        # реальные billing/auth ошибки — только 401/402/403
        return code in (401, 402, 403)

    def _is_timeout(self, e: Exception) -> bool:
        """
        Ловим APITimeoutError/Timeout по имени класса, чтобы не тащить конкретные типы.
        """
        name = type(e).__name__
        return name.lower() in {"apitimeouterror", "timeout", "readtimeouterror"} or isinstance(e, TimeoutError)

    # промпты и парсинг 

    def _system_prompt_batch(self) -> str:
        return (
            "You are a professional game localizer. "
            "Translate user-visible text from {src} to {tgt}. "
            "Do NOT translate or alter content inside <PH id=.../> tags. "
            "Preserve placeholders, variables, icons, color codes, and explicit newlines. "
            "STRICT OUTPUT RULES: "
            "Respond with a JSON array ONLY. "
            "NO comments, NO explanations, NO trailing commas, NO code fences. "
            "Output must contain ONLY the JSON array of translated strings. "
            "Array MUST have exactly the same length and order as the input. "
            "Each element must be a plain string value. "
            "Do NOT add anything else under any circumstances."
        ).format(src=self.cfg.source_lang, tgt=self.cfg.target_lang)

    def _system_prompt_single(self) -> str:
        return (
            "You are a professional game localizer. "
            "Translate user-visible text from {src} to {tgt}. "
            "Do NOT translate or alter content inside <PH id=.../> tags. "
            "Preserve placeholders, variables, icons, color codes, and explicit newlines. "
            "Return ONLY the translated string without additional commentary."
        ).format(src=self.cfg.source_lang, tgt=self.cfg.target_lang)

    def _strip_code_fences(self, s: str) -> str:
        s = s.strip()
        if s.startswith("```"):
            lines = s.splitlines()
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            s = "\n".join(lines).strip()
        return s

    def _extract_json_array(self, s: str) -> Optional[str]:
        s = self._strip_code_fences(s)
        if not s:
            return None
        if s.lstrip().startswith("[") and s.rstrip().endswith("]"):
            return s
        i1, i2 = s.find("["), s.rfind("]")
        if i1 != -1 and i2 != -1 and i2 > i1:
            return s[i1: i2 + 1]
        return None

    # батч-перевод 

    def translate_batch(
        self, segments: List[str], segment_ids: Optional[List[int]] = None
    ) -> List[Optional[str]]:
        if not segments:
            return []

        user_payload = json.dumps(segments, ensure_ascii=False)

        last_err: Optional[Exception] = None
        raw_last: Optional[str] = None

        for attempt in range(3):
            self._rate_limit()
            try:
                resp = self.client.chat.completions.create(
                    model=self._current_model(),
                    temperature=self.cfg.temperature,
                    max_tokens=self.cfg.max_tokens,
                    messages=[
                        {"role": "system", "content": self._system_prompt_batch()},
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
                self.last_call = time.time()
                raw = (resp.choices[0].message.content or "").strip()
                raw_last = raw
                write_log(f"RAW_BATCH_REPLY=\n{raw}")

                array_str = self._extract_json_array(raw)
                if not array_str:
                    last_err = ValueError("Пустой или не-JSON ответ модели")
                    if segment_ids is not None:
                        write_log(
                            f"bad_json_reply for text_ids={segment_ids}: {raw}",
                            "errors.log",
                        )
                    else:
                        write_log(
                            f"bad_json_reply for unknown text_ids: {raw}",
                            "errors.log",
                        )
                    break

                try:
                    out = json.loads(array_str)
                except json.JSONDecodeError as je:
                    last_err = je
                    if segment_ids is not None:
                        write_log(
                            f"json_decode_error for text_ids={segment_ids}: {raw}",
                            "errors.log",
                        )
                    else:
                        write_log(
                            f"json_decode_error for unknown text_ids: {raw}",
                            "errors.log",
                        )
                    break

                if not isinstance(out, list) or len(out) != len(segments):
                    last_err = ValueError("Модель вернула некорректный массив или длину")
                    if segment_ids is not None:
                        write_log(
                            f"bad_json_array_len for text_ids={segment_ids}: {raw}",
                            "errors.log",
                        )
                    else:
                        write_log(
                            f"bad_json_array_len for unknown text_ids: {raw}",
                            "errors.log",
                        )
                    break

                return ["" if x is None else str(x) for x in out]

            except Exception as e:  # noqa: BLE001
                write_log(f"batch_error: {repr(e)}", "errors.log")
                last_err = e

                if self._is_billing_error(e):
                    msg = (
                        f"Groq billing/credits error, дальнейший перевод невозможен: {e}"
                    )
                    print(msg)
                    write_log(msg, "errors.log")
                    raise RuntimeError(msg) from e

                if self._is_rate_limit(e):
                    retry_after = self._parse_retry_after(e)
                    self._mark_model_rate_limited(self._current_model(), retry_after)
                    self._mark_key_rate_limited(self._current_key(), retry_after)
                    continue

                if self._is_timeout(e):
                    retry_after = self._parse_retry_after(e)
                    if retry_after is None:
                        retry_after = 10.0 * (attempt + 1)
                    write_log(
                        f"APITimeoutError на key={self._current_key()[:8]}…/model={self._current_model()}, "
                        f"retry_after={retry_after}",
                        "errors.log",
                    )
                    self._mark_key_rate_limited(self._current_key(), retry_after)
                    continue

                # Любая другая ошибка — экспоненциальный бэкофф,
                time.sleep((2 ** min(attempt + 1, 3)) * 0.7)

        if isinstance(last_err, (json.JSONDecodeError, ValueError)):
            # fallback построчно
            results: List[Optional[str]] = []
            ids = segment_ids or [None] * len(segments)
            for seg, seg_id in zip(segments, ids):
                try:
                    t = self.translate_single(seg)
                    results.append(t if t is not None else seg)
                except Exception as e:  # noqa: BLE001
                    write_log(
                        f"single_fallback_error, DROPPED text_id={seg_id}: {repr(e)}",
                        "errors.log",
                    )
                    results.append(None)
            return results

        msg = (
            "Не удалось перевести батч после смены ключей/моделей и нескольких попыток. "
            f"Последняя ошибка: {last_err!r}"
        )
        print(msg)
        write_log(msg, "errors.log")
        if raw_last is not None and segment_ids is not None:
            write_log(
                f"last_raw_reply_on_failure for text_ids={segment_ids}: {raw_last}",
                "errors.log",
            )
        raise RuntimeError(msg)

    # перевод одной строки 

    def translate_single(self, text: str) -> str:
        system = self._system_prompt_single()
        last_err: Optional[Exception] = None

        for attempt in range(3):
            self._rate_limit()
            try:
                resp = self.client.chat.completions.create(
                    model=self._current_model(),
                    temperature=self.cfg.temperature,
                    max_tokens=self.cfg.max_tokens,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": text},
                    ],
                )
                self.last_call = time.time()
                content = (resp.choices[0].message.content or "").strip()
                return content if content else text
            except Exception as e:  # noqa: BLE001
                last_err = e

                if self._is_billing_error(e):
                    msg = (
                        f"Groq billing/credits error (single), дальнейший перевод "
                        f"невозможен: {e}"
                    )
                    print(msg)
                    write_log(msg, "errors.log")
                    raise RuntimeError(msg) from e

                if self._is_rate_limit(e):
                    retry_after = self._parse_retry_after(e)
                    self._mark_model_rate_limited(self._current_model(), retry_after)
                    self._mark_key_rate_limited(self._current_key(), retry_after)
                    continue

                if self._is_timeout(e):
                    retry_after = self._parse_retry_after(e)
                    if retry_after is None:
                        retry_after = 10.0 * (attempt + 1)
                    write_log(
                        f"APITimeoutError(single) на key={self._current_key()[:8]}…/model={self._current_model()}, "
                        f"retry_after={retry_after}",
                        "errors.log",
                    )
                    self._mark_key_rate_limited(self._current_key(), retry_after)
                    continue

                time.sleep((2 ** attempt) * 0.7)

        msg = (
            "Не удалось перевести строку после смены ключей/моделей и нескольких попыток. "
            f"Последняя ошибка: {last_err!r}"
        )
        print(msg)
        write_log(msg, "errors.log")
        raise RuntimeError(msg)