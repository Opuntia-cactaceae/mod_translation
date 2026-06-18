from fastapi import APIRouter, Depends

from app.api.schemas.meta import LanguagesOut, ModelsOut
from app.application.meta.use_cases import ListLanguages, ListModels
from app.api.deps import get_translation_gateway
from app.application.common.ports import TranslationGateway

router = APIRouter()

@router.get("/languages", response_model=LanguagesOut)
async def languages(
    gateway: TranslationGateway = Depends(get_translation_gateway),
):
    return await ListLanguages(gateway=gateway).execute()

@router.get("/models", response_model=ModelsOut)
async def models(
    gateway: TranslationGateway = Depends(get_translation_gateway),
):
    return await ListModels(gateway=gateway).execute()