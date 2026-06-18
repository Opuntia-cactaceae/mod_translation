from __future__ import annotations

from typing import Optional, Protocol, Sequence

from app.application.common.ports import ModelInfo, TranslateCommand, TranslateResult
from app.application.common.types import ProviderKeys, TimeoutMode

class ModelRoutedTranslator(Protocol):
    def supports_model(self, model_id: str) -> bool: ...

    async def translate_one(
        self,
        cmd: TranslateCommand,
        *,
        provider_keys: Optional[Sequence[str]] = None,
        timeout_mode: TimeoutMode = "wait",
    ) -> TranslateResult: ...

    async def translate_batch(
        self,
        cmds: Sequence[TranslateCommand],
        *,
        provider_keys: Optional[Sequence[str]] = None,
        timeout_mode: TimeoutMode = "wait",
    ) -> list[TranslateResult]: ...

    async def list_languages(self) -> list[str]: ...
    async def list_models(self) -> list[ModelInfo]: ...