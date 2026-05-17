import sqlite3
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)
#формируем отчеты для саммарей по метрикам и для лидерборда

def build_experiment_summary_report(db_path: str, experiment_id: str) -> Dict[str, Any]:
    """
    Includes:
    - experiment_id, dataset_id, model_name, prompt_profile, protection_strategy, validator_name
    - operational metrics (total_rows, success_count, failed_count, fallback_count, attempts_count, avg_latency_ms)
    - quality metrics (if available): final_score_mean, text_score_mean, compilability_rate, etc.

    Args:
        db_path: Path to benchmark SQLite database.
        experiment_id: Experiment identifier.

    Returns:
        Dictionary with experiment summary.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT dataset_id, model_name, prompt_profile, protection_strategy, validator_name, batch_size, config_json
            FROM experiments
            WHERE experiment_id = ?
            """,
            (experiment_id,),
        )
        exp_row = cursor.fetchone()
        if not exp_row:
            return {"error": f"Experiment {experiment_id} not found"}

        dataset_id, model_name, prompt_profile, protection_strategy, validator_name, batch_size, config_json = exp_row

        cursor.execute(
            """
            SELECT
                COUNT(*) as total_rows,
                SUM(CASE WHEN final_translation IS NOT NULL THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN final_translation IS NULL THEN 1 ELSE 0 END) as failed_count,
                SUM(CASE WHEN fallback_used = 1 THEN 1 ELSE 0 END) as fallback_count
            FROM results
            WHERE experiment_id = ?
            """,
            (experiment_id,),
        )
        row = cursor.fetchone()
        total_rows = row[0] if row else 0
        success_count = row[1] if row and row[1] is not None else 0
        failed_count = row[2] if row and row[2] is not None else 0
        fallback_count = row[3] if row and row[3] is not None else 0

        cursor.execute(
            """
            SELECT
                COUNT(*) as attempts_count,
                AVG(latency_ms) as avg_latency_ms
            FROM attempts
            WHERE experiment_id = ?
            """,
            (experiment_id,),
        )
        row = cursor.fetchone()
        attempts_count = row[0] if row and row[0] is not None else 0
        avg_latency_ms = row[1] if row and row[1] is not None else 0.0

        cursor.execute(
            """
            SELECT text_score_mean, tag_content_score_mean, tag_structure_score_mean,
                   compilability_rate, final_score_mean, success_rate, valid_response_rate,
                   fallback_rate, avg_latency_ms as metrics_avg_latency
            FROM metrics
            WHERE experiment_id = ?
            """,
            (experiment_id,),
        )
        metrics_row = cursor.fetchone()
        if metrics_row:
            quality_metrics = {
                "text_score_mean": metrics_row[0],
                "tag_content_score_mean": metrics_row[1],
                "tag_structure_score_mean": metrics_row[2],
                "compilability_rate": metrics_row[3],
                "final_score_mean": metrics_row[4],
                "success_rate": metrics_row[5],
                "valid_response_rate": metrics_row[6],
                "fallback_rate": metrics_row[7],
                "avg_latency_ms_from_metrics": metrics_row[8],
            }
        else:
            quality_metrics = {
                "text_score_mean": None,
                "tag_content_score_mean": None,
                "tag_structure_score_mean": None,
                "compilability_rate": None,
                "final_score_mean": None,
                "success_rate": None,
                "valid_response_rate": None,
                "fallback_rate": None,
                "avg_latency_ms_from_metrics": None,
            }

    finally:
        conn.close()

    summary = {
        "experiment_id": experiment_id,
        "dataset_id": dataset_id,
        "model_name": model_name,
        "prompt_profile": prompt_profile,
        "protection_strategy": protection_strategy,
        "validator_name": validator_name,
        "batch_size": batch_size,
        "total_rows": total_rows,
        "success_count": success_count,
        "failed_count": failed_count,
        "fallback_count": fallback_count,
        "attempts_count": attempts_count,
        "avg_latency_ms": avg_latency_ms,
        **quality_metrics,
    }

    return summary


