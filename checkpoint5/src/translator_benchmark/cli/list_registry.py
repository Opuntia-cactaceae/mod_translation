from ..datasets.dataset_registry import _REGISTRY as DATASET_REGISTRY
from ..prompts.prompt_registry import _PROFILE_BUILDERS as PROMPT_BUILDERS
from ..protection.protection_registry import _STRATEGY_BUILDERS as PROTECTION_BUILDERS
from ..validation.validation_registry import _VALIDATOR_BUILDERS as VALIDATOR_BUILDERS
from ..runtime.runtime_registry import _RUNTIME_BUILDERS as RUNTIME_BUILDERS


def list_available_components() -> None:
    """ну тут все штуки что для конфигов доступны"""
    print("Available components:")
    print(f"  Prompts: {', '.join(sorted(PROMPT_BUILDERS.keys()))}")
    print(f"  Protections: {', '.join(sorted(PROTECTION_BUILDERS.keys()))}")
    print(f"  Validators: {', '.join(sorted(VALIDATOR_BUILDERS.keys()))}")
    print(f"  Runtimes: {', '.join(sorted(RUNTIME_BUILDERS.keys()))}")
    print(f"  Dataset loaders: {', '.join(sorted(DATASET_REGISTRY.keys()))}")