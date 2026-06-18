"""Logs and Diagnostics API endpoints.

Provides:
    GET /api/logs/recent                       — recent log entries
    GET /api/logs/jobs/{job_id}                — logs for a specific job
    GET /api/logs/errors                       — all ERROR/CRITICAL entries
    GET /api/diagnostics/{entity_type}/{entity_id}  — diagnostics by entity
"""

from fastapi import APIRouter

from translator_app.backend.deps import get_services

router = APIRouter(tags=["logs", "diagnostics"])


# ------------------------------------------------------------------
# Logs
# ------------------------------------------------------------------


@router.get("/api/logs/recent")
def get_logs_recent(limit: int = 50):
    """Return the most recent log entries."""
    svc = get_services()
    entries = svc.logging.get_recent(limit=limit)
    return {
        "entries": [_log_entry_to_dict(e) for e in entries],
        "count": len(entries),
    }


@router.get("/api/logs/jobs/{job_id}")
def get_logs_by_job(job_id: str):
    """Return log entries for a specific job."""
    svc = get_services()
    entries = svc.logging.get_by_job(job_id)
    return {
        "job_id": job_id,
        "entries": [_log_entry_to_dict(e) for e in entries],
        "count": len(entries),
    }


@router.get("/api/logs/errors")
def get_logs_errors():
    """Return all ERROR and CRITICAL log entries."""
    svc = get_services()
    entries = svc.logging.get_errors()
    return {
        "entries": [_log_entry_to_dict(e) for e in entries],
        "count": len(entries),
    }


# ------------------------------------------------------------------
# Diagnostics
# ------------------------------------------------------------------


@router.get("/api/diagnostics/{entity_type}/{entity_id}")
def get_diagnostics(entity_type: str, entity_id: str):
    """Return diagnostics for a specific entity."""
    svc = get_services()
    diagnostics = svc.diagnostics.list_by_entity(entity_type, entity_id)
    return {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "diagnostics": [_diagnostic_to_dict(d) for d in diagnostics],
        "count": len(diagnostics),
    }


# ------------------------------------------------------------------
# Serialization helpers
# ------------------------------------------------------------------


def _log_entry_to_dict(entry) -> dict:
    return {
        "timestamp": entry.timestamp.isoformat() if entry.timestamp else None,
        "level": entry.level.value if hasattr(entry.level, "value") else str(entry.level),
        "module": entry.module,
        "message": entry.message,
        "context": entry.context,
        "job_id": entry.job_id,
        "file_id": entry.file_id,
        "unit_id": entry.unit_id,
    }


def _diagnostic_to_dict(diag) -> dict:
    return {
        "level": diag.level.value if hasattr(diag.level, "value") else str(diag.level),
        "code": diag.code,
        "message": diag.message,
        "user_message": diag.user_message,
        "details": diag.details,
        "entity_type": diag.entity_type,
        "entity_id": diag.entity_id,
    }
