import sys
import logging
from ..config.settings import load_settings
from ..evaluation.report_builder import (
    build_extended_leaderboard_report,
    format_extended_leaderboard_as_text,
)


def leaderboard_command(limit: int = None) -> int:
    """
    лидерборд по метрикам перевода и апи

    Args:
        limit: Optional limit on number of experiments.

    Returns:
        Exit code (0 = success, non‑zero = error).
    """
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

    settings = load_settings()
    db_path = settings["benchmark_db_path"]

    try:
        leaderboard = build_extended_leaderboard_report(db_path, limit)
        text = format_extended_leaderboard_as_text(leaderboard)
        print(text)
        return 0

    except Exception as e:
        print(f"Error generating leaderboard: {e}", file=sys.stderr)
        logging.exception("Leaderboard generation failed")
        return 1


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Show leaderboard of experiments")
    parser.add_argument("--limit", type=int, help="Limit number of experiments")
    args = parser.parse_args()

    sys.exit(leaderboard_command(args.limit))


if __name__ == "__main__":
    main()