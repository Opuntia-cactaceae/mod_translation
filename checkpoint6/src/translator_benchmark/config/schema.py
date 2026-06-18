from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any


@dataclass
class RuntimeConfig:
    provider: str
    model_name: str
    api_keys: List[str]
    base_url: Optional[str] = None
    fallback_models: List[str] = field(default_factory=list)
    timeout_sec: float = 30.0
    max_retries: int = 3
    max_requests_per_minute: Optional[int] = None
    temperature: float = 0.0
    max_completion_tokens: Optional[int] = None


@dataclass
class PromptConfig:
    profile_name: str
    system_prompt: Optional[str] = None
    user_template: str = ""
    batch_mode: bool = False
    expects_json_array: bool = False
    log_prompts: bool = False
    batch_system_prompt: Optional[str] = None
    batch_user_template: Optional[str] = None
    single_system_prompt: Optional[str] = None
    single_user_template: Optional[str] = None


@dataclass
class ProtectionConfig:
    strategy_name: str
    options: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ValidationConfig:
    validator_name: str
    options: Dict[str, Any] = field(default_factory=dict)


@dataclass
class DatasetConfig:
    dataset_id: str
    sqlite_path: str
    query_mode: str = "full"
    limit: Optional[int] = None
    filters: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ExperimentConfig:
    experiment_id: str
    dataset: DatasetConfig
    runtime: RuntimeConfig
    prompt: PromptConfig
    protection: ProtectionConfig
    validation: ValidationConfig
    batch_size: int = 10
    src_lang: str = "en"
    dst_lang: str = "ru"
    use_cache: bool = True
    save_raw_responses: bool = False


@dataclass
class EvaluationConfig:
    experiment_id: str
    comet_model_path: Optional[str] = None
    batch_size: int = 32
    device: Optional[str] = None