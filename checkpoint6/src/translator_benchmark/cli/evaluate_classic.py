import sys
import argparse
import logging
from ..config.settings import load_settings
from ..evaluation.classic_score_runner import compute_and_save_classic_metrics
from ..storage.db import init_benchmark_db
#здесь описание команды старта анализа переведенных строчек метриками переводов

def evaluate_classic_command(experiment_id: str, with_comet: bool = False) -> int:
    """
    запуск вычисления метрик перевода

    Args:
        experiment_id: Experiment identifier.
        with_comet: Whether to compute COMET metric (optional).

    Returns:
        Exit code (0 = success, non‑zero = error).
    """
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    logger = logging.getLogger(__name__)

    try:
        settings = load_settings()
        db_path = settings["benchmark_db_path"]
        init_benchmark_db(db_path)

        print(f"Evaluating classic metrics for experiment: {experiment_id}")
        if with_comet:
            print("COMET metric computation enabled (if available)")

        metrics = compute_and_save_classic_metrics(
            db_path=db_path,
            experiment_id=experiment_id,
            with_comet=with_comet,
        )

        print("\nClassic Translation Metrics")
        print(f"Experiment ID: {experiment_id}")
        print(f"Rows scored: {metrics['num_scored_rows']} / {metrics['total_available_rows']}")

        classic = metrics["classic"]
        if classic.get("bleu") is not None:
            print(f"BLEU:  {classic['bleu']:.4f}")
        else:
            print("BLEU:  N/A")

        if classic.get("chrf") is not None:
            print(f"chrF:  {classic['chrf']:.4f}")
        else:
            print("chrF:  N/A")

        if classic.get("ter") is not None:
            print(f"TER:   {classic['ter']:.4f} (lower is better)")
        else:
            print("TER:   N/A")

        if metrics.get("comet_available"):
            comet = metrics["comet"]
            print(f"COMET: {comet['score']:.4f} (model: {comet['model']})")
        elif with_comet:
            if "comet_error" in metrics:
                print(f"COMET: Not available ({metrics['comet_error']})")
            else:
                print("COMET: Not available (COMET not installed or computation failed)")
        else:
            print("COMET: Not requested (use --with-comet to enable)")

        print("\nMetrics saved to classic_metrics table.")

        if metrics['num_scored_rows'] == 0:
            logger.warning("No rows were scored (empty references or candidates?)")
        elif metrics['num_scored_rows'] < metrics['total_available_rows']:
            logger.warning(
                f"Only {metrics['num_scored_rows']} of {metrics['total_available_rows']} rows scored "
                "(some references or candidates may be empty)"
            )

        return 0

    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except ImportError as e:
        print(f"Dependency error: {e}", file=sys.stderr)
        print("Install required dependencies: pip install sacrebleu", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Error evaluating classic metrics: {e}", file=sys.stderr)
        logger.exception("Evaluation failed")
        return 1


def main():
    parser = argparse.ArgumentParser(description="Evaluate classic translation metrics for an experiment")
    parser.add_argument("--experiment-id", required=True, help="Experiment identifier")
    parser.add_argument("--with-comet", action="store_true", help="Compute COMET metric (optional)")
    args = parser.parse_args()

    sys.exit(evaluate_classic_command(
        experiment_id=args.experiment_id,
        with_comet=args.with_comet,
    ))


if __name__ == "__main__":
    main()