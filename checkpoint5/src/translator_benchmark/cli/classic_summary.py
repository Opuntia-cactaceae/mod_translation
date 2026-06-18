import sys
import argparse
import logging
from ..config.settings import load_settings
from ..storage.classic_metric_repository import load_classic_metrics

#здесь описание команды вызова просмотра инфы по экспериментам
def classic_summary_command(experiment_id: str) -> int:
    """
    Дефолт метрики по моему мнению

    Args:
        experiment_id: Experiment identifier.

    Returns:
        Exit code (0 = success, non‑zero = error).
    """
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    logger = logging.getLogger(__name__)

    try:
        settings = load_settings()
        db_path = settings["benchmark_db_path"]

        print(f"Classic metrics summary for experiment: {experiment_id}")

        metrics = load_classic_metrics(db_path, experiment_id)
        if not metrics:
            print(f"No classic metrics found for experiment {experiment_id}")
            print("Run 'translator-benchmark evaluate-classic --experiment-id {experiment_id}' first")
            return 1

        print("\nClassic Translation Metrics")
        print(f"Experiment ID: {experiment_id}")
        print(f"Rows scored: {metrics['num_scored_rows']}")
        print(f"Computed at: {metrics['created_at']}")

        print("\nScores:")
        if metrics.get("bleu") is not None:
            print(f"  BLEU:  {metrics['bleu']:.4f}")
        else:
            print("  BLEU:  N/A")

        if metrics.get("chrf") is not None:
            print(f"  chrF:  {metrics['chrf']:.4f}")
        else:
            print("  chrF:  N/A")

        if metrics.get("ter") is not None:
            print(f"  TER:   {metrics['ter']:.4f} (lower is better)")
        else:
            print("  TER:   N/A")

        if metrics.get("comet") is not None:
            print(f"  COMET: {metrics['comet']:.4f}")
        else:
            print("  COMET: Not computed or unavailable")

        print("\nNote:")
        print("- BLEU, chrF, TER computed at corpus level using sacrebleu")
        print("- COMET is optional and may not be available")
        print("- Only rows with non-empty reference and candidate texts are scored")

        return 0

    except Exception as e:
        print(f"Error retrieving classic metrics: {e}", file=sys.stderr)
        logger.exception("Summary failed")
        return 1


def main():
    parser = argparse.ArgumentParser(description="Show classic translation metrics summary")
    parser.add_argument("--experiment-id", required=True, help="Experiment identifier")
    args = parser.parse_args()

    sys.exit(classic_summary_command(experiment_id=args.experiment_id))


if __name__ == "__main__":
    main()