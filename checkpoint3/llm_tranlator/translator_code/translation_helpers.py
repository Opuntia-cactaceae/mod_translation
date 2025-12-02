import re
import sqlite3
from typing import Dict, List, Tuple

from tqdm import tqdm

from checkpoint3.llm_tranlator.translator_code import Config, Translator
from checkpoint3.llm_tranlator.translator_code.cache_utils import sha1, save_cache
from checkpoint3.llm_tranlator.translator_code.db_worker import RowForTranslation, insert_translation, \
    process_translation_batch
from checkpoint3.llm_tranlator.translator_code.logging_utils import write_log
from checkpoint3.llm_tranlator.translator_code.token_utils import protect_tokens, restore_tokens


def _print_source_stats(src_stats: Dict[str, int]) -> None:
    """
    Вывод статистики по исходникам/референсам.
    """
    print(
        "Статистика по исходным строкам:\n"
        f"  всего кандидатов: {src_stats['total_raw']}\n"
        f"  валидных (src+ref ок): {src_stats['valid']}\n"
        f"  пустые исходники: {src_stats['skipped_empty_src']}\n"
        f"  без референса: {src_stats['skipped_no_ref']}\n"
        f"  битые теги в исходнике: {src_stats['skipped_bad_source']}\n"
        f"  битые теги в референсе: {src_stats['skipped_bad_ref']}\n"
    )


def _process_rows_with_cache_and_batches(
    cfg: Config,
    tr: Translator,
    cache: Dict[str, str],
    rows: List[RowForTranslation],
    conn: sqlite3.Connection,
) -> Tuple[int, int]:
    """
    Основной цикл перевода:
      - пытается брать переводы из кэша,
      - иначе добавляет в батч,
      - периодически шлёт батч в модель.
    Возвращает (processed, saved).
    """
    batch_segments: List[str] = []
    batch_meta: List[Dict] = []
    processed = 0
    saved = 0

    with tqdm(total=len(rows), desc="Translate rows", unit="row") as p_rows:
        for item in rows:
            processed, saved = _handle_row_with_cache(
                cfg,
                tr,
                cache,
                conn,
                item,
                rows_count=len(rows),
                p_bar=p_rows,
                batch_segments=batch_segments,
                batch_meta=batch_meta,
                processed=processed,
                saved=saved,
            )

        processed, saved = _flush_batch(
            cfg,
            tr,
            cache,
            conn,
            batch_segments,
            batch_meta,
            p_rows,
            processed,
            saved,
        )

    return processed, saved


def _handle_row_with_cache(
    cfg: Config,
    tr: Translator,
    cache: Dict[str, str],
    conn: sqlite3.Connection,
    item: RowForTranslation,
    rows_count: int,
    p_bar: tqdm,
    batch_segments: List[str],
    batch_meta: List[Dict],
    processed: int,
    saved: int,
) -> Tuple[int, int]:
    """
    Обрабатывает одну строку:
      - защищает плейсхолдеры,
      - пытается взять перевод из кэша,
      - либо добавляет строку в батч и при необходимости сливает его.
    """
    text_id = item.text_id
    src_text = item.src_text

    protected, mapping = protect_tokens(src_text)
    cache_key = sha1(f"{protected}|{cfg.source_lang}>{cfg.target_lang}")

    # Кэш
    if cache_key in cache:
        processed, saved = _apply_cached_translation(
            cfg,
            tr,
            conn,
            cache,
            text_id,
            protected,
            mapping,
            p_bar,
            processed,
            saved,
            total_rows=rows_count,
        )
        return processed, saved

    # Нет в кэше — кладём в батч
    batch_segments.append(protected)
    batch_meta.append(
        {
            "text_id": text_id,
            "mapping": mapping,
            "cache_key": cache_key,
        }
    )

    # Если батч набрался — отправляем его
    if len(batch_segments) >= max(1, cfg.batch_size):
        processed, saved = _flush_batch(
            cfg,
            tr,
            cache,
            conn,
            batch_segments,
            batch_meta,
            p_bar,
            processed,
            saved,
        )

    return processed, saved


def _apply_cached_translation(
    cfg: Config,
    tr: Translator,
    conn: sqlite3.Connection,
    cache: Dict[str, str],
    text_id: int,
    protected: str,
    mapping: Dict[str, str],
    p_bar: tqdm,
    processed: int,
    saved: int,
    total_rows: int,
) -> Tuple[int, int]:
    """
    Применяет уже готовый перевод из кэша:
      - восстанавливает плейсхолдеры,
      - логирует подозрительные <ph>,
      - пишет в БД (если не dry_run),
      - обновляет прогресс и периодические сообщения.
    """
    translated_protected = cache[sha1(f"{protected}|{cfg.source_lang}>{cfg.target_lang}")]
    final_text = restore_tokens(translated_protected, mapping)

    if re.search(r'<\s*ph', final_text, re.IGNORECASE):
        write_log(
            f"Potential <PH ...> left in final_text for text_id={text_id}: {final_text}",
            "warnings.log",
        )

    if not cfg.dry_run:
        insert_translation(
            conn,
            src_text_id=text_id,
            src_lang=cfg.db_source_lang,
            dst_lang=cfg.db_target_lang,
            translated_text=final_text,
            model_name=tr._current_model(),
        )
        conn.commit()

    saved += 1
    processed += 1
    p_bar.update(1)

    if processed % 100 == 0:
        print(
            f"[DB] Уже обработано {processed} строк из {total_rows} "
            f"(сохранено {saved})"
        )

    if processed % 20 == 0:
        save_cache(cfg.cache_path, cache)

    return processed, saved


def _flush_batch(
    cfg: Config,
    tr: Translator,
    cache: Dict[str, str],
    conn: sqlite3.Connection,
    batch_segments: List[str],
    batch_meta: List[Dict],
    p_bar: tqdm,
    processed: int,
    saved: int,
) -> Tuple[int, int]:
    """
    Отправляет текущий батч в модель, сохраняет переводы и очищает батч.

    Возвращает обновлённые (processed, saved).
    """
    if not batch_segments:
        return processed, saved

    batch_len = len(batch_segments)
    b_saved, b_dropped, b_errors = process_translation_batch(
        conn,
        cfg,
        tr,
        cache,
        batch_segments,
        batch_meta,
        p_bar,
    )

    processed += batch_len
    saved += b_saved

    batch_segments.clear()
    batch_meta.clear()

    return processed, saved