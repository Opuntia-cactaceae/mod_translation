import uuid

from fastapi import APIRouter, Depends

from app.api.schemas.translate import (
    TranslateIn,
    TranslateOut,
    TranslateBatchIn,
    TranslateBatchOut,
)
from app.application.translations.use_cases import (
    TranslatePhrase,
    TranslateBatch,
    BatchItem,
)
from app.api.deps import (
    get_uow,
    get_translation_gateway,
    get_current_user,
    CurrentUser,
)
from app.application.common.ports import TranslationGateway

router = APIRouter()


@router.post("", response_model=TranslateOut)
async def translate(
    payload: TranslateIn,
    uow=Depends(get_uow),
    gateway: TranslationGateway = Depends(get_translation_gateway),
    current_user: CurrentUser = Depends(get_current_user),
):
    uc = TranslatePhrase(uow=uow, gateway=gateway)
    request_id = payload.request_id or uuid.uuid4().hex

    return await uc.execute(
        user_id=current_user.id,
        request_id=request_id,
        source_text=payload.source_text,
        source_lang=payload.source_lang,
        target_lang=payload.target_lang,
        model_id=payload.model_id,
        provider_keys=payload.provider_keys,
        timeout_mode=payload.timeout_mode,
    )


@router.post("/batch", response_model=TranslateBatchOut)
async def translate_batch(
    payload: TranslateBatchIn,
    uow=Depends(get_uow),
    gateway: TranslationGateway = Depends(get_translation_gateway),
    current_user: CurrentUser = Depends(get_current_user),
):
    uc = TranslateBatch(uow=uow, gateway=gateway)

    items = [
        BatchItem(
            request_id=i.request_id,
            source_text=i.source_text,
        )
        for i in payload.items
    ]

    result = await uc.execute(
        user_id=current_user.id,
        source_lang=payload.source_lang,
        target_lang=payload.target_lang,
        model_id=payload.model_id,
        items=items,
        provider_keys=payload.provider_keys,
        timeout_mode=payload.timeout_mode,
    )

    return {"items": result}