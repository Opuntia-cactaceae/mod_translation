import sys
import argparse
import logging
from ..config.experiment_loader import load_evaluation_config
from ..config.settings import load_settings
from ..evaluation.score_runner import evaluate_experiment, evaluate_experiment_with_config


def evaluate_experiment_command(config_path: str = None, experiment_id: str = None) -> int:
    """
    запуск расчета метрик по эксперимену, но не всех перевод и апи отдельно

    Args:
        config_path: Path to evaluation configuration file (optional if experiment_id provided).
        experiment_id: Experiment identifier (optional if config_path provided).

    Returns:
        Exit code (0 = success, non‑zero = error).
    """
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

    if not config_path and not experiment_id:
        print("Error: Either config_path or experiment_id must be provided", file=sys.stderr)
        return 1

    settings = load_settings()
    db_path = settings["benchmark_db_path"]

    try:
        if config_path:
            evaluation_config = load_evaluation_config(config_path)
            print(f"Loaded evaluation configuration for experiment: {evaluation_config.experiment_id}")
            metrics = evaluate_experiment_with_config(config_path, db_path, comet_scorer=None)
        else:
            from ..config.schema import EvaluationConfig
            evaluation_config = EvaluationConfig(
                experiment_id=experiment_id,
                comet_model_path=None,
                batch_size=32,
                device=None,
            )
            print(f"Evaluating experiment: {experiment_id}")
            metrics = evaluate_experiment(evaluation_config, db_path, comet_scorer=None)

        # Print summary
        print("\nEvaluation Results")
        print(f"Experiment ID: {metrics.get('experiment_id')}")
        print(f"Total rows evaluated: {metrics.get('total_rows_evaluated', 0)}")
        print(f"Final score mean: {metrics.get('final_score_mean', 0.0):.3f}")
        print(f"Compilability rate: {metrics.get('compilability_rate', 0.0):.3f}")
        print(f"Text score mean: {metrics.get('text_score_mean', 0.0):.3f}")
        print(f"Tag content score mean: {metrics.get('tag_content_score_mean', 0.0):.3f}")
        print(f"Tag structure score mean: {metrics.get('tag_structure_score_mean', 0.0):.3f}")
        print(f"Success rate: {metrics.get('success_rate', 0.0):.3f}")
        print(f"Fallback rate: {metrics.get('fallback_rate', 0.0):.3f}")
        print(f"Avg latency ms: {metrics.get('avg_latency_ms', 0.0):.1f}")
        print("Metrics saved to database.")
        return 0

    except Exception as e:
        print(f"Error evaluating experiment: {e}", file=sys.stderr)
        logging.exception("Evaluation failed")
        return 1


def main():
    parser = argparse.ArgumentParser(description="Evaluate an experiment")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--config", help="Path to evaluation configuration JSON")
    group.add_argument("--experiment-id", help="Experiment identifier")
    args = parser.parse_args()

    sys.exit(evaluate_experiment_command(config_path=args.config, experiment_id=args.experiment_id))


if __name__ == "__main__":
    main()