"""Game adapter registry — maps game identifiers to GameAdapter instances."""

from typing import Dict, List, Optional

from translator_app.games.base import GameAdapter
from translator_app.games.stellaris.adapter import StellarisAdapter
from translator_app.games.generic.adapter import GenericAdapter

# ---------------------------------------------------------------------------
#  Feature constants — canonical capability names
# ---------------------------------------------------------------------------

FEATURE_MOD_DISCOVERY = "mod_discovery"
FEATURE_DESCRIPTORS = "descriptors"
FEATURE_INSTALL = "install"
FEATURE_TRANSLATION_PREVIEW = "translation_preview"
FEATURE_FILE_GROUPING = "file_grouping"
FEATURE_OUTPUT_MANAGEMENT = "output_management"
FEATURE_CACHE_CLEANING = "cache_cleaning"
FEATURE_GENERIC_FILE_SCAN = "generic_file_scan"

# ---------------------------------------------------------------------------
#  Registry metadata — single source of truth for game & handler info
# ---------------------------------------------------------------------------

_GAMES: List[Dict[str, object]] = [
    {
        "id": "stellaris",
        "label": "Stellaris",
        "vendor": "Paradox Interactive",
        "features": {
            FEATURE_MOD_DISCOVERY: True,
            FEATURE_DESCRIPTORS: True,
            FEATURE_INSTALL: True,
            FEATURE_TRANSLATION_PREVIEW: True,
            FEATURE_FILE_GROUPING: True,
            FEATURE_OUTPUT_MANAGEMENT: True,
            FEATURE_CACHE_CLEANING: True,
            FEATURE_GENERIC_FILE_SCAN: False,
        },
        "file_handlers": ["stellaris_localisation"],
    },
    {
        "id": "generic",
        "label": "Other Game",
        "vendor": None,
        "features": {
            FEATURE_MOD_DISCOVERY: False,
            FEATURE_DESCRIPTORS: False,
            FEATURE_INSTALL: False,
            FEATURE_TRANSLATION_PREVIEW: True,
            FEATURE_FILE_GROUPING: False,
            FEATURE_OUTPUT_MANAGEMENT: True,
            FEATURE_CACHE_CLEANING: False,
            FEATURE_GENERIC_FILE_SCAN: True,
        },
        "file_handlers": ["plain_text", "json", "yaml"],
    },
]

# ---------------------------------------------------------------------------
#  Backward-compatible helpers — derive old supports_* from features
# ---------------------------------------------------------------------------

_FEATURE_TO_OLD_FIELD: Dict[str, str] = {
    FEATURE_MOD_DISCOVERY: "supports_mod_discovery",
    FEATURE_DESCRIPTORS: "supports_descriptors",
    FEATURE_INSTALL: "supports_install",
}


def _with_compat_fields(game: Dict[str, object]) -> Dict[str, object]:
    """Return a copy of *game* with legacy ``supports_*`` fields computed
    from the canonical ``features`` dict."""
    result = dict(game)
    features: Dict[str, bool] = dict(game.get("features", {}))  # type: ignore[arg-type]
    for feature_key, old_field in _FEATURE_TO_OLD_FIELD.items():
        result[old_field] = features.get(feature_key, False)
    return result

_FILE_HANDLERS: List[Dict[str, object]] = [
    {
        "id": "plain_text",
        "label": "Plain text",
        "extensions": [".txt"],
        "description": "Translate each line as a separate string",
    },
    {
        "id": "json",
        "label": "JSON",
        "extensions": [".json"],
        "description": "Translate string leaf values in JSON",
    },
    {
        "id": "yaml",
        "label": "YAML",
        "extensions": [".yml", ".yaml"],
        "description": "Translate string leaf values in YAML",
    },
    {
        "id": "stellaris_localisation",
        "label": "Stellaris Localisation",
        "extensions": [".yml", ".yaml"],
        "description": "Stellaris-style localisation files",
    },
]


def list_games() -> List[Dict[str, object]]:
    """Return metadata for all registered game adapters.

    Each game dict includes both the canonical ``features`` dict and the
    legacy ``supports_*`` fields (derived from ``features``) for backward
    compatibility.
    """
    return [_with_compat_fields(g) for g in _GAMES]


def list_file_handlers(game: Optional[str] = None) -> List[Dict[str, object]]:
    """Return metadata for registered file handlers.

    Args:
        game: If provided, only return handlers supported by this game.

    Returns:
        A list of handler metadata dicts.
    """
    if game is not None:
        supported_ids: set = set()
        for g in _GAMES:
            if g["id"] == game:
                supported_ids = set(g["file_handlers"])  # type: ignore[arg-type]
                break
        return [h for h in _FILE_HANDLERS if h["id"] in supported_ids]
    return list(_FILE_HANDLERS)


def get_adapter(game: str, file_handler: Optional[str] = None) -> GameAdapter:
    """Return the GameAdapter for a given game identifier.

    Args:
        game: Game name, e.g. "stellaris" or "generic".
        file_handler: Optional handler name for the generic adapter
                      ("plain_text", "json", "yaml").

    Returns:
        A GameAdapter instance.

    Raises:
        ValueError: If the game is unknown.
    """
    if game == "stellaris":
        return StellarisAdapter()
    if game == "generic":
        return GenericAdapter(file_handler=file_handler)
    raise ValueError(f"Unknown game: {game}")


def get_adapter_or_none(game: str) -> Optional[GameAdapter]:
    """Return the GameAdapter or None if the game is unknown.

    Unlike get_adapter, this never raises — useful for fallback logic.
    """
    try:
        return get_adapter(game)
    except ValueError:
        return None
