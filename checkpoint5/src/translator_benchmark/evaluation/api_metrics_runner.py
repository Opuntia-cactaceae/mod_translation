import sqlite3
import logging
from typing import Dict, Any, Optional
from ..domain.enums import ResponseOutcomeType

logger = logging.getLogger(__name__)

#это такой костыль дря переноса меж компами моими
try:
    from .token_efficiency_runner import compute_token_efficiency_metrics
except ImportError:
    compute_token_efficiency_metrics = None

from ..storage.api_metric_repository import _ensure_api_metrics_columns


def compute_api_reliability_metrics(db_path: str, experiment_id: str) -> Dict[str, Any]:
    """
    расчет метрик касающихся работы с апишкой ллмки (и токенами)

    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.

    Returns:
        Dictionary with aggregated API reliability metrics.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT
                COUNT(*) as total_rows,
                SUM(CASE WHEN final_translation IS NOT NULL THEN 1 ELSE 0 END) as successful_rows,
                SUM(CASE WHEN final_translation IS NULL THEN 1 ELSE 0 END) as failed_rows,
                SUM(attempt_count) as total_attempts,
                SUM(retry_count) as total_retries,
                SUM(CASE WHEN repair_applied = 1 THEN 1 ELSE 0 END) as repair_applied_rows,
                SUM(CASE WHEN fallback_used = 1 THEN 1 ELSE 0 END) as fallback_rows,
                SUM(total_input_tokens) as sum_input_tokens,
                SUM(total_output_tokens) as sum_output_tokens,
                SUM(total_tokens) as sum_tokens
            FROM results
            WHERE experiment_id = ?
            """,
            (experiment_id,)
        )
        row = cursor.fetchone()
        if row is None:
            raise ValueError(f"No results found for experiment {experiment_id}")

        total_rows = row[0] or 0
        successful_rows = row[1] or 0
        failed_rows = row[2] or 0
        total_attempts = row[3] or 0
        total_retries = row[4] or 0
        repair_applied_rows = row[5] or 0
        fallback_rows = row[6] or 0
        sum_input_tokens = row[7] or 0
        sum_output_tokens = row[8] or 0
        sum_tokens = row[9] or 0

        cursor.execute(
            """
            SELECT
                COUNT(*) as total_api_calls,
                COUNT(DISTINCT row_id) as distinct_rows,
                -- response outcome breakdown
                SUM(CASE WHEN response_outcome_type = ? THEN 1 ELSE 0 END) as accepted_without_retry,
                SUM(CASE WHEN response_outcome_type = ? THEN 1 ELSE 0 END) as accepted_after_retry,
                SUM(CASE WHEN response_outcome_type = ? THEN 1 ELSE 0 END) as format_repair_applied,
                SUM(CASE WHEN response_outcome_type = ? THEN 1 ELSE 0 END) as fallback_to_single,
                SUM(CASE WHEN response_outcome_type = ? THEN 1 ELSE 0 END) as transport_error,
                SUM(CASE WHEN response_outcome_type = ? THEN 1 ELSE 0 END) as timeout,
                SUM(CASE WHEN response_outcome_type = ? THEN 1 ELSE 0 END) as rate_limited,
                SUM(CASE WHEN response_outcome_type = ? THEN 1 ELSE 0 END) as empty_response,
                SUM(CASE WHEN response_outcome_type = ? THEN 1 ELSE 0 END) as invalid_json,
                SUM(CASE WHEN response_outcome_type = ? THEN 1 ELSE 0 END) as invalid_batch_shape,
                SUM(CASE WHEN response_outcome_type = ? THEN 1 ELSE 0 END) as wrong_item_count,
                SUM(CASE WHEN response_outcome_type = ? THEN 1 ELSE 0 END) as missing_content,
                SUM(CASE WHEN response_outcome_type = ? THEN 1 ELSE 0 END) as unknown_error,
                -- token usage sums (only for successful attempts where tokens are recorded)
                SUM(input_token_count) as total_input_tokens_attempts,
                SUM(output_token_count) as total_output_tokens_attempts,
                SUM(total_token_count) as total_tokens_attempts
            FROM attempts
            WHERE experiment_id = ?
            """,
            (
                ResponseOutcomeType.ACCEPTED_WITHOUT_RETRY.name,
                ResponseOutcomeType.ACCEPTED_AFTER_RETRY.name,
                ResponseOutcomeType.FORMAT_REPAIR_APPLIED.name,
                ResponseOutcomeType.FALLBACK_TO_SINGLE.name,
                ResponseOutcomeType.TRANSPORT_ERROR.name,
                ResponseOutcomeType.TIMEOUT.name,
                ResponseOutcomeType.RATE_LIMITED.name,
                ResponseOutcomeType.EMPTY_RESPONSE.name,
                ResponseOutcomeType.INVALID_JSON.name,
                ResponseOutcomeType.INVALID_BATCH_SHAPE.name,
                ResponseOutcomeType.WRONG_ITEM_COUNT.name,
                ResponseOutcomeType.MISSING_CONTENT.name,
                ResponseOutcomeType.UNKNOWN_ERROR.name,
                experiment_id,
            )
        )
        attempt_row = cursor.fetchone()
        if attempt_row is None:
            total_api_calls = 0
            accepted_without_retry_count = 0
            accepted_after_retry_count = 0
            repair_applied_count = 0
            fallback_count = 0
            transport_error_count = 0
            timeout_count = 0
            rate_limit_count = 0
            empty_response_count = 0
            invalid_json_count = 0
            invalid_batch_shape_count = 0
            wrong_item_count_count = 0
            missing_content_count = 0
            unknown_error_count = 0
            total_input_tokens_attempts = 0
            total_output_tokens_attempts = 0
            total_tokens_attempts = 0
        else:
            total_api_calls = attempt_row[0] or 0
            accepted_without_retry_count = attempt_row[2] or 0
            accepted_after_retry_count = attempt_row[3] or 0
            repair_applied_count = attempt_row[4] or 0
            fallback_count = attempt_row[5] or 0
            transport_error_count = attempt_row[6] or 0
            timeout_count = attempt_row[7] or 0
            rate_limit_count = attempt_row[8] or 0
            empty_response_count = attempt_row[9] or 0
            invalid_json_count = attempt_row[10] or 0
            invalid_batch_shape_count = attempt_row[11] or 0
            wrong_item_count_count = attempt_row[12] or 0
            missing_content_count = attempt_row[13] or 0
            unknown_error_count = attempt_row[14] or 0
            total_input_tokens_attempts = attempt_row[15] or 0
            total_output_tokens_attempts = attempt_row[16] or 0
            total_tokens_attempts = attempt_row[17] or 0

        # Calculate averages
        avg_input_tokens_per_success = None
        avg_output_tokens_per_success = None
        avg_total_tokens_per_success = None
        if successful_rows > 0:
            avg_input_tokens_per_success = sum_input_tokens / successful_rows
            avg_output_tokens_per_success = sum_output_tokens / successful_rows
            avg_total_tokens_per_success = sum_tokens / successful_rows

        metrics = {
            "experiment_id": experiment_id,
            "total_rows": total_rows,
            "successful_rows": successful_rows,
            "failed_rows": failed_rows,
            "total_attempts": total_attempts,
            "total_api_calls": total_api_calls,
            "accepted_without_retry_count": accepted_without_retry_count,
            "accepted_after_retry_count": accepted_after_retry_count,
            "repair_applied_count": repair_applied_count,
            "fallback_count": fallback_count,
            "retry_count": total_retries,
            "transport_error_count": transport_error_count,
            "timeout_count": timeout_count,
            "rate_limit_count": rate_limit_count,
            "empty_response_count": empty_response_count,
            "invalid_json_count": invalid_json_count,
            "invalid_batch_shape_count": invalid_batch_shape_count,
            "wrong_item_count_count": wrong_item_count_count,
            "missing_content_count": missing_content_count,
            "unknown_error_count": unknown_error_count,
            "total_input_tokens": sum_input_tokens,
            "total_output_tokens": sum_output_tokens,
            "total_tokens": sum_tokens,
            "avg_input_tokens_per_success": avg_input_tokens_per_success,
            "avg_output_tokens_per_success": avg_output_tokens_per_success,
            "avg_total_tokens_per_success": avg_total_tokens_per_success,
        }

        if compute_token_efficiency_metrics is not None:
            try:
                token_metrics = compute_token_efficiency_metrics(db_path, experiment_id)
                metrics.update(token_metrics)
            except Exception as e:
                logger.warning(f"Failed to compute token efficiency metrics: {e}")

        return metrics

    finally:
        conn.close()


