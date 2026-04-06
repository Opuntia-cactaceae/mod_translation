import json
import os
from typing import Any, Dict
from .schema import (
    ExperimentConfig,
    EvaluationConfig,
    RuntimeConfig,
    PromptConfig,
    ProtectionConfig,
    ValidationConfig,
    DatasetConfig,
)
#загрузка джсон конфигов экспериментов

def _load_file(path: str) -> Dict[str, Any]:
    ext = os.path.splitext(path)[1].lower()
    with open(path, "r", encoding="utf-8") as f:
        if ext == ".json":
            return json.load(f)
        else:
            raise ValueError(f"Unsupported file extension: {ext}. Use .json")


def _dict_to_runtime_config(data: Dict[str, Any]) -> RuntimeConfig:
    return RuntimeConfig(
        provider=data["provider"],
        model_name=data["model_name"],
        api_keys=data.get("api_keys", []),
        base_url=data.get("base_url"),
        fallback_models=data.get("fallback_models", []),
        timeout_sec=data.get("timeout_sec", 30.0),
        max_retries=data.get("max_retries", 3),
        max_requests_per_minute=data.get("max_requests_per_minute"),
        temperature=data.get("temperature", 0.0),
        max_completion_tokens=data.get("max_completion_tokens"),
    )


def _dict_to_prompt_config(data: Dict[str, Any]) -> PromptConfig:
    return PromptConfig(
        profile_name=data["profile_name"],
        system_prompt=data.get("system_prompt"),
        user_template=data.get("user_template", ""),
        batch_mode=data.get("batch_mode", False),
        expects_json_array=data.get("expects_json_array", False),
        log_prompts=data.get("log_prompts", False),
        batch_system_prompt=data.get("batch_system_prompt"),
        batch_user_template=data.get("batch_user_template"),
        single_system_prompt=data.get("single_system_prompt"),
        single_user_template=data.get("single_user_template"),
    )


def _dict_to_protection_config(data: Dict[str, Any]) -> ProtectionConfig:
    return ProtectionConfig(
        strategy_name=data["strategy_name"],
        options=data.get("options", {}),
    )


def _dict_to_validation_config(data: Dict[str, Any]) -> ValidationConfig:
    return ValidationConfig(
        validator_name=data["validator_name"],
        options=data.get("options", {}),
    )


def _dict_to_dataset_config(data: Dict[str, Any]) -> DatasetConfig:
    return DatasetConfig(
        dataset_id=data["dataset_id"],
        sqlite_path=data["sqlite_path"],
        query_mode=data.get("query_mode", "full"),
        limit=data.get("limit"),
        filters=data.get("filters", {}),
    )


def experiment_config_from_dict(data: Dict[str, Any]) -> ExperimentConfig:
    return ExperimentConfig(
        experiment_id=data["experiment_id"],
        dataset=_dict_to_dataset_config(data["dataset"]),
        runtime=_dict_to_runtime_config(data["runtime"]),
        prompt=_dict_to_prompt_config(data["prompt"]),
        protection=_dict_to_protection_config(data["protection"]),
        validation=_dict_to_validation_config(data["validation"]),
        batch_size=data.get("batch_size", 10),
        src_lang=data.get("src_lang", "en"),
        dst_lang=data.get("dst_lang", "ru"),
        use_cache=data.get("use_cache", True),
        save_raw_responses=data.get("save_raw_responses", False),
    )


def load_experiment_config(path: str) -> ExperimentConfig:
    """
    грузим конфиг эксперимента с джсона

    Args:
        path: Path to configuration file.

    Returns:
        ExperimentConfig object.
    """
    data = _load_file(path)
    return experiment_config_from_dict(data)


def evaluation_config_from_dict(data: Dict[str, Any]) -> EvaluationConfig:
    return EvaluationConfig(
        experiment_id=data["experiment_id"],
        comet_model_path=data.get("comet_model_path"),
        batch_size=data.get("batch_size", 32),
        device=data.get("device"),
    )


def load_evaluation_config(path: str) -> EvaluationConfig:
    """
    грузим конфиг оценки с джсона

    Args:
        path: Path to configuration file.

    Returns:
        EvaluationConfig object.
    """
    data = _load_file(path)
    return evaluation_config_from_dict(data)