def build_leaderboard_report(db_path: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    делает лидерборд

    Includes:
    - rank, experiment_id, model_name, prompt_profile, protection_strategy, validator_name
    - final_score_mean, compilability_rate, success_rate, avg_latency_ms
    - other key operational fields

    Args:
        db_path: Path to benchmark SQLite database.
        limit: Optional limit on number of experiments to include.

    Returns:
        List of experiment dictionaries sorted by final_score_mean.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()

        query = """
            SELECT
                e.experiment_id,
                e.dataset_id,
                e.model_name,
                e.prompt_profile,
                e.protection_strategy,
                e.validator_name,
                e.batch_size,
                m.final_score_mean,
                m.text_score_mean,
                m.tag_content_score_mean,
                m.tag_structure_score_mean,
                m.compilability_rate,
                m.success_rate,
                m.valid_response_rate,
                m.fallback_rate,
                m.avg_latency_ms
            FROM experiments e
            LEFT JOIN metrics m ON e.experiment_id = m.experiment_id
            WHERE m.final_score_mean IS NOT NULL
            ORDER BY m.final_score_mean DESC
        """
        if limit is not None:
            query += f" LIMIT {limit}"

        cursor.execute(query)
        rows = cursor.fetchall()

        leaderboard = []
        for rank, row in enumerate(rows, start=1):
            exp = {
                "rank": rank,
                "experiment_id": row[0],
                "dataset_id": row[1],
                "model_name": row[2],
                "prompt_profile": row[3],
                "protection_strategy": row[4],
                "validator_name": row[5],
                "batch_size": row[6],
                "final_score_mean": row[7],
                "text_score_mean": row[8],
                "tag_content_score_mean": row[9],
                "tag_structure_score_mean": row[10],
                "compilability_rate": row[11],
                "success_rate": row[12],
                "valid_response_rate": row[13],
                "fallback_rate": row[14],
                "avg_latency_ms": row[15],
            }
            leaderboard.append(exp)

        return leaderboard

    finally:
        conn.close()


def format_summary_as_text(summary: Dict[str, Any]) -> str:
    """
    саммари приводим в норм текст

    Args:
        summary: Summary dictionary from build_experiment_summary_report.

    Returns:
        Formatted text.
    """
    if "error" in summary:
        return f"Error: {summary['error']}"

    lines = [
        f"Experiment: {summary['experiment_id']}",
        f"Dataset: {summary['dataset_id']}",
        f"Model: {summary['model_name']}",
        f"Prompt: {summary['prompt_profile']}",
        f"Protection: {summary['protection_strategy']}",
        f"Validator: {summary['validator_name']}",
        f"Batch size: {summary['batch_size']}",
        "",
        "Operational Metrics:",
        f"  Total rows: {summary['total_rows']}",
        f"  Success: {summary['success_count']}",
        f"  Failed: {summary['failed_count']}",
        f"  Fallback used: {summary['fallback_count']}",
        f"  Attempts: {summary['attempts_count']}",
        f"  Avg latency: {summary['avg_latency_ms']:.1f} ms",
    ]

    if summary.get('final_score_mean') is not None:
        lines.extend([
            "",
            "Quality Metrics:",
            f"  Final score: {summary['final_score_mean']:.3f}",
            f"  Text score: {summary['text_score_mean']:.3f}",
            f"  Tag content score: {summary['tag_content_score_mean']:.3f}",
            f"  Tag structure score: {summary['tag_structure_score_mean']:.3f}",
            f"  Compilability rate: {summary['compilability_rate']:.3f}",
            f"  Success rate: {summary['success_rate']:.3f}",
            f"  Valid response rate: {summary['valid_response_rate']:.3f}",
            f"  Fallback rate: {summary['fallback_rate']:.3f}",
        ])
    else:
        lines.append("\nQuality metrics: Not evaluated yet.")

    return "\n".join(lines)


def format_leaderboard_as_text(leaderboard: List[Dict[str, Any]]) -> str:
    """
    аналогично лидерборд в читаемый вид

    Args:
        leaderboard: Leaderboard list from build_leaderboard_report.

    Returns:
        Formatted text table.
    """
    if not leaderboard:
        return "No experiments with metrics found."

    headers = [
        ("Rank", 4),
        ("Experiment", 12),
        ("Model", 12),
        ("Prompt", 10),
        ("Protection", 10),
        ("Final Score", 11),
        ("Compilability", 13),
        ("Success Rate", 12),
        ("Latency", 10),
    ]

    header_line = "  ".join(f"{h:<{w}}" for h, w in headers)
    separator = "-" * len(header_line)

    lines = [header_line, separator]

    for exp in leaderboard:
        row = [
            str(exp["rank"]),
            exp["experiment_id"][:12],
            exp["model_name"][:12],
            exp["prompt_profile"][:10],
            exp["protection_strategy"][:10],
            f"{exp['final_score_mean']:.3f}" if exp['final_score_mean'] is not None else "N/A",
            f"{exp['compilability_rate']:.3f}" if exp['compilability_rate'] is not None else "N/A",
            f"{exp['success_rate']:.3f}" if exp['success_rate'] is not None else "N/A",
            f"{exp['avg_latency_ms']:.0f} ms" if exp['avg_latency_ms'] is not None else "N/A",
        ]
        row_line = "  ".join(f"{row[i]:<{headers[i][1]}}" for i in range(len(headers)))
        lines.append(row_line)

    return "\n".join(lines)


def build_extended_leaderboard_report(db_path: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    лидерборд с метриками перевода и апишными метриками

    Includes:
    - rank, experiment_id, model_name, prompt_profile, protection_strategy, validator_name
    - final_score_mean, bleu, chrf, ter, success_rate, retry_count, fallback_count, total_tokens
    - other key operational fields

    Args:
        db_path: Path to benchmark SQLite database.
        limit: Optional limit on number of experiments to include.

    Returns:
        List of experiment dictionaries sorted by final_score_mean descending.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()

        query = """
            SELECT
                e.experiment_id,
                e.dataset_id,
                e.model_name,
                e.prompt_profile,
                e.protection_strategy,
                e.validator_name,
                e.batch_size,
                m.final_score_mean,
                m.text_score_mean,
                m.tag_content_score_mean,
                m.tag_structure_score_mean,
                m.compilability_rate,
                m.success_rate,
                m.valid_response_rate,
                m.fallback_rate,
                m.avg_latency_ms,
                c.bleu,
                c.chrf,
                c.ter,
                c.comet,
                c.comet_model_name,
                c.num_scored_rows as classic_num_scored_rows,
                a.total_rows as api_total_rows,
                a.successful_rows,
                a.failed_rows,
                a.total_attempts,
                a.total_api_calls,
                a.accepted_without_retry_count,
                a.accepted_after_retry_count,
                a.repair_applied_count,
                a.fallback_count,
                a.retry_count,
                a.transport_error_count,
                a.timeout_count,
                a.rate_limit_count,
                a.total_input_tokens,
                a.total_output_tokens,
                a.total_tokens
            FROM experiments e
            LEFT JOIN metrics m ON e.experiment_id = m.experiment_id
            LEFT JOIN classic_metrics c ON e.experiment_id = c.experiment_id
            LEFT JOIN api_metrics a ON e.experiment_id = a.experiment_id
            WHERE m.final_score_mean IS NOT NULL
            ORDER BY m.final_score_mean DESC
        """
        if limit is not None:
            query += f" LIMIT {limit}"

        cursor.execute(query)
        rows = cursor.fetchall()

        leaderboard = []
        for rank, row in enumerate(rows, start=1):
            exp = {
                "rank": rank,
                "experiment_id": row[0],
                "dataset_id": row[1],
                "model_name": row[2],
                "prompt_profile": row[3],
                "protection_strategy": row[4],
                "validator_name": row[5],
                "batch_size": row[6],
                "final_score_mean": row[7],
                "text_score_mean": row[8],
                "tag_content_score_mean": row[9],
                "tag_structure_score_mean": row[10],
                "compilability_rate": row[11],
                "success_rate": row[12],
                "valid_response_rate": row[13],
                "fallback_rate": row[14],
                "avg_latency_ms": row[15],
                "bleu": row[16],
                "chrf": row[17],
                "ter": row[18],
                "comet": row[19],
                "comet_model_name": row[20],
                "classic_num_scored_rows": row[21],
                "api_total_rows": row[22],
                "successful_rows": row[23],
                "failed_rows": row[24],
                "total_attempts": row[25],
                "total_api_calls": row[26],
                "accepted_without_retry_count": row[27],
                "accepted_after_retry_count": row[28],
                "repair_applied_count": row[29],
                "fallback_count": row[30],
                "retry_count": row[31],
                "transport_error_count": row[32],
                "timeout_count": row[33],
                "rate_limit_count": row[34],
                "total_input_tokens": row[35],
                "total_output_tokens": row[36],
                "total_tokens": row[37],
            }
            leaderboard.append(exp)

        return leaderboard

    finally:
        conn.close()


def format_extended_leaderboard_as_text(leaderboard: List[Dict[str, Any]]) -> str:
    """
    Args:
        leaderboard: Leaderboard list from build_extended_leaderboard_report.

    Returns:
        Formatted text table.
    """
    if not leaderboard:
        return "No experiments with metrics found."

    headers = [
        ("Rank", 4),
        ("Experiment", 12),
        ("Model", 12),
        ("Prompt", 10),
        ("Protection", 10),
        ("Final Score", 11),
        ("BLEU", 8),
        ("chrF", 8),
        ("TER", 8),
        ("Success Rate", 12),
        ("Retry Count", 11),
        ("Fallback Count", 13),
        ("Total Tokens", 12),
    ]

    header_line = "  ".join(f"{h:<{w}}" for h, w in headers)
    separator = "-" * len(header_line)

    lines = [header_line, separator]

    for exp in leaderboard:
        row = [
            str(exp["rank"]),
            exp["experiment_id"][:12],
            exp["model_name"][:12],
            exp["prompt_profile"][:10],
            exp["protection_strategy"][:10],
            f"{exp['final_score_mean']:.3f}" if exp['final_score_mean'] is not None else "N/A",
            f"{exp['bleu']:.2f}" if exp['bleu'] is not None else "N/A",
            f"{exp['chrf']:.2f}" if exp['chrf'] is not None else "N/A",
            f"{exp['ter']:.2f}" if exp['ter'] is not None else "N/A",
            f"{exp['success_rate']:.3f}" if exp['success_rate'] is not None else "N/A",
            str(exp["retry_count"]) if exp["retry_count"] is not None else "N/A",
            str(exp["fallback_count"]) if exp["fallback_count"] is not None else "N/A",
            str(exp["total_tokens"]) if exp["total_tokens"] is not None else "N/A",
        ]
        row_line = "  ".join(f"{row[i]:<{headers[i][1]}}" for i in range(len(headers)))
        lines.append(row_line)

    return "\n".join(lines)