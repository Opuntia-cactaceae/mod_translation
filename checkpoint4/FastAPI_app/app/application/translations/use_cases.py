from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Sequence

from app.application.common.errors import ValidationError, GatewayError
from app.application.common.ports import (
    TranslationGateway,
    TranslateCommand,
)
from app.application.common.types import ProviderKeys, TimeoutMode
from app.application.common.uow import UnitOfWork
from app.application.translations.dtos import TranslationDTO
from app.domain.translations.entities import TranslationRequest
from app.domain.translations.value_objects import RequestId, LanguageCode, ModelId


class TranslatePhrase:
    """
    Purpose:
        Use-case перевода одного текста.

    Responsibilities:
        - Валидация входных данных (формат VO + allowlist языков/моделей через gateway).
        - Идемпотентность по (user_id, request_id).
        - Вызов TranslationGateway.translate_one().
        - Сохранение результата (ok/corrupted) как TranslationRequest.

    Notes:
        - Повторный вызов с тем же request_id возвращает сохранённый результат (200 на уровне API).
    """

    def __init__(self, uow: UnitOfWork, gateway: TranslationGateway):
        """
        Purpose:
            Инициализация use-case перевода одного текста.

        Input:
            uow: UnitOfWork — unit of work для репозиториев и транзакций.
            gateway: TranslationGateway — порт внешнего перевода.

        Output:
            None.
        """
        self.uow = uow
        self.gateway = gateway

    async def _validate(
        self,
        *,
        source_text: str,
        source_lang: str,
        target_lang: str,
        model_id: str,
        provider_keys: Optional[ProviderKeys],
        timeout_mode: TimeoutMode,
    ) -> None:
        """
        Purpose:
            Валидация входных параметров перевода.

        Input:
            source_text: исходный текст.
            source_lang: язык исходного текста.
            target_lang: целевой язык.
            model_id: идентификатор модели.
            provider_keys: ключи провайдера (execution context).
            timeout_mode: режим ожидания (execution context).

        Output:
            None.

        Raises:
            ValidationError — если source_text пустой, язык/модель не поддерживаются.

        Notes:
            - provider_keys и timeout_mode не валидируются как доменные данные.
            - allowlist языков/моделей берётся из gateway.
        """
        if not source_text:
            raise ValidationError("Empty source_text")

        supported_langs = await self.gateway.list_languages()
        if source_lang not in supported_langs:
            raise ValidationError(f"Unsupported source_lang: {source_lang}")
        if target_lang not in supported_langs:
            raise ValidationError(f"Unsupported target_lang: {target_lang}")

        models = await self.gateway.list_models()
        if model_id not in {m.id for m in models}:
            raise ValidationError(f"Unsupported model_id: {model_id}")

    async def execute(
        self,
        user_id: int,
        request_id: str,
        source_text: str,
        source_lang: str,
        target_lang: str,
        model_id: str,
        *,
        provider_keys: Optional[ProviderKeys] = None,
        timeout_mode: TimeoutMode = "wait",
    ) -> TranslationDTO:
        """
        Purpose:
            Выполнить перевод одного текста с идемпотентностью.

        Input:
            user_id: идентификатор пользователя.
            request_id: клиентский идентификатор запроса.
            source_text: исходный текст.
            source_lang: язык исходного текста.
            target_lang: целевой язык.
            model_id: модель перевода.
            provider_keys: ключи провайдера (execution context).
            timeout_mode: режим ожидания ответа (execution context).

        Output:
            TranslationDTO — результат перевода.

        Side Effects:
            - Может создать запись TranslationRequest.
            - Коммитит UnitOfWork.

        Notes:
            - Если запись уже существует, возвращается сохранённый результат.
        """
        RequestId(request_id)
        LanguageCode(source_lang)
        LanguageCode(target_lang)
        ModelId(model_id)

        await self._validate(
            source_text=source_text,
            source_lang=source_lang,
            target_lang=target_lang,
            model_id=model_id,
            provider_keys=provider_keys,
            timeout_mode=timeout_mode,
        )

        async with self.uow:
            existing = await self.uow.translations.get_by_request_id(user_id, request_id)
            if existing:
                return TranslationDTO(
                    request_id=existing.request_id,
                    translated_text=existing.translated_text,
                    status=existing.status,
                    error_message=existing.error_message,
                )

            res = await self.gateway.translate_one(
                TranslateCommand(
                    request_id=request_id,
                    source_text=source_text,
                    source_lang=source_lang,
                    target_lang=target_lang,
                    model_id=model_id,
                ),
                provider_keys=provider_keys,
                timeout_mode=timeout_mode,
            )

            now = datetime.utcnow()
            entity = TranslationRequest(
                id=0,
                user_id=user_id,
                request_id=request_id,
                source_text=source_text,
                source_lang=source_lang,
                target_lang=target_lang,
                model_id=model_id,
                translated_text=res.translated_text,
                status=res.status,
                error_message=res.error_message,
                created_at=now,
            )

            await self.uow.translations.add(entity)
            await self.uow.commit()

            return TranslationDTO(
                request_id=res.request_id,
                translated_text=res.translated_text,
                status=res.status,
                error_message=res.error_message,
            )


@dataclass(frozen=True)
class BatchItem:
    """
    Purpose:
        Application-level элемент батча перевода.

    Input:
        request_id: идентификатор элемента (идемпотентность по (user_id, request_id)).
        source_text: исходный текст элемента.

    Notes:
        - Общие параметры (source_lang/target_lang/model_id) задаются на уровне батча.
        - Это не Pydantic-модель: application слой не зависит от API.
    """
    request_id: str
    source_text: str


class TranslateBatch:
    """
    Purpose:
        Use-case пакетного перевода.

    Responsibilities:
        - Валидация общего контекста батча (языки, модель) через allowlist gateway.
        - Валидация элементов (непустой source_text + VO форматы request_id).
        - Per-item идемпотентность: повторные request_id возвращаются из БД.
        - Вызов TranslationGateway.translate_batch() только для отсутствующих элементов.
        - Bulk insert новых TranslationRequest и один commit.

    Notes:
        - Batch не является отдельной доменной сущностью.
        - Каждый элемент батча сохраняется отдельной строкой TranslationRequest.
        - Порядок ответа соответствует порядку входных items.
    """

    def __init__(self, uow: UnitOfWork, gateway: TranslationGateway):
        """
        Purpose:
            Инициализация use-case пакетного перевода.

        Input:
            uow: UnitOfWork — unit of work для транзакций и репозиториев.
            gateway: TranslationGateway — порт внешнего перевода.

        Output:
            None.
        """
        self.uow = uow
        self.gateway = gateway

    async def _validate_batch(
        self,
        *,
        source_lang: str,
        target_lang: str,
        model_id: str,
        items: Sequence[BatchItem],
        provider_keys: Optional[ProviderKeys],
        timeout_mode: TimeoutMode,
    ) -> None:
        """
        Purpose:
            Валидация параметров батч-перевода.

        Input:
            source_lang: общий язык исходного текста.
            target_lang: общий целевой язык.
            model_id: общая модель перевода.
            items: элементы батча.
            provider_keys: ключи провайдера (execution context).
            timeout_mode: режим ожидания (execution context).

        Output:
            None.

        Raises:
            ValidationError — если контекст батча или элементы некорректны.

        Notes:
            - provider_keys и timeout_mode не валидируются как доменные данные.
            - allowlist языков/моделей берётся из gateway.
        """
        if not items:
            raise ValidationError("Empty items")

        supported_langs = await self.gateway.list_languages()
        if source_lang not in supported_langs:
            raise ValidationError(f"Unsupported source_lang: {source_lang}")
        if target_lang not in supported_langs:
            raise ValidationError(f"Unsupported target_lang: {target_lang}")

        models = await self.gateway.list_models()
        supported_model_ids = {m.id for m in models}
        if model_id not in supported_model_ids:
            raise ValidationError(f"Unsupported model_id: {model_id}")

        for i, it in enumerate(items):
            if not it.source_text:
                raise ValidationError(f"Item[{i}]: Empty source_text")

    async def execute(
        self,
        user_id: int,
        *,
        source_lang: str,
        target_lang: str,
        model_id: str,
        items: Sequence[BatchItem],
        provider_keys: Optional[ProviderKeys] = None,
        timeout_mode: TimeoutMode = "wait",
    ) -> list[TranslationDTO]:
        """
        Purpose:
            Выполнить пакетный перевод текстов.

        Input:
            user_id: идентификатор пользователя.
            source_lang: общий язык исходного текста.
            target_lang: общий целевой язык.
            model_id: модель перевода.
            items: элементы батча (request_id + source_text).
            provider_keys: ключи провайдера (execution context).
            timeout_mode: режим ожидания ответа (execution context).

        Output:
            List[TranslationDTO] — результаты перевода в порядке входных items.

        Side Effects:
            - Может создать несколько TranslationRequest в БД.

        Raises:
            GatewayError — если gateway вернул неполный набор результатов или нарушил контракт.

        Notes:
            - Идемпотентность обеспечивается по каждому request_id отдельно.
            - Gateway вызывается только для отсутствующих request_id.
        """
        LanguageCode(source_lang)
        LanguageCode(target_lang)
        ModelId(model_id)

        await self._validate_batch(
            source_lang=source_lang,
            target_lang=target_lang,
            model_id=model_id,
            items=items,
            provider_keys=provider_keys,
            timeout_mode=timeout_mode,
        )

        req_ids: list[str] = []
        cmds: list[TranslateCommand] = []

        for it in items:
            RequestId(it.request_id)
            req_ids.append(it.request_id)
            cmds.append(
                TranslateCommand(
                    request_id=it.request_id,
                    source_text=it.source_text,
                    source_lang=source_lang,
                    target_lang=target_lang,
                    model_id=model_id,
                )
            )

        async with self.uow:
            existing_rows = await self.uow.translations.get_many_by_request_ids(
                user_id=user_id,
                request_ids=req_ids,
            )
            existing_map: dict[str, TranslationRequest] = {r.request_id: r for r in existing_rows}

            missing_cmds = [c for c in cmds if c.request_id not in existing_map]

            created_map: dict[str, TranslationRequest] = {}
            if missing_cmds:
                results = await self.gateway.translate_batch(
                    missing_cmds,
                    provider_keys=provider_keys,
                    timeout_mode=timeout_mode,
                )

                if len(results) != len(missing_cmds):
                    raise GatewayError("Translator returned incomplete batch results")

                now = datetime.utcnow()
                new_entities: list[TranslationRequest] = []

                for cmd, res in zip(missing_cmds, results):
                    e = TranslationRequest(
                        id=0,
                        user_id=user_id,
                        request_id=cmd.request_id,
                        source_text=cmd.source_text,
                        source_lang=cmd.source_lang,
                        target_lang=cmd.target_lang,
                        model_id=cmd.model_id,
                        translated_text=res.translated_text,
                        status=res.status,
                        error_message=res.error_message,
                        created_at=now,
                    )
                    new_entities.append(e)
                    created_map[cmd.request_id] = e

                await self.uow.translations.add_many(new_entities)
                await self.uow.commit()

            out: list[TranslationDTO] = []
            for cmd in cmds:
                r = existing_map.get(cmd.request_id) or created_map.get(cmd.request_id)
                if r is None:
                    raise GatewayError(f"Missing result for request_id={cmd.request_id}")

                out.append(
                    TranslationDTO(
                        request_id=r.request_id,
                        translated_text=r.translated_text,
                        status=r.status,
                        error_message=r.error_message,
                    )
                )

            return out