from __future__ import annotations

from dataclasses import dataclass

from app.application.common.uow import UnitOfWork


@dataclass(frozen=True)
class DeleteUserHistoryResult:
    user_id: int
    deleted: int


class DeleteUserHistory:
    """
    Purpose:
        Удалить историю переводов конкретного пользователя (admin).

    Notes:
        Confirm token проверяется на уровне API (заголовок).
        Здесь только бизнес-операция через репозиторий.
    """

    def __init__(self, uow: UnitOfWork):
        self.uow = uow

    async def execute(self, *, user_id: int) -> DeleteUserHistoryResult:
        async with self.uow:
            deleted = await self.uow.translations.delete_by_user(user_id)
            await self.uow.commit()
            return DeleteUserHistoryResult(user_id=user_id, deleted=deleted)


class GetGlobalStats:
    """
    Purpose:
        Вернуть простую статистику по истории переводов всех пользователей (admin).
    """

    def __init__(self, uow: UnitOfWork):
        self.uow = uow

    async def execute(self) -> dict:
        async with self.uow:
            return await self.uow.translations.stats_global()