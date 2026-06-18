from fastapi import APIRouter, Depends, Header, HTTPException

from app.api.deps import (
    require_admin,
    get_admin_read,
    CurrentUser,
    get_current_user,
    get_jwt_service,
    get_uow,
)
from app.api.schemas.admin import (
    AdminUsersOut,
    AdminTranslationsOut,
    AdminStatsOut,
    AdminHistoryConfirmOut,
    AdminDeleteHistoryOut,
)
from app.application.admin.use_cases import DeleteUserHistory, GetGlobalStats
from app.infrastructure.db.admin_read import AdminRead
from app.infrastructure.db.uow import SqlAlchemyUnitOfWork
from app.infrastructure.security.jwt_service import JwtService

router = APIRouter(dependencies=[Depends(require_admin)])


@router.get("/users", response_model=AdminUsersOut)
async def users(admin_read: AdminRead = Depends(get_admin_read)):
    return await admin_read.list_users()


@router.get("/translations", response_model=AdminTranslationsOut)
async def translations(admin_read: AdminRead = Depends(get_admin_read)):
    return await admin_read.list_translations()


@router.post("/history/confirm", response_model=AdminHistoryConfirmOut)
async def confirm_delete_user_history(
    user_id: int,
    admin: CurrentUser = Depends(get_current_user),
    jwt_service: JwtService = Depends(get_jwt_service),
):
    token = jwt_service.issue_confirm_delete_history(
        admin_user_id=admin.id,
        target_user_id=user_id,
        ttl_seconds=60,
    )
    return AdminHistoryConfirmOut(confirm_token=token, expires_in=60)


@router.delete("/history/{user_id}", response_model=AdminDeleteHistoryOut)
async def delete_user_history(
    user_id: int,
    confirm_token: str = Header(..., alias="X-Confirm-Token"),
    jwt_service: JwtService = Depends(get_jwt_service),
    uow: SqlAlchemyUnitOfWork = Depends(get_uow),
):
    try:
        jwt_service.decode_confirm_delete_history(
            confirm_token,
            expected_target_user_id=user_id,
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid confirm token")

    uc = DeleteUserHistory(uow)
    res = await uc.execute(user_id=user_id)
    return AdminDeleteHistoryOut(user_id=res.user_id, deleted=res.deleted)


@router.get("/stats", response_model=AdminStatsOut)
async def stats(
    uow: SqlAlchemyUnitOfWork = Depends(get_uow),
):
    uc = GetGlobalStats(uow)
    data = await uc.execute()
    return AdminStatsOut(**data)