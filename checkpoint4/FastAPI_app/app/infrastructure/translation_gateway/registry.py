from __future__ import annotations

from typing import List

from app.infrastructure.translation_gateway.interfaces import ModelRoutedTranslator
from app.settings import settings


def build_translators() -> List[ModelRoutedTranslator]:
    """
    Purpose:
        Composition root для translators (провайдеров перевода).

    Output:
        List[ModelRoutedTranslator] — список конкретных реализаций провайдеров.

    Notes:
        - Здесь единственное место, где мы импортируем конкретные провайдеры (GroqTranslator и т.п.).
    """
    from app.infrastructure.translation_gateway.translators.groq_translator import GroqTranslator

    return [
        GroqTranslator(
            models_csv=settings.groq_models,
            languages_csv=settings.groq_languages,
            max_attempts=settings.groq_max_attempts,
            backoff_base_seconds=settings.groq_backoff_base_seconds,
            backoff_max_seconds=settings.groq_backoff_max_seconds,
            rate_limit_tps=settings.groq_rate_limit_tps,
            default_api_keys=None,
        ),
    ]