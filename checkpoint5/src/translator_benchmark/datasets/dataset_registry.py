from typing import Dict
from .base import DatasetLoader
from .sqlite_loader import SqliteDatasetLoader
from ..config.schema import DatasetConfig

_REGISTRY: Dict[str, DatasetLoader] = {
    "sqlite": SqliteDatasetLoader(),
}


def get_dataset_loader(name: str) -> DatasetLoader:
    """
    загрузчик по имени

    Args:
        name: Loader name (e.g., "sqlite").

    Returns:
        DatasetLoader instance.

    Raises:
        KeyError: If loader name is not registered.
    """
    if name not in _REGISTRY:
        raise KeyError(f"Dataset loader '{name}' not found. Available: {list(_REGISTRY.keys())}")
    return _REGISTRY[name]


def register_dataset_loader(name: str, loader: DatasetLoader) -> None:
    """
    Args:
        name: Loader name.
        loader: Loader instance.
    """
    _REGISTRY[name] = loader