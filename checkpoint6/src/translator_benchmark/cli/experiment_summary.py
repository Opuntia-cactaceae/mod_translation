import sys
import logging
from ..config.settings import load_settings
from ..evaluation.unified_report_builder import (
    build_unified_experiment_report,
    format_unified_summary_as_text,
)


def experiment_summary_command(experiment_id: str) -> int:
    """
    саммари вывести по ВСЕМ метрикам

    Args:
        experiment_id: Experiment identifier.

    Returns:
        Exit code (0 = success, non‑zero = error).
    """
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

    settings = load_settings()
    db_path = settings["benchmark_db_path"]

    try:
        report = build_unified_experiment_report(db_path, experiment_id)
        if "error" in report:
            print(f"Error: {report['error']}", file=sys.stderr)
            return 1

        text = format_unified_summary_as_text(report)
        print(text)
        return 0

    except Exception as e:
        print(f"Error generating experiment summary: {e}", file=sys.stderr)
        logging.exception("Summary generation failed")
        return 1


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Show experiment summary")
    parser.add_argument("--experiment-id", required=True, help="Experiment identifier")
    args = parser.parse_args()

    sys.exit(experiment_summary_command(args.experiment_id))


if __name__ == "__main__":
    main()