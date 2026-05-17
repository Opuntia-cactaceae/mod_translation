import json
import logging
import sqlite3
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger(__name__)

#тикитоки
#нужно это дело чтобы +- понимать на сколько эффективно тратятся токены в процессе
try:
    import tiktoken
    TIKTOKEN_AVAILABLE = True
except ImportError:
    TIKTOKEN_AVAILABLE = False
    logger.warning("tiktoken not available, using simple character-based token estimator")


def count_tokens(text: str, encoding_name: str = "cl100k_base") -> int:
    """
    тикток если есть, если нет то тупая фигня на основе символов (как же я намучался с этими токенами на иероглифах)
    Args:
        text: Input text.
        encoding_name: Tiktoken encoding name (ignored if tiktoken not available).

    Returns:
        Estimated token count.
    """
    if TIKTOKEN_AVAILABLE:
        try:
            enc = tiktoken.get_encoding(encoding_name)
            return len(enc.encode(text))
        except Exception as e:
            logger.warning(f"tiktoken failed: {e}, falling back to char estimator")

    char_count = len(text)
    space_count = text.count(' ')
    return max(1, int(char_count / 4))


def build_prompt_shell(
    config_snapshot: Dict[str, Any],
    request_kind: str,
    src_lang: str,
    dst_lang: str,
    placeholder_text: str = "",
    placeholder_texts: Optional[List[str]] = None
) -> Tuple[str, str]:
    """
    создаем оболочку промпта без текста но со всеми системными штуками (чтоб размер потом оценить)

    Args:
        config_snapshot: Experiment config snapshot (from experiments.config_json).
        request_kind: 'single' or 'batch'.
        src_lang: Source language code.
        dst_lang: Target language code.
        placeholder_text: For single mode, placeholder source text (empty string for shell).
        placeholder_texts: For batch mode, list of placeholder source texts.

    Returns:
        Tuple of (system_prompt_content, user_prompt_content).

    Raises:
        ValueError: If request_kind not supported or missing templates.
    """
    prompt_config = config_snapshot.get("prompt", {})

    if request_kind == "single":
        system_template = prompt_config.get("single_system_prompt") or prompt_config.get("system_prompt")
        user_template = prompt_config.get("single_user_template") or prompt_config.get("user_template")
        if not user_template:
            raise ValueError("No user template found for single mode")

        system_content = None
        if system_template:
            try:
                system_content = system_template.format(
                    text=placeholder_text, src_lang=src_lang, dst_lang=dst_lang
                )
            except KeyError:
                system_content = system_template
        user_content = user_template.format(
            text=placeholder_text, src_lang=src_lang, dst_lang=dst_lang
        )
        return system_content or "", user_content

    elif request_kind == "batch":
        system_template = prompt_config.get("batch_system_prompt") or prompt_config.get("system_prompt")
        user_template = prompt_config.get("batch_user_template") or prompt_config.get("user_template")
        if not user_template:
            raise ValueError("No user template found for batch mode")

        texts = placeholder_texts if placeholder_texts is not None else []
        system_content = None
        if system_template:
            try:
                system_content = system_template.format(
                    texts=texts, src_lang=src_lang, dst_lang=dst_lang
                )
            except KeyError:
                system_content = system_template
        user_content = user_template.format(
            texts=texts, src_lang=src_lang, dst_lang=dst_lang
        )
        return system_content or "", user_content

    else:
        raise ValueError(f"Unsupported request_kind: {request_kind}")


