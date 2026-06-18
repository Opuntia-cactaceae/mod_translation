"""DiagnosticsService — user-facing diagnostics with storage integration.

Provides:
    * add_diagnostic / add_error / add_warning helpers.
    * list_by_entity / list_by_job queries.
    * user_message mapping for known diagnostic codes.
    * Optional storage via DiagnosticsRepository.
    * Clear method for testing / reset.
"""

from typing import Any, Dict, List, Optional

from translator_app.diagnostics.models import Diagnostic, DiagnosticLevel
from translator_app.diagnostics.sanitizer import LogSanitizer


# User-facing message mappings for known diagnostic codes.
# UI uses these to display meaningful messages to the user.
USER_MESSAGE_MAP: Dict[str, str] = {
    "PLACEHOLDER_DAMAGED": "В переводе потеряны игровые переменные",
    "TRANSLATION_COUNT_MISMATCH": "Количество переведённых строк не совпадает с исходным",
    "BATCH_FAILED": "Пакетный перевод не удался, выполнена попытка поодиночного перевода",
    "FALLBACK_USED": "Выполнен резервный поодиночный перевод",
    "EMPTY_TRANSLATION": "Некоторые строки не были переведены",
    "JOB_FAILED": "Задание не выполнено из-за ошибки",
    "JOB_COMPLETED": "Задание успешно выполнено",
    "VALIDATION_ERROR": "Обнаружены ошибки валидации",
    "SERIALIZATION_ERROR": "Ошибка при записи файла",
    "RUNTIME_ERROR": "Произошла внутренняя ошибка",
    "API_KEY_MISSING": "Не указан API-ключ для выбранного провайдера",
    "MODEL_UNAVAILABLE": "Модель недоступна, попробуйте другую",
    "FILE_NOT_FOUND": "Файл не найден",
    "CACHE_MISS": "Результат не найден в кэше",
    "NO_MATCHING_UNITS": "Не найдено строк для перевода",
}


class DiagnosticsService:
    """User-facing diagnostics service.

    Stores diagnostics both in-memory and optionally in the storage
    layer when a ``DiagnosticsRepository`` is provided.
    """

    def __init__(self, diagnostics_repo: Optional[Any] = None):
        self._repo = diagnostics_repo
        self._diagnostics: List[Diagnostic] = []
        self._sanitizer = LogSanitizer()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add_diagnostic(
        self,
        level: DiagnosticLevel,
        code: str,
        message: str,
        user_message: Optional[str] = None,
        details: Optional[str] = None,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
        file_path: Optional[str] = None,
        entry_id: Optional[str] = None,
    ) -> Diagnostic:
        """Add a diagnostic entry.

        If ``user_message`` is not provided, attempts to look it up from
        the ``USER_MESSAGE_MAP`` by ``code``.
        """
        resolved_user_msg = user_message or USER_MESSAGE_MAP.get(code)

        # Sanitize the message to prevent leaking secrets
        sanitized_message = self._sanitizer.sanitize(message)

        diagnostic = Diagnostic(
            level=level,
            code=code,
            message=sanitized_message,
            user_message=resolved_user_msg,
            details=details,
            entity_type=entity_type,
            entity_id=entity_id,
            file_path=file_path,
            entry_id=entry_id or entity_id or "",
        )

        self._diagnostics.append(diagnostic)

        # Persist to storage if available
        if self._repo is not None:
            try:
                self._repo.add(diagnostic)
            except Exception:
                pass  # Don't fail if storage is unavailable

        return diagnostic

    def add_error(
        self,
        code: str,
        message: str,
        user_message: Optional[str] = None,
        details: Optional[str] = None,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
    ) -> Diagnostic:
        """Shorthand for adding an ERROR diagnostic."""
        return self.add_diagnostic(
            level=DiagnosticLevel.ERROR,
            code=code,
            message=message,
            user_message=user_message,
            details=details,
            entity_type=entity_type,
            entity_id=entity_id,
        )

    def add_warning(
        self,
        code: str,
        message: str,
        user_message: Optional[str] = None,
        details: Optional[str] = None,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
    ) -> Diagnostic:
        """Shorthand for adding a WARNING diagnostic."""
        return self.add_diagnostic(
            level=DiagnosticLevel.WARNING,
            code=code,
            message=message,
            user_message=user_message,
            details=details,
            entity_type=entity_type,
            entity_id=entity_id,
        )

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def list_by_entity(self, entity_type: str, entity_id: str) -> List[Diagnostic]:
        """Return diagnostics for a specific entity.

        If a repository is available, queries it; otherwise searches
        in-memory storage.
        """
        if self._repo is not None:
            try:
                raw = self._repo.list_by_entity(entity_id)
                return self._raw_to_diagnostics(raw)
            except Exception:
                pass
        return [
            d for d in self._diagnostics
            if d.entity_type == entity_type and d.entity_id == entity_id
        ]

    def list_by_job(self, job_id: str) -> List[Diagnostic]:
        """Return diagnostics for a specific job.

        Queries diagnostics whose entity_type matches job-like types
        or entity_id matches the job_id.
        """
        if self._repo is not None:
            try:
                raw = self._repo.list_by_entity(job_id)
                return self._raw_to_diagnostics(raw)
            except Exception:
                pass
        return [
            d for d in self._diagnostics
            if d.entity_id == job_id or d.entity_type == "job"
        ]

    def list_all(self) -> List[Diagnostic]:
        """Return all diagnostics (in-memory)."""
        return list(self._diagnostics)

    def clear(self) -> None:
        """Remove all in-memory diagnostics and clear storage if available."""
        self._diagnostics.clear()
        if self._repo is not None:
            try:
                self._repo.clear()
            except Exception:
                pass

    def get_user_message(self, code: str) -> Optional[str]:
        """Look up the user-facing message for a diagnostic code."""
        return USER_MESSAGE_MAP.get(code)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _raw_to_diagnostics(raw_list: List[Dict[str, Any]]) -> List[Diagnostic]:
        """Convert raw dict rows from repository to Diagnostic objects."""
        result = []
        for item in raw_list:
            try:
                level = DiagnosticLevel(item.get("level", "warning"))
            except ValueError:
                level = DiagnosticLevel.WARNING
            result.append(Diagnostic(
                level=level,
                code=item.get("code", ""),
                message=item.get("message", ""),
                user_message=item.get("user_message", None),
                details=item.get("details_json") or item.get("details"),
                entity_type=item.get("entity_type"),
                entity_id=item.get("entity_id"),
                entry_id=item.get("entity_id") or "",
            ))
        return result
