"""Games options API endpoints."""

from fastapi import APIRouter

from translator_app.backend.schemas.games import (
    FileHandlerOptionSchema,
    GameOptionSchema,
    GamesOptionsResponse,
)
from translator_app.games.registry import list_file_handlers, list_games

router = APIRouter(tags=["games"])


@router.get("/games/options", response_model=GamesOptionsResponse)
def get_games_options():
    """Return available game adapters and file handlers."""
    games_raw = list_games()
    handlers_raw = list_file_handlers()

    return GamesOptionsResponse(
        games=[GameOptionSchema(**g) for g in games_raw],
        file_handlers=[FileHandlerOptionSchema(**h) for h in handlers_raw],
    )
