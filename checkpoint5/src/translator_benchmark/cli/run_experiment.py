import sys
import logging
from ..config.experiment_loader import load_experiment_config
from ..config.settings import load_settings
from ..storage.db import init_benchmark_db
from ..translation.orchestrator import run_experiment


def run_experiment_command(config_path: str) -> int:
    """
    Запуск с конфига (процесса перевода)

    Args:
        config_path: Path to experiment configuration file.

    Returns:
        Exit code (0 = success, non‑zero = error).
    """
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    logger = logging.getLogger(__name__)

    try:
        config = load_experiment_config(config_path)
        logger.info(f"Loaded experiment configuration: {config.experiment_id}")
        logger.info(f"Dataset: {config.dataset.dataset_id}")
        logger.info(f"Model: {config.runtime.model_name}")
        logger.info(f"Prompt profile: {config.prompt.profile_name}")
        logger.info(f"Protection: {config.protection.strategy_name}")
        logger.info(f"Validation: {config.validation.validator_name}")

        settings = load_settings()
        db_path = settings["benchmark_db_path"]
        logger.info(f"Using benchmark database: {db_path}")

        init_benchmark_db(db_path)
        logger.info("Database initialized")

        summary = run_experiment(config, db_path)

        # Print summary
        print("\nExperiment Summary")
        print(f"Experiment ID: {summary['experiment_id']}")
        print(f"Total rows: {summary['total_rows']}")
        print(f"Success count: {summary['success_count']}")
        print(f"Failed count: {summary['failed_count']}")
        print(f"Pending fallback: {summary['pending_fallback']}")
        print(f"Total attempts: {summary['total_attempts']}")
        print(f"Retry count: {summary['retry_count']}")
        print(f"Repair applied: {summary['repair_applied']}")
        print(f"Fallback used: {summary['fallback_used']}")
        print(f"Elapsed seconds: {summary['elapsed_seconds']}")

        return 0
    except Exception as e:
        logger.exception("Experiment failed")
        print(f"Error running experiment: {e}", file=sys.stderr)
        return 1