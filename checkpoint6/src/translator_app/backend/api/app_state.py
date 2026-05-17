"""App state endpoint - aggregates settings, jobs, and available options."""

from fastapi import APIRouter, Depends

from translator_app.backend.schemas.common import AppStateResponse
from translator_app.backend.deps import Services, get_services

router = APIRouter(tags=["app-state"])


@router.get("/app-state", response_model=AppStateResponse)
def get_app_state(svcs: Services = Depends(get_services)):
    """Gather overall application state."""
    settings = svcs.settings.settings
    active_jobs = svcs.jobs.list_jobs()
    file_types = svcs.registry.detector_names
    strategies = {
        "detectors": svcs.registry.detector_names,
        "parsers": svcs.registry.parser_names,
        "serializers": svcs.registry.serializer_names,
        "validators": svcs.registry.validator_names,
    }

    warnings = []
    if not svcs.secrets.list_names():
        warnings.append("No API keys configured")

    return AppStateResponse(
        settings=svcs.settings.export_settings(),
        active_jobs=[j.id for j in active_jobs if j.status.value == "running"],
        available_file_types=list(file_types),
        available_strategies=strategies,
        warnings=warnings,
    )
