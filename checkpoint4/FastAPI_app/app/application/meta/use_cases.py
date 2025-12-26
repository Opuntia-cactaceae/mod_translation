from __future__ import annotations
from app.application.common.ports import TranslationGateway

class ListLanguages:
    def __init__(self, gateway: TranslationGateway):
        self.gateway = gateway

    async def execute(self):
        return {"languages": await self.gateway.list_languages()}

class ListModels:
    def __init__(self, gateway: TranslationGateway):
        self.gateway = gateway

    async def execute(self):
        models = await self.gateway.list_models()
        return {"models": [m.__dict__ for m in models]}
