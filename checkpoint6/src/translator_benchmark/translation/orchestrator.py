import time
import logging
from typing import List, Dict, Any
from ..config.schema import ExperimentConfig
from ..domain.entities import DatasetRow, ProtectedText
from ..domain.results import RowProcessingResult
from ..storage.experiment_repository import create_experiment_run
from ..storage.result_repository import save_row_processing_result, save_runtime_attempt
from ..datasets.dataset_registry import get_dataset_loader
from ..runtime.runtime_registry import get_runtime
from ..prompts.prompt_registry import get_prompt_profile
from ..protection.protection_registry import get_protection_strategy
from ..validation.validation_registry import get_response_validator
from .batch_processor import BatchProcessor
from .single_processor import SingleProcessor


logger = logging.getLogger(__name__)


#то зачем это все затевалось
#орк_естратор эксперимента: загружает датасет, инициализирует компоненты, обрабатывает батчи и сохраняет результаты
#и все по конфигу
class ExperimentOrchestrator:

    def __init__(self, config: ExperimentConfig, db_path: str):
        """
        Args:
            config: Experiment configuration.
            db_path: Path to benchmark SQLite database (for results).
        """
        self.config = config
        self.db_path = db_path
        self._runtime = None
        self._prompt_profile = None
        self._protection_strategy = None
        self._validator = None
        self._dataset_loader = None

    def _initialize_components(self):
        self._dataset_loader = get_dataset_loader("sqlite")

        self._runtime = get_runtime(self.config.runtime)

        self._prompt_profile = get_prompt_profile(self.config.prompt)

        self._protection_strategy = get_protection_strategy(self.config.protection)

        self._validator = get_response_validator(self.config.validation)

    def run(self) -> Dict[str, Any]:
        """
        Returns:
            Summary dict with experiment_id, row counts, success/failure stats.
        """
        logger.info(f"Starting experiment {self.config.experiment_id}")
        start_time = time.time()

        self._initialize_components()

        rows = self._dataset_loader.load_rows(self.config.dataset)
        logger.info(f"Loaded {len(rows)} rows from dataset {self.config.dataset.dataset_id}")

        protected_texts = self._protect_rows(rows)
        logger.info(f"Protected {len(protected_texts)} texts")

        experiment_run = self._create_experiment_run()
        create_experiment_run(self.db_path, experiment_run)

        batch_size = self.config.batch_size
        batches = self._split_into_batches(rows, protected_texts, batch_size)

        total_results = []
        total_attempts = []
        for i, (batch_rows, batch_protected) in enumerate(batches):
            logger.info(f"Processing batch {i+1}/{len(batches)} ({len(batch_rows)} rows)")
            batch_results, batch_attempts = self._process_batch(batch_rows, batch_protected)
            total_results.extend(batch_results)
            total_attempts.extend(batch_attempts)

        for result in total_results:
            save_row_processing_result(self.db_path, self.config.experiment_id, result)

        for attempt in total_attempts:
            row_ids = attempt.get("row_ids", [attempt.get("row_id")])
            if isinstance(row_ids, list):
                for row_id in row_ids:
                    save_runtime_attempt(self.db_path, self.config.experiment_id, row_id, attempt)
            else:
                save_runtime_attempt(self.db_path, self.config.experiment_id, row_ids, attempt)

        elapsed = time.time() - start_time
        summary = self._compute_summary(total_results, total_attempts, elapsed)
        logger.info(f"Experiment {self.config.experiment_id} completed in {elapsed:.1f}s")
        logger.info(f"Summary: {summary}")

        return summary

    def _protect_rows(self, rows: List[DatasetRow]) -> List[ProtectedText]:
        protected = []
        for row in rows:
            protected_obj = self._protection_strategy.protect(row.source_text)
            protected.append(ProtectedText(
                original_text=protected_obj.original_text,
                protected_text=protected_obj.protected_text,
                protection_state=protected_obj.protection_state,
                reference_text=row.reference_text,
            ))
        return protected

    def _create_experiment_run(self):
        from ..domain.entities import ExperimentRun
        config_dict = {
            "experiment_id": self.config.experiment_id,
            "dataset": {
                "dataset_id": self.config.dataset.dataset_id,
                "sqlite_path": self.config.dataset.sqlite_path,
                "query_mode": self.config.dataset.query_mode,
                "limit": self.config.dataset.limit,
                "filters": self.config.dataset.filters,
            },
            "runtime": {
                "provider": self.config.runtime.provider,
                "model_name": self.config.runtime.model_name,
                "api_keys": ["***"],  # hide keys
                "fallback_models": self.config.runtime.fallback_models,
                "timeout_sec": self.config.runtime.timeout_sec,
                "max_retries": self.config.runtime.max_retries,
                "max_requests_per_minute": self.config.runtime.max_requests_per_minute,
                "temperature": self.config.runtime.temperature,
                "max_completion_tokens": self.config.runtime.max_completion_tokens,
            },
            "prompt": {
                "profile_name": self.config.prompt.profile_name,
                "system_prompt": self.config.prompt.system_prompt,
                "user_template": self.config.prompt.user_template,
                "batch_mode": self.config.prompt.batch_mode,
                "expects_json_array": self.config.prompt.expects_json_array,
                "log_prompts": self.config.prompt.log_prompts,
                "batch_system_prompt": self.config.prompt.batch_system_prompt,
                "batch_user_template": self.config.prompt.batch_user_template,
                "single_system_prompt": self.config.prompt.single_system_prompt,
                "single_user_template": self.config.prompt.single_user_template,
            },
            "protection": {
                "strategy_name": self.config.protection.strategy_name,
                "options": self.config.protection.options,
            },
            "validation": {
                "validator_name": self.config.validation.validator_name,
                "options": self.config.validation.options,
            },
            "batch_size": self.config.batch_size,
            "src_lang": self.config.src_lang,
            "dst_lang": self.config.dst_lang,
            "use_cache": self.config.use_cache,
            "save_raw_responses": self.config.save_raw_responses,
        }
        return ExperimentRun(
            experiment_id=self.config.experiment_id,
            config_snapshot=config_dict,
            created_at=time.strftime("%Y-%m-%d %H:%M:%S"),
        )

    def _split_into_batches(self, rows: List[DatasetRow], protected_texts: List[ProtectedText],
                            batch_size: int) -> List[tuple[List[DatasetRow], List[ProtectedText]]]:
        batches = []
        for i in range(0, len(rows), batch_size):
            batch_rows = rows[i:i + batch_size]
            batch_protected = protected_texts[i:i + batch_size]
            batches.append((batch_rows, batch_protected))
        return batches

    def _process_batch(self, batch_rows: List[DatasetRow],
                       batch_protected: List[ProtectedText]) -> tuple[List[RowProcessingResult], List[Dict[str, Any]]]:
        processor = BatchProcessor(
            runtime=self._runtime,
            validator=self._validator,
            protection_strategy=self._protection_strategy,
            prompt_profile=self._prompt_profile,
            src_lang=self.config.src_lang,
            dst_lang=self.config.dst_lang,
            experiment_id=self.config.experiment_id,
            db_path=self.db_path,
            max_retries=self.config.runtime.max_retries,
        )
        row_ids = [row.row_id for row in batch_rows]
        return processor.process_batch(row_ids, batch_protected)

    def _compute_summary(self, results: List[RowProcessingResult],
                         attempts: List[Dict[str, Any]], elapsed: float) -> Dict[str, Any]:
        total_rows = len(results)
        success_count = sum(1 for r in results if r.status == "completed")
        failed_count = sum(1 for r in results if r.status == "failed")
        pending_fallback = sum(1 for r in results if r.status == "pending_fallback")
        total_attempts = len(attempts)
        retry_count = sum(1 for a in attempts if a.get("retry_reason"))
        repair_applied = sum(1 for a in attempts if a.get("repair_applied"))
        fallback_used = sum(1 for a in attempts if a.get("fallback_triggered"))

        return {
            "experiment_id": self.config.experiment_id,
            "total_rows": total_rows,
            "success_count": success_count,
            "failed_count": failed_count,
            "pending_fallback": pending_fallback,
            "total_attempts": total_attempts,
            "retry_count": retry_count,
            "repair_applied": repair_applied,
            "fallback_used": fallback_used,
            "elapsed_seconds": round(elapsed, 2),
        }


def run_experiment(config: ExperimentConfig, db_path: str) -> Dict[str, Any]:
    """
    Args:
        config: Experiment configuration.
        db_path: Path to benchmark SQLite database.

    Returns:
        Summary dict.
    """
    orchestrator = ExperimentOrchestrator(config, db_path)
    return orchestrator.run()