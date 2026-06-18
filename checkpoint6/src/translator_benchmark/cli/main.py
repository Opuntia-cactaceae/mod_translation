import argparse
import sys
from . import run_experiment, evaluate_experiment, list_registry

#на что я скрипты с аргументами командной строки не люблю, но проще так несколько инстансов скрипта держать
def main() -> None:
    parser = argparse.ArgumentParser(
        prog="translator-benchmark",
        description="Benchmark system for comparing LLMs, prompts, protection strategies, and validation strategies.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run-experiment", help="Run a translation experiment")
    run_parser.add_argument("config_path", help="Path to experiment configuration YAML/JSON")

    eval_parser = subparsers.add_parser("evaluate-experiment", help="Evaluate an experiment")
    eval_group = eval_parser.add_mutually_exclusive_group(required=True)
    eval_group.add_argument("--config", help="Path to evaluation configuration JSON")
    eval_group.add_argument("--experiment-id", help="Experiment identifier")

    summary_parser = subparsers.add_parser("experiment-summary", help="Show experiment summary")
    summary_parser.add_argument("--experiment-id", required=True, help="Experiment identifier")

    leaderboard_parser = subparsers.add_parser("leaderboard", help="Show leaderboard of experiments")
    leaderboard_parser.add_argument("--limit", type=int, help="Limit number of experiments")

    api_summary_parser = subparsers.add_parser("api-summary", help="Show API/LLM response reliability summary")
    api_summary_parser.add_argument("--experiment-id", required=True, help="Experiment identifier")

    classic_eval_parser = subparsers.add_parser("evaluate-classic", help="Evaluate classic translation metrics (BLEU, chrF, TER)")
    classic_eval_parser.add_argument("--experiment-id", required=True, help="Experiment identifier")
    classic_eval_parser.add_argument("--with-comet", action="store_true", help="Compute COMET metric (optional)")

    classic_summary_parser = subparsers.add_parser("classic-summary", help="Show classic translation metrics summary")
    classic_summary_parser.add_argument("--experiment-id", required=True, help="Experiment identifier")

    subparsers.add_parser("list-registry", help="List available components")

    args = parser.parse_args()

    if args.command == "run-experiment":
        sys.exit(run_experiment.run_experiment_command(args.config_path))
    elif args.command == "evaluate-experiment":
        sys.exit(evaluate_experiment.evaluate_experiment_command(
            config_path=args.config, experiment_id=args.experiment_id
        ))
    elif args.command == "experiment-summary":
        from .experiment_summary import experiment_summary_command
        sys.exit(experiment_summary_command(args.experiment_id))
    elif args.command == "leaderboard":
        from .leaderboard import leaderboard_command
        sys.exit(leaderboard_command(args.limit))
    elif args.command == "api-summary":
        from .api_summary import api_summary_command
        sys.exit(api_summary_command(args.experiment_id))
    elif args.command == "evaluate-classic":
        from .evaluate_classic import evaluate_classic_command
        sys.exit(evaluate_classic_command(
            experiment_id=args.experiment_id,
            with_comet=args.with_comet,
        ))
    elif args.command == "classic-summary":
        from .classic_summary import classic_summary_command
        sys.exit(classic_summary_command(args.experiment_id))
    elif args.command == "list-registry":
        list_registry.list_available_components()
        sys.exit(0)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()