def estimate_prompt_tokens(
    config_snapshot: Dict[str, Any],
    request_kind: str,
    src_lang: str,
    dst_lang: str,
    source_text: Optional[str] = None,
    source_texts: Optional[List[str]] = None
) -> Dict[str, int]:
    """
    прикинем число токенов для промпта и текста

    Args:
        config_snapshot: Experiment config snapshot.
        request_kind: 'single' or 'batch'.
        src_lang: Source language code.
        dst_lang: Target language code.
        source_text: For single mode, actual source text.
        source_texts: For batch mode, list of actual source texts.

    Returns:
        Dictionary with keys:
        - shell_system_tokens: tokens in system prompt shell (without payload)
        - shell_user_tokens: tokens in user prompt shell (without payload)
        - payload_tokens: additional tokens for the actual source text(s)
        - total_system_tokens: tokens in full system prompt
        - total_user_tokens: tokens in full user prompt
        - total_tokens: total tokens in full prompt (system + user)
    """
    if request_kind == "single":
        placeholder = ""
        shell_system, shell_user = build_prompt_shell(
            config_snapshot, "single", src_lang, dst_lang, placeholder_text=placeholder
        )
        full_system, full_user = build_prompt_shell(
            config_snapshot, "single", src_lang, dst_lang, placeholder_text=source_text or ""
        )
    else:
        batch_size = config_snapshot.get("batch_size", 10)
        placeholder_texts = [""] * batch_size
        shell_system, shell_user = build_prompt_shell(
            config_snapshot, "batch", src_lang, dst_lang, placeholder_texts=placeholder_texts
        )
        actual_texts = source_texts if source_texts is not None else []
        full_system, full_user = build_prompt_shell(
            config_snapshot, "batch", src_lang, dst_lang, placeholder_texts=actual_texts
        )

    shell_system_tokens = count_tokens(shell_system)
    shell_user_tokens = count_tokens(shell_user)
    full_system_tokens = count_tokens(full_system)
    full_user_tokens = count_tokens(full_user)

    payload_system_tokens = full_system_tokens - shell_system_tokens
    payload_user_tokens = full_user_tokens - shell_user_tokens
    payload_tokens = payload_system_tokens + payload_user_tokens

    return {
        "shell_system_tokens": shell_system_tokens,
        "shell_user_tokens": shell_user_tokens,
        "payload_tokens": payload_tokens,
        "total_system_tokens": full_system_tokens,
        "total_user_tokens": full_user_tokens,
        "total_tokens": full_system_tokens + full_user_tokens,
    }


