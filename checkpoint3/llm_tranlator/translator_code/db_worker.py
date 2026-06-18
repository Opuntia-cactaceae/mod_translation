# localization_translator/db_worker.py
import pathlib
import re
import sqlite3
from dataclasses import dataclass
from typing import Dict, List, Tuple

import pandas as pd
from tqdm import tqdm

from .config import Config
from .translator_core import Translator
from .token_utils import protect_tokens, restore_tokens
from .cache_utils import sha1, save_cache
from .logging_utils import write_log
from .calc_metric import summarize_tags, compilability_score


CREATE_TRANSLATED_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS translated_texts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    src_text_id INTEGER NOT NULL,
    src_lang TEXT NOT NULL,
    dst_lang TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    model_name TEXT,
    created_at TEXT,
    UNIQUE(src_text_id, dst_lang),
    FOREIGN KEY(src_text_id) REFERENCES texts(text_id)
);
"""


def ensure_translated_table(conn: sqlite3.Connection):
    conn.execute(CREATE_TRANSLATED_TABLE_SQL)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_translated_src "
        "ON translated_texts(src_text_id, dst_lang)"
    )
    conn.commit()


def insert_translation(
    conn: sqlite3.Connection,
    src_text_id: int,
    src_lang: str,
    dst_lang: str,
    translated_text: str,
    model_name: str,
):
    conn.execute(
        """
        INSERT OR REPLACE INTO translated_texts
            (src_text_id, src_lang, dst_lang, translated_text, model_name, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        """,
        (src_text_id, src_lang, dst_lang, translated_text, model_name),
    )

def process_translation_batch(
    conn: sqlite3.Connection,
    cfg: Config,
    tr: Translator,
    cache: Dict[str, str],
    batch_segments: List[str],
    batch_meta: List[Dict],
    p_bar: tqdm,
) -> Tuple[int, int, int]:
    """
    Старый вариант батч-перевода:
      - переводит защищённые сегменты,
      - восстанавливает токены,
      - сохраняет в БД и в cache.

    Возвращает (saved, dropped, errors).
    """
    saved = 0
    dropped = 0
    errors = 0

    if not batch_segments:
        return saved, dropped, errors

    segment_ids = [meta["text_id"] for meta in batch_meta]

    try:
        translated_list = tr.translate_batch(batch_segments, segment_ids=segment_ids)
    except Exception as e:
        write_log(f"process_translation_batch fatal error: {e!r}", "errors.log")
        return 0, 0, len(batch_segments)

    for meta, translated_protected in zip(batch_meta, translated_list):
        text_id = meta["text_id"]

        if translated_protected is None:
            write_log(f"DROPPED text_id={text_id} (no translation)", "errors.log")
            dropped += 1
            p_bar.update(1)
            continue

        try:
            cache[meta["cache_key"]] = translated_protected

            final_text = restore_tokens(translated_protected, meta["mapping"])

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
            p_bar.update(1)

        except Exception as e:
            errors += 1
            write_log(f"Error on saving text_id={text_id}: {e!r}", "errors.log")
            p_bar.update(1)
            continue

    save_cache(cfg.cache_path, cache)
    return saved, dropped, errors

@dataclass
class RowForTranslation:
    """
    Одна строка, подготовленная к переводу.
    """
    text_id: int
    src_text: str


def fetch_valid_rows_for_translation(
    cfg: Config,
) -> Tuple[List[RowForTranslation], Dict[str, int]]:
    """
    Получает из БД все кандидаты для перевода и фильтрует их по условиям:

    - строка в texts.lang = cfg.db_source_lang;
    - ещё нет перевода в translated_texts.dst_lang = cfg.db_target_lang;
    - существует референс (texts с тем же mod_id/file/key, но lang = cfg.db_target_lang);
    - и исходная строка, и референс корректны по тегам (summarize_tags + compilability_score).

    Возвращает:
      - список RowForTranslation;
      - словарь статистики.
    """
    conn = sqlite3.connect(cfg.db_path)
    conn.row_factory = sqlite3.Row
    ensure_translated_table(conn)

    src_lang_db = cfg.db_source_lang
    dst_lang_db = cfg.db_target_lang

    stats = {
        "total_raw": 0,
        "valid": 0,
        "skipped_empty_src": 0,
        "skipped_no_ref": 0,
        "skipped_bad_source": 0,
        "skipped_bad_ref": 0,
    }

    cursor = conn.execute(
        """
        SELECT p.pair_id,
               p.mod_id,
               p.key,
               t_src.text_id AS src_text_id,
               t_src.text    AS src_text,
               t_ref.text    AS ref_text
        FROM pairs p
                 JOIN texts t_src ON t_src.text_id = p.text1_id
                 JOIN texts t_ref ON t_ref.text_id = p.text2_id
                 LEFT JOIN translated_texts tt
                           ON tt.src_text_id = t_src.text_id AND tt.dst_lang = ?
        WHERE p.lang1 = ?
          AND p.lang2 = ?
          AND tt.id IS NULL
        """,
        (
            dst_lang_db,
            src_lang_db,
            dst_lang_db,
        ),
    )

    valid_rows: List[RowForTranslation] = []
    seen_src_ids: set[int] = set()

    for row in cursor:
        stats["total_raw"] += 1

        text_id = row["src_text_id"]
        src_text = row["src_text"]
        ref_text = row["ref_text"]


        if text_id in seen_src_ids:
            continue
        seen_src_ids.add(text_id)

        # Пустые исходники пропускаем
        if src_text is None or src_text.strip() == "":
            stats["skipped_empty_src"] += 1
            write_log(
                f"SKIPPED text_id={text_id}: пустой исходный текст.",
                "errors.log",
            )
            continue

        # Если нет референса — тоже пропускаем
        if ref_text is None or ref_text.strip() == "":
            stats["skipped_no_ref"] += 1
            write_log(
                f"SKIPPED text_id={text_id}: отсутствует референсный перевод (ref_text is NULL/empty).",
                "errors.log",
            )
            continue

        # Проверка корректности тегов исходника
        src_tags = summarize_tags(src_text)
        src_comp = compilability_score(src_tags)
        if src_comp < 1.0:
            stats["skipped_bad_source"] += 1
            write_log(
                f"SKIPPED source text_id={text_id} из-за сломанной разметки в исходнике "
                f"(compilability=0). Текст: {src_text}",
                "errors.log",
            )
            continue

        # Проверка корректности тегов референса
        ref_tags = summarize_tags(ref_text)
        ref_comp = compilability_score(ref_tags)
        if ref_comp < 1.0:
            stats["skipped_bad_ref"] += 1
            write_log(
                f"SKIPPED ref text_id={text_id} из-за сломанной разметки в референсе "
                f"(compilability=0). Референс: {ref_text}",
                "errors.log",
            )
            continue

        valid_rows.append(RowForTranslation(text_id=text_id, src_text=src_text))
        stats["valid"] += 1

    conn.close()
    return valid_rows, stats

def process_batch_with_tag_filter(
    conn: sqlite3.Connection,
    cfg: Config,
    tr: Translator,
    cache: Dict[str, str],
    batch_segments: List[str],
    batch_meta: List[Dict],
    p_bar: tqdm,
) -> Tuple[int, int, int]:
    """
    Перевод батча, восстановление токенов, проверка тегов уже в переведённой строке.

    Возвращает:
      processed  – сколько строк в батче обработано (успешно + скип);
      saved      – сколько записано в БД;
      skipped_bad_tags – сколько пропущено из-за битой разметки в переводе.
    """
    processed = 0
    saved = 0
    skipped_bad_tags = 0

    if not batch_segments:
        return processed, saved, skipped_bad_tags

    segment_ids = [meta["text_id"] for meta in batch_meta]

    try:
        translated_list = tr.translate_batch(batch_segments, segment_ids=segment_ids)
    except Exception as e:
        write_log(f"process_batch_with_tag_filter fatal error: {e!r}", "errors.log")
        # всё считаем как обработанное, но не сохранённое
        processed += len(batch_segments)
        p_bar.update(len(batch_segments))
        return processed, saved, skipped_bad_tags

    for meta, translated_protected in zip(batch_meta, translated_list):
        text_id = meta["text_id"]
        processed += 1

        if translated_protected is None:
            # модель не дала перевод
            write_log(
                f"SKIPPED text_id={text_id}: модель не вернула перевод (None).",
                "errors.log",
            )
            p_bar.update(1)
            continue

        try:
            # В кэш кладём защищённую версию перевода
            cache[meta["cache_key"]] = translated_protected

            final_text = restore_tokens(translated_protected, meta["mapping"])

            # Проверяем разметку в переводе
            cand_tags = summarize_tags(final_text)
            comp_score = compilability_score(cand_tags)

            if comp_score < 1.0:
                skipped_bad_tags += 1
                p_bar.update(1)
                write_log(
                    f"SKIPPED (from batch) text_id={text_id} из-за сломанной разметки "
                    f"(compilability=0). Перевод: {final_text}",
                    "errors.log",
                )
                continue

            # Дополнительная проверка на <ph ...>
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
            p_bar.update(1)

        except Exception as e:
            p_bar.update(1)
            write_log(
                f"Error on saving (with tag filter) text_id={text_id}: {e!r}",
                "errors.log",
            )
            continue

    save_cache(cfg.cache_path, cache)
    return processed, saved, skipped_bad_tags


def translate_database(cfg: Config, tr: Translator, cache: Dict[str, str]):
    """
    вариант перевода БД без валидации тегов
    """
    conn = sqlite3.connect(cfg.db_path)
    conn.row_factory = sqlite3.Row
    ensure_translated_table(conn)

    src_lang_db = cfg.db_source_lang
    dst_lang_db = cfg.db_target_lang

    total_to_translate = conn.execute(
        """
        SELECT COUNT(*)
        FROM texts t
        LEFT JOIN translated_texts tt
          ON tt.src_text_id = t.text_id AND tt.dst_lang = ?
        WHERE t.lang = ? AND tt.id IS NULL
        """,
        (dst_lang_db, src_lang_db),
    ).fetchone()[0]

    if total_to_translate == 0:
        print("Нет строк для перевода (всё уже переведено).")
        conn.close()
        return

    cursor = conn.execute(
        """
        SELECT t.text_id, t.mod_id, t.file, t."key", t.lang, t.text
        FROM texts t
        LEFT JOIN translated_texts tt
          ON tt.src_text_id = t.text_id AND tt.dst_lang = ?
        WHERE t.lang = ? AND tt.id IS NULL
        ORDER BY t.text_id
        """,
        (dst_lang_db, src_lang_db),
    )

    batch_segments: List[str] = []
    batch_meta: List[Dict] = []
    produced = 0
    total_saved = 0
    total_dropped = 0
    total_errors = 0

    with tqdm(total=total_to_translate, desc="DB rows", unit="row") as p_rows:
        for row in cursor:
            text_id = row["text_id"]
            original = row["text"]

            if original is None or original.strip() == "":
                p_rows.update(1)
                produced += 1
                continue

            protected, mapping = protect_tokens(original)
            cache_key = sha1(f"{protected}|{cfg.source_lang}>{cfg.target_lang}")

            # Если есть в кэше — пытаться сразу сохранить (не класть в батч)
            if cache_key in cache:
                translated_protected = cache[cache_key]
                final_text = restore_tokens(translated_protected, mapping)

                try:
                    if not cfg.dry_run:
                        insert_translation(
                            conn,
                            src_text_id=text_id,
                            src_lang=src_lang_db,
                            dst_lang=dst_lang_db,
                            translated_text=final_text,
                            model_name=tr._current_model(),
                        )
                        conn.commit()
                    total_saved += 1
                except Exception as e:  # noqa: BLE001
                    total_errors += 1
                    write_log(
                        f"Error saving cached translation text_id={text_id}: {e!r}",
                        "errors.log",
                    )

                produced += 1
                p_rows.update(1)

                if produced % 100 == 0:
                    print(
                        f"[DB] Уже переведено {produced} строк "
                        f"из {total_to_translate}"
                    )
                if produced % 20 == 0:
                    save_cache(cfg.cache_path, cache)
                continue

            batch_segments.append(protected)
            batch_meta.append(
                {"text_id": text_id, "mapping": mapping, "cache_key": cache_key}
            )

            if len(batch_segments) >= max(1, cfg.batch_size):
                saved, dropped, errors = process_translation_batch(
                    conn, cfg, tr, cache, batch_segments, batch_meta, p_rows
                )
                total_saved += saved
                total_dropped += dropped
                total_errors += errors

                batch_segments = []
                batch_meta = []

        if batch_segments:
            saved, dropped, errors = process_translation_batch(
                conn, cfg, tr, cache, batch_segments, batch_meta, p_rows
            )
            total_saved += saved
            total_dropped += dropped
            total_errors += errors

    save_cache(cfg.cache_path, cache)
    conn.close()

    print(
        f"Перевод БД завершён. Обработано примерно {total_to_translate} строк; "
        f"сохранено {total_saved}, dropped {total_dropped}, errors {total_errors}."
    )


def load_eval_data_for_model(
    db_path: pathlib.Path,
    model_name: str,
    src_lang: str,
    tgt_lang: str,
) -> pd.DataFrame:
    """
    Загружает (src, ref, hyp)
    """

    query = """
            SELECT t_src.text         AS src, \
                   t_ref.text         AS ref, \
                   tt.translated_text AS hyp
            FROM translated_texts AS tt
                     JOIN texts AS t_src
                          ON t_src.text_id = tt.src_text_id
                              AND t_src.lang = :src_lang
                     JOIN pairs AS p
                          ON p.text1_id = t_src.text_id
                              AND p.lang1 = :src_lang
                              AND p.lang2 = :tgt_lang
                     JOIN texts AS t_ref
                          ON t_ref.text_id = p.text2_id
                              AND t_ref.lang = :tgt_lang
            WHERE tt.model_name = :model_name
              AND tt.dst_lang = :tgt_lang LIMIT :count \
            """

    with sqlite3.connect(str(db_path)) as conn:
        df = pd.read_sql_query(
            query,
            conn,
            params={
                "src_lang": src_lang,
                "tgt_lang": tgt_lang,
                "model_name": model_name,
                "count": count,
            },
        )

    df = df.rename(columns={"hyp": "cand"})
    return df