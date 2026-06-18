from fastapi import APIRouter, Depends
from app.api.schemas.history import HistoryOut
from app.application.history.use_cases import ListHistory
from app.api.deps import get_uow, get_current_user

router = APIRouter()

@router.get("", response_model=HistoryOut)
async def list_history(
    limit: int = 50,
    offset: int = 0,
    uow=Depends(get_uow),
    current_user=Depends(get_current_user),
):
    uc = ListHistory(uow=uow)
    return await uc.execute(
        user_id=current_user.id,
        limit=limit,
        offset=offset,
    )