def save_api_metrics(db_path: str, metrics: Dict[str, Any]) -> None:
    """
    сохраняем в табличку метрики

    Args:
        db_path: Path to SQLite database.
        metrics: Dictionary returned by compute_api_reliability_metrics.
    """
    conn = sqlite3.connect(db_path)
    try:
        _ensure_api_metrics_columns(conn)
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT OR REPLACE INTO api_metrics
            (experiment_id, created_at, total_rows, successful_rows, failed_rows, total_attempts,
             total_api_calls, accepted_without_retry_count, accepted_after_retry_count,
             repair_applied_count, fallback_count, retry_count, transport_error_count,
             timeout_count, rate_limit_count, empty_response_count, invalid_json_count,
             invalid_batch_shape_count, wrong_item_count_count, missing_content_count,
             total_input_tokens, total_output_tokens, total_tokens,
             avg_input_tokens_per_success, avg_output_tokens_per_success,
             avg_total_tokens_per_success,
             estimated_source_payload_tokens, estimated_prompt_shell_tokens,
             input_overhead_ratio, full_cost_ratio,
             payload_to_total_input_ratio, prompt_shell_ratio,
             token_efficiency_note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                metrics["experiment_id"],
                None,
                metrics["total_rows"],
                metrics["successful_rows"],
                metrics["failed_rows"],
                metrics["total_attempts"],
                metrics["total_api_calls"],
                metrics["accepted_without_retry_count"],
                metrics["accepted_after_retry_count"],
                metrics["repair_applied_count"],
                metrics["fallback_count"],
                metrics["retry_count"],
                metrics["transport_error_count"],
                metrics["timeout_count"],
                metrics["rate_limit_count"],
                metrics["empty_response_count"],
                metrics["invalid_json_count"],
                metrics["invalid_batch_shape_count"],
                metrics["wrong_item_count_count"],
                metrics["missing_content_count"],
                metrics["total_input_tokens"],
                metrics["total_output_tokens"],
                metrics["total_tokens"],
                metrics["avg_input_tokens_per_success"],
                metrics["avg_output_tokens_per_success"],
                metrics["avg_total_tokens_per_success"],
                metrics.get("estimated_source_payload_tokens"),
                metrics.get("estimated_prompt_shell_tokens"),
                metrics.get("input_overhead_ratio"),
                metrics.get("full_cost_ratio"),
                metrics.get("payload_to_total_input_ratio"),
                metrics.get("prompt_shell_ratio"),
                metrics.get("token_efficiency_note"),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def compute_and_save_api_metrics(db_path: str, experiment_id: str) -> Dict[str, Any]:
    """
    все что выше в одном

    Args:
        db_path: Path to SQLite database.
        experiment_id: Experiment identifier.

    Returns:
        Dictionary with metrics.
    """
    metrics = compute_api_reliability_metrics(db_path, experiment_id)
    save_api_metrics(db_path, metrics)
    return metrics