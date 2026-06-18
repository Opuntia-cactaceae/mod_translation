"""
единая сводка по эксперименту

Собираем для эксперимента все основные слои метрик:
1. конфиг
2. наша метрика кач-ва
3. Классические метрики перевода (BLEU, chrF, TER, COMET)
4. Метрики надёжности API (операционные / API-метрики)
"""
import sqlite3
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


def load_experiment_metadata(db_path: str, experiment_id: str) -> Optional[Dict[str, Any]]:
    """
    загружаем инфу по экспериментам

    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.

    Returns:
        Dictionary with metadata or None if experiment not found.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT dataset_id, model_name, prompt_profile, protection_strategy,
                   validator_name, batch_size, created_at
            FROM experiments
            WHERE experiment_id = ?
            """,
            (experiment_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None

        return {
            "experiment_id": experiment_id,
            "dataset_id": row[0],
            "model_name": row[1],
            "prompt_profile": row[2],
            "protection_strategy": row[3],
            "validator_name": row[4],
            "batch_size": row[5],
            "created_at": row[6],
        }
    finally:
        conn.close()


def build_unified_experiment_report(db_path: str, experiment_id: str) -> Dict[str, Any]:
    """
    репорт по всем метрикам

    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.

    Returns:
        Dictionary with keys:
        - metadata: experiment metadata
        - legacy_quality_metrics: from metrics table (may be None)
        - classic_metrics: from classic_metrics table (may be None)
        - api_reliability_metrics: from api_metrics table (may be None)
        - error: error message if experiment not found
    """
    metadata = load_experiment_metadata(db_path, experiment_id)
    if metadata is None:
        return {"error": f"Experiment {experiment_id} not found"}

    from ..storage.metric_repository import load_experiment_metrics
    from ..storage.classic_metric_repository import load_classic_metrics
    from ..storage.api_metric_repository import load_api_metrics

    legacy_metrics = load_experiment_metrics(db_path, experiment_id)

    classic_metrics = load_classic_metrics(db_path, experiment_id)

    api_metrics = load_api_metrics(db_path, experiment_id)

    return {
        "metadata": metadata,
        "legacy_quality_metrics": legacy_metrics,
        "classic_metrics": classic_metrics,
        "api_reliability_metrics": api_metrics,
    }


def format_unified_summary_as_text(report: Dict[str, Any]) -> str:
    """
    аналогично просто приводим в читаемый текст

    Args:
        report: Dictionary returned by build_unified_experiment_report.

    Returns:
        Formatted text.
    """
    if "error" in report:
        return f"Error: {report['error']}"

    lines = []
    metadata = report["metadata"]
    legacy = report["legacy_quality_metrics"]
    classic = report["classic_metrics"]
    api = report["api_reliability_metrics"]

    lines.append(f"Experiment: {metadata['experiment_id']}")
    lines.append(f"Dataset: {metadata['dataset_id']}")
    lines.append(f"Model: {metadata['model_name']}")
    lines.append(f"Prompt: {metadata['prompt_profile']}")
    lines.append(f"Protection: {metadata['protection_strategy']}")
    lines.append(f"Validator: {metadata['validator_name']}")
    lines.append(f"Batch size: {metadata['batch_size']}")
    lines.append(f"Created at: {metadata['created_at']}")
    lines.append("")

    lines.append("API Reliability Metrics:")
    if api:
        lines.append(f"  Total rows: {api['total_rows']}")
        lines.append(f"  Successful rows: {api['successful_rows']}")
        lines.append(f"  Failed rows: {api['failed_rows']}")
        lines.append(f"  Total attempts: {api['total_attempts']}")
        lines.append(f"  Total API calls: {api['total_api_calls']}")
        lines.append(f"  Accepted without retry: {api['accepted_without_retry_count']}")
        lines.append(f"  Accepted after retry: {api['accepted_after_retry_count']}")
        lines.append(f"  Repair applied: {api['repair_applied_count']}")
        lines.append(f"  Fallback count: {api['fallback_count']}")
        lines.append(f"  Retry count: {api['retry_count']}")
        lines.append(f"  Transport errors: {api['transport_error_count']}")
        lines.append(f"  Timeouts: {api['timeout_count']}")
        lines.append(f"  Rate limits: {api['rate_limit_count']}")
        lines.append(f"  Invalid JSON: {api['invalid_json_count']}")
        lines.append(f"  Invalid batch shape: {api['invalid_batch_shape_count']}")
        lines.append(f"  Wrong item count: {api['wrong_item_count_count']}")
        lines.append(f"  Total input tokens: {api['total_input_tokens']}")
        lines.append(f"  Total output tokens: {api['total_output_tokens']}")
        lines.append(f"  Total tokens: {api['total_tokens']}")
        if api['avg_input_tokens_per_success'] is not None:
            lines.append(f"  Avg input tokens per success: {api['avg_input_tokens_per_success']:.1f}")
        if api['avg_output_tokens_per_success'] is not None:
            lines.append(f"  Avg output tokens per success: {api['avg_output_tokens_per_success']:.1f}")
        if api['avg_total_tokens_per_success'] is not None:
            lines.append(f"  Avg total tokens per success: {api['avg_total_tokens_per_success']:.1f}")

        if api.get('estimated_source_payload_tokens') is not None:
            lines.append("  Token Efficiency (local estimates):")
            lines.append(f"    Estimated source payload tokens: {api['estimated_source_payload_tokens']}")
            lines.append(f"    Estimated prompt shell tokens: {api['estimated_prompt_shell_tokens']}")
            if api.get('input_overhead_ratio') is not None:
                lines.append(f"    Input overhead ratio: {api['input_overhead_ratio']:.3f}")
            if api.get('full_cost_ratio') is not None:
                lines.append(f"    Full cost ratio: {api['full_cost_ratio']:.3f}")
            if api.get('payload_to_total_input_ratio') is not None:
                lines.append(f"    Payload to total input ratio: {api['payload_to_total_input_ratio']:.3f}")
            if api.get('prompt_shell_ratio') is not None:
                lines.append(f"    Prompt shell ratio: {api['prompt_shell_ratio']:.3f}")
            if api.get('token_efficiency_note'):
                lines.append(f"    Note: {api['token_efficiency_note']}")
    else:
        lines.append("  Not available (run api-summary command first)")
    lines.append("")

    lines.append("Classic Translation Metrics:")
    if classic:
        if classic['bleu'] is not None:
            lines.append(f"  BLEU (sacrebleu score): {classic['bleu']:.4f}")
        if classic['chrf'] is not None:
            lines.append(f"  chrF (sacrebleu score): {classic['chrf']:.4f}")
        if classic['ter'] is not None:
            lines.append(f"  TER (lower is better): {classic['ter']:.4f}")
        if classic['comet'] is not None:
            comet_line = f"  COMET: {classic['comet']:.4f}"
            if classic['comet_model_name']:
                comet_line += f" (model: {classic['comet_model_name']})"
            lines.append(comet_line)
        lines.append(f"  Number of scored rows: {classic['num_scored_rows']}")
    else:
        lines.append("  Not available (run evaluate-classic command first)")
    lines.append("")

    lines.append("Legacy Quality Metrics:")
    if legacy:
        lines.append(f"  Final score: {legacy['final_score_mean']:.3f}")
        lines.append(f"  Text score: {legacy['text_score_mean']:.3f}")
        lines.append(f"  Tag content score: {legacy['tag_content_score_mean']:.3f}")
        lines.append(f"  Tag structure score: {legacy['tag_structure_score_mean']:.3f}")
        lines.append(f"  Compilability rate: {legacy['compilability_rate']:.3f}")
        lines.append(f"  Success rate: {legacy['success_rate']:.3f}")
        lines.append(f"  Valid response rate: {legacy['valid_response_rate']:.3f}")
        lines.append(f"  Fallback rate: {legacy['fallback_rate']:.3f}")
        if legacy['avg_latency_ms'] is not None:
            lines.append(f"  Avg latency: {legacy['avg_latency_ms']:.1f} ms")
    else:
        lines.append("  Not available (run evaluate-experiment command first)")

    return "\n".join(lines)