def compute_token_efficiency_metrics(
    db_path: str,
    experiment_id: str,
    config_snapshot: Optional[Dict[str, Any]] = None
) -> Dict[str, float]:
    """
    считаем метрики эффективности затрат токенов для эксперимента

	1.	Загружаем конфиг эксперимента
	2.	Для каждой успешной строки определяем по попыткам был single или batch
	3.	Считаем оценку токенов промпта для каждой строки
	4.	Суммируем по всему эксперименту
	5.	Сравниваем с реальными токенами из API

    Args:
        db_path: Path to benchmark SQLite database.
        experiment_id: Experiment identifier.
        config_snapshot: Optional preloaded config snapshot.

    Returns:
        Dictionary with token efficiency metrics.
    """
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()

        if config_snapshot is None:
            cursor.execute(
                "SELECT config_json FROM experiments WHERE experiment_id = ?",
                (experiment_id,)
            )
            row = cursor.fetchone()
            if row is None:
                logger.error(f"Experiment {experiment_id} not found")
                return {}
            config_snapshot = json.loads(row[0])

        src_lang = config_snapshot.get("src_lang", "en")
        dst_lang = config_snapshot.get("dst_lang", "ru")
        batch_size = config_snapshot.get("batch_size", 10)

        cursor.execute(
            """
            SELECT row_id, source_text FROM results
            WHERE experiment_id = ? AND final_translation IS NOT NULL
            """,
            (experiment_id,)
        )
        rows = cursor.fetchall()

        if not rows:
            logger.warning(f"No successful rows for experiment {experiment_id}")
            return {}

        row_data = []
        total_actual_input_tokens = 0
        total_actual_output_tokens = 0
        total_actual_tokens = 0

        for row_id, source_text in rows:
            cursor.execute(
                """
                SELECT request_kind, input_token_count, output_token_count, total_token_count
                FROM attempts
                WHERE experiment_id = ? AND row_id = ? AND status = 'success'
                ORDER BY attempt_no
                LIMIT 1
                """,
                (experiment_id, row_id)
            )
            attempt_row = cursor.fetchone()
            if not attempt_row:
                cursor.execute(
                    """
                    SELECT request_kind, input_token_count, output_token_count, total_token_count
                    FROM attempts
                    WHERE experiment_id = ? AND row_id = ?
                    ORDER BY attempt_no
                    LIMIT 1
                    """,
                    (experiment_id, row_id)
                )
                attempt_row = cursor.fetchone()

            if not attempt_row:
                logger.warning(f"No attempts found for row {row_id}, skipping")
                continue

            request_kind, input_tokens, output_tokens, total_tokens = attempt_row
            if request_kind not in ("single", "batch"):
                prompt_config = config_snapshot.get("prompt", {})
                has_batch_template = bool(prompt_config.get("batch_user_template"))
                request_kind = "batch" if (batch_size > 1 and has_batch_template) else "single"

            try:
                if request_kind == "single":
                    token_estimates = estimate_prompt_tokens(
                        config_snapshot, "single", src_lang, dst_lang, source_text=source_text
                    )
                else:
                    placeholder_texts = [source_text] + [""] * (batch_size - 1)
                    token_estimates = estimate_prompt_tokens(
                        config_snapshot, "batch", src_lang, dst_lang, source_texts=placeholder_texts
                    )
            except Exception as e:
                logger.warning(f"Failed to estimate tokens for row {row_id}: {e}")
                continue

            row_data.append({
                "row_id": row_id,
                "request_kind": request_kind,
                "source_text": source_text,
                "token_estimates": token_estimates,
                "actual_input_tokens": input_tokens or 0,
                "actual_output_tokens": output_tokens or 0,
                "actual_total_tokens": total_tokens or 0,
            })

            if input_tokens:
                total_actual_input_tokens += input_tokens
            if output_tokens:
                total_actual_output_tokens += output_tokens
            if total_tokens:
                total_actual_tokens += total_tokens

        if not row_data:
            return {}

        total_shell_system_tokens = sum(d["token_estimates"]["shell_system_tokens"] for d in row_data)
        total_shell_user_tokens = sum(d["token_estimates"]["shell_user_tokens"] for d in row_data)
        total_payload_tokens = sum(d["token_estimates"]["payload_tokens"] for d in row_data)
        total_estimated_input_tokens = sum(d["token_estimates"]["total_tokens"] for d in row_data)

        if total_payload_tokens == 0:
            total_payload_tokens = 1

        input_overhead_ratio = total_actual_input_tokens / total_payload_tokens if total_actual_input_tokens else 0
        full_cost_ratio = total_actual_tokens / total_payload_tokens if total_actual_tokens else 0
        payload_to_total_input_ratio = total_payload_tokens / total_actual_input_tokens if total_actual_input_tokens else 0
        prompt_shell_ratio = (total_shell_system_tokens + total_shell_user_tokens) / total_actual_input_tokens if total_actual_input_tokens else 0

        return {
            "estimated_source_payload_tokens": total_payload_tokens,
            "estimated_prompt_shell_tokens": total_shell_system_tokens + total_shell_user_tokens,
            "total_actual_input_tokens": total_actual_input_tokens,
            "total_actual_output_tokens": total_actual_output_tokens,
            "total_actual_tokens": total_actual_tokens,
            "input_overhead_ratio": input_overhead_ratio,
            "full_cost_ratio": full_cost_ratio,
            "payload_to_total_input_ratio": payload_to_total_input_ratio,
            "prompt_shell_ratio": prompt_shell_ratio,
            "token_efficiency_note": "payload/source token counts are local estimates using tiktoken/cl100k_base or char estimator",
        }

    finally:
        conn.close()