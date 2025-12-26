from __future__ import annotations

from collections import defaultdict
from typing import Iterable, Optional, Sequence

from app.application.common.errors import GatewayError, GatewayTimeout, ValidationError
from app.application.common.ports import (
    ModelInfo,
    TranslateCommand,
    TranslateResult,
    TranslationGateway,
)
from app.application.common.types import ProviderKeys, TimeoutMode
from app.infrastructure.translation_gateway.interfaces import ModelRoutedTranslator


class TranslationGatewayAdapter(TranslationGateway):
    """
    Purpose:
        Адаптер TranslationGateway, маршрутизирующий запросы по model_id.

    Responsibilities:
        - Выбрать конкретный ModelRoutedTranslator по cmd.model_id.
        - Нормализовать provider_keys (строка или список) - Optional[list[str]].
        - Пробросить provider_keys и timeout_mode в конкретный переводчик.
        - Для batch: сгруппировать команды по (model_id, source_lang, target_lang) и собрать ответ
          строго в порядке входа.

    Notes:
        - timeout_mode:
            * "wait" — переводчик может ждать/ретраить внутри себя.
            * "fail" — переводчик должен фейлиться по таймауту без ожиданий (fail-fast).
        - Ошибки GatewayTimeout/GatewayError не заворачиваются повторно.
          Любые другие исключения оборачиваются в GatewayError.
    """

    def __init__(self, translators: Iterable[ModelRoutedTranslator]):
        """
        Purpose:
            Инициализировать адаптер набором доступных переводчиков.

        Input:
            translators: Iterable[ModelRoutedTranslator] — реализации провайдеров (Groq и др.).

        Output:
            None.
        """
        self._translators = list(translators)

    def _get_translator(self, model_id: str) -> ModelRoutedTranslator:
        """
        Purpose:
            Найти переводчик, который поддерживает указанную модель.

        Input:
            model_id: str — идентификатор модели.

        Output:
            ModelRoutedTranslator — выбранный переводчик.

        Raises:
            ValidationError — если модель не поддерживается ни одним переводчиком.
        """
        for t in self._translators:
            if t.supports_model(model_id):
                return t
        raise ValidationError(f"Unknown model_id: {model_id}")

    def _normalize_provider_keys(self, provider_keys: Optional[ProviderKeys]) -> Optional[list[str]]:
        """
        Purpose:
            Нормализовать provider_keys к виду Optional[list[str]].

        Input:
            provider_keys: Optional[ProviderKeys] — строка ключа или список ключей.

        Output:
            Optional[list[str]] — список ключей или None (если пусто/не задано).

        Notes:
            - Пустые строки отбрасываются.
        """
        if provider_keys is None:
            return None
        if isinstance(provider_keys, str):
            k = provider_keys.strip()
            return [k] if k else None
        out = [str(k).strip() for k in provider_keys if str(k).strip()]
        return out or None

    async def translate_one(
        self,
        cmd: TranslateCommand,
        *,
        provider_keys: Optional[ProviderKeys] = None,
        timeout_mode: TimeoutMode = "wait",
    ) -> TranslateResult:
        """
        Purpose:
            Выполнить перевод одного текста, выбрав переводчик по model_id.

        Input:
            cmd: TranslateCommand — параметры перевода.
            provider_keys: Optional[ProviderKeys] — ключ(и) провайдера.
            timeout_mode: TimeoutMode — режим таймаутов ("wait"|"fail").

        Output:
            TranslateResult — результат перевода.

        Raises:
            ValidationError — если model_id неизвестен.
            GatewayTimeout/GatewayError — пробрасываются как есть.
            GatewayError — если переводчик упал неизвестной ошибкой.
        """
        t = self._get_translator(cmd.model_id)
        norm_keys = self._normalize_provider_keys(provider_keys)

        try:
            return await t.translate_one(cmd, provider_keys=norm_keys, timeout_mode=timeout_mode)
        except GatewayTimeout:
            raise
        except GatewayError:
            raise
        except Exception as e:
            raise GatewayError(f"Translator failed for model_id={cmd.model_id}") from e

    async def translate_batch(
        self,
        cmds: Sequence[TranslateCommand],
        *,
        provider_keys: Optional[ProviderKeys] = None,
        timeout_mode: TimeoutMode = "wait",
    ) -> list[TranslateResult]:
        """
        Purpose:
            Выполнить batch перевод, сохранив порядок входа.

        Input:
            cmds: Sequence[TranslateCommand] — команды перевода.
            provider_keys: Optional[ProviderKeys] — ключ(и) провайдера.
            timeout_mode: TimeoutMode — режим таймаутов ("wait"|"fail").

        Output:
            list[TranslateResult] — результаты в порядке входа.

        Notes:
            - Команды группируются по (model_id, source_lang, target_lang), чтобы один переводчик
              получал консистентный контекст для batch.
        """
        if not cmds:
            return []

        norm_keys = self._normalize_provider_keys(provider_keys)

        groups: dict[tuple[str, str, str], list[TranslateCommand]] = defaultdict(list)
        for c in cmds:
            groups[(c.model_id, c.source_lang, c.target_lang)].append(c)

        results_by_request_id: dict[str, TranslateResult] = {}

        for (model_id, _src, _tgt), batch in groups.items():
            t = self._get_translator(model_id)
            try:
                out = await t.translate_batch(batch, provider_keys=norm_keys, timeout_mode=timeout_mode)
            except GatewayTimeout:
                raise
            except GatewayError:
                raise
            except Exception as e:
                raise GatewayError(
                    f"Translator batch failed for model_id={model_id} src={_src} tgt={_tgt}"
                ) from e

            for r in out:
                results_by_request_id[r.request_id] = r

        try:
            return [results_by_request_id[c.request_id] for c in cmds]
        except KeyError as e:
            raise GatewayError(
                f"Translator returned incomplete batch results: missing request_id={e}"
            ) from e

    async def list_languages(self) -> list[str]:
        """
        Purpose:
            Вернуть общий список поддерживаемых языков по всем переводчикам.

        Output:
            list[str] — уникальные коды языков, отсортированные.

        Raises:
            GatewayError — если один из переводчиков не смог вернуть языки.
        """
        langs: set[str] = set()
        for t in self._translators:
            try:
                langs.update(await t.list_languages())
            except GatewayError:
                raise
            except Exception as e:
                raise GatewayError("Failed to list languages") from e
        return sorted(langs)

    async def list_models(self) -> list[ModelInfo]:
        """
        Purpose:
            Вернуть общий список моделей по всем переводчикам.

        Output:
            list[ModelInfo] — уникальные модели (по id).

        Notes:
            - При конфликтах по id берётся первая встретившаяся модель.
        """
        models: dict[str, ModelInfo] = {}
        for t in self._translators:
            try:
                for m in await t.list_models():
                    models.setdefault(m.id, m)
            except GatewayError:
                raise
            except Exception as e:
                raise GatewayError("Failed to list models") from e
        return list(models.values())