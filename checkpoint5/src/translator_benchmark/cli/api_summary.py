import sys
import logging
from ..config.settings import load_settings
from ..evaluation.api_metrics_runner import compute_and_save_api_metrics
#здесь описание команды вызова просмотра метрик по апи ллмок

def format_api_metrics_as_text(metrics: dict) -> str:
    """Format API reliability metrics as readable text."""
    lines = []
    lines.append(f"API Reliability Summary for experiment: {metrics['experiment_id']}")
    lines.append("")

    lines.append("Row Statistics:")
    lines.append(f"  Total rows: {metrics['total_rows']}")
    lines.append(f"  Successful rows: {metrics['successful_rows']}")
    lines.append(f"  Failed rows: {metrics['failed_rows']}")
    lines.append(f"  Success rate: {metrics['successful_rows'] / metrics['total_rows'] * 100:.1f}%"
                 if metrics['total_rows'] > 0 else "  Success rate: N/A")
    lines.append("")

    lines.append("API Calls & Attempts:")
    lines.append(f"  Total API calls: {metrics['total_api_calls']}")
    lines.append(f"  Total attempts (sum of row attempts): {metrics['total_attempts']}")
    lines.append(f"  Retry count: {metrics['retry_count']}")
    lines.append(f"  Fallback count: {metrics['fallback_count']}")
    lines.append("")

    lines.append("Response Outcome Breakdown:")
    lines.append(f"  Accepted without retry: {metrics['accepted_without_retry_count']}")
    lines.append(f"  Accepted after retry: {metrics['accepted_after_retry_count']}")
    lines.append(f"  Format repair applied: {metrics['repair_applied_count']}")
    lines.append(f"  Fallback to single: {metrics['fallback_count']}")
    lines.append("")

    lines.append("Operational Error Breakdown:")
    lines.append(f"  Transport errors: {metrics['transport_error_count']}")
    lines.append(f"  Timeouts: {metrics['timeout_count']}")
    lines.append(f"  Rate limits: {metrics['rate_limit_count']}")
    lines.append(f"  Empty responses: {metrics['empty_response_count']}")
    lines.append(f"  Invalid JSON: {metrics['invalid_json_count']}")
    lines.append(f"  Invalid batch shape: {metrics['invalid_batch_shape_count']}")
    lines.append(f"  Wrong item count: {metrics['wrong_item_count_count']}")
    lines.append(f"  Missing content: {metrics['missing_content_count']}")
    lines.append(f"  Unknown errors: {metrics['unknown_error_count']}")
    lines.append("")

    lines.append("Token Usage:")
    lines.append(f"  Total input tokens: {metrics['total_input_tokens'] or 'N/A'}")
    lines.append(f"  Total output tokens: {metrics['total_output_tokens'] or 'N/A'}")
    lines.append(f"  Total tokens: {metrics['total_tokens'] or 'N/A'}")
    if metrics['successful_rows'] > 0:
        lines.append(f"  Avg input tokens per success: {metrics['avg_input_tokens_per_success']:.1f}")
        lines.append(f"  Avg output tokens per success: {metrics['avg_output_tokens_per_success']:.1f}")
        lines.append(f"  Avg total tokens per success: {metrics['avg_total_tokens_per_success']:.1f}")
    else:
        lines.append("  Avg tokens per success: N/A")
    lines.append("")

    if metrics.get('estimated_source_payload_tokens') is not None:
        lines.append("Token Efficiency (local estimates):")
        lines.append(f"  Estimated source payload tokens: {metrics['estimated_source_payload_tokens']}")
        lines.append(f"  Estimated prompt shell tokens: {metrics['estimated_prompt_shell_tokens']}")
        if metrics.get('input_overhead_ratio') is not None:
            lines.append(f"  Input overhead ratio: {metrics['input_overhead_ratio']:.3f}")
        if metrics.get('full_cost_ratio') is not None:
            lines.append(f"  Full cost ratio: {metrics['full_cost_ratio']:.3f}")
        if metrics.get('payload_to_total_input_ratio') is not None:
            lines.append(f"  Payload to total input ratio: {metrics['payload_to_total_input_ratio']:.3f}")
        if metrics.get('prompt_shell_ratio') is not None:
            lines.append(f"  Prompt shell ratio: {metrics['prompt_shell_ratio']:.3f}")
        if metrics.get('token_efficiency_note'):
            lines.append(f"  Note: {metrics['token_efficiency_note']}")
        lines.append("")

    if metrics['total_api_calls'] > 0:
        lines.append("Derived Rates (based on API calls):")
        lines.append(f"  Retry rate: {metrics['retry_count'] / metrics['total_api_calls'] * 100:.1f}%")
        lines.append(f"  Fallback rate: {metrics['fallback_count'] / metrics['total_api_calls'] * 100:.1f}%")
        lines.append(f"  Repair rate: {metrics['repair_applied_count'] / metrics['total_api_calls'] * 100:.1f}%")
        lines.append(f"  Operational error rate: "
                     f"{(metrics['transport_error_count'] + metrics['timeout_count'] + metrics['rate_limit_count'] + metrics['empty_response_count'] + metrics['invalid_json_count'] + metrics['invalid_batch_shape_count'] + metrics['wrong_item_count_count'] + metrics['missing_content_count'] + metrics['unknown_error_count']) / metrics['total_api_calls'] * 100:.1f}%")
    return "\n".join(lines)


def api_summary_command(experiment_id: str) -> int:
    """
    для командной строки

    Args:
        experiment_id: Experiment identifier.

    Returns:
        Exit code (0 = success, non‑zero = error).
    """
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

    settings = load_settings()
    db_path = settings["benchmark_db_path"]

    try:
        metrics = compute_and_save_api_metrics(db_path, experiment_id)
        text = format_api_metrics_as_text(metrics)
        print(text)
        return 0

    except Exception as e:
        print(f"Error generating API reliability summary: {e}", file=sys.stderr)
        logging.exception("API summary generation failed")
        return 1


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Show API/LLM response reliability summary")
    parser.add_argument("--experiment-id", required=True, help="Experiment identifier")
    args = parser.parse_args()

    sys.exit(api_summary_command(args.experiment_id))


if __name__ == "__main__":
    main()