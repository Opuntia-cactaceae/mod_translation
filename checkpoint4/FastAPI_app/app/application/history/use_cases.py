from __future__ import annotations

from app.application.common.uow import UnitOfWork


class ListHistory:
    def __init__(self, uow: UnitOfWork):
        self.uow = uow

    async def execute(self, user_id: int, limit: int, offset: int):
        """
        Purpose:
            Получить историю переводов пользователя с пагинацией.

        Input:
            user_id: int — идентификатор пользователя.
            limit: int — максимальное количество записей.
            offset: int — смещение выборки.

        Output:
            dict — объект вида {"items": [...]} для ответа API.

        Side Effects:
            Нет.

        Notes:
            Использует TranslationsRepository.list_by_user.
        """
        async with self.uow:
            rows = await self.uow.translations.list_by_user(
                user_id=user_id,
                limit=limit,
                offset=offset,
            )

        return {
            "items": [
                {
                    "request_id": r.request_id,
                    "source_text": r.source_text,
                    "translated_text": r.translated_text,
                    "source_lang": r.source_lang,
                    "target_lang": r.target_lang,
                    "model_id": r.model_id,
                    "status": r.status,
                    "error_message": r.error_message,
                }
                for r in rows
            ]
        }