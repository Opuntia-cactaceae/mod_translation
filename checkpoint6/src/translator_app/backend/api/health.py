"""Health check endpoint."""

from fastapi import APIRouter

from translator_app.backend.schemas.common import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def get_health():
    """Return health status of the backend API."""
    return HealthResponse(status="ok", app_version="0.1.0", backend_ready=True)


# Backward-compatible function export
get_health_handler = get_health
