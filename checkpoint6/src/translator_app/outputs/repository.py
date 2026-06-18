"""Repository for translated output file persistence."""

import hashlib
import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from translator_app.outputs.analysis.models import (
    AnalysisDiagnostic,
    OutputFileAnalysisResult,
)
from translator_app.outputs.hash_utils import hash_content, read_and_hash
from translator_app.outputs.models import (
    OutputFileAnalysisSummary,
    OutputFilesTree,
    OutputGroupNode,
    OutputJobNode,
    OutputModNode,
    TranslatedOutputFile,
)
from translator_app.storage.db import DatabaseService

logger = logging.getLogger(__name__)


class TranslatedOutputFileRepository:
    """SQLite-backed repository for translated output files and analysis.

    Thread-safe: all public mutations are serialized via ``_lock``.
    """

    def __init__(self, db: DatabaseService):
        self.db = db
        self._lock = threading.RLock()

    # ------------------------------------------------------------------
    # TranslatedOutputFile CRUD
    # ------------------------------------------------------------------

    def create_or_update(self, file: TranslatedOutputFile) -> TranslatedOutputFile:
        """Upsert a translated output file by id.

        Preserves ``created_at`` on update so that repeated scans do not
        reset the creation timestamp.  Only ``updated_at`` is refreshed.
        """
        with self._lock:
            conn = self.db.connect()
            now = _now()
            # Fetch existing record to preserve created_at
            existing = conn.execute(
                "SELECT created_at FROM translated_output_files WHERE id = ?",
                (file.id,),
            ).fetchone()
            created_at = existing["created_at"] if existing else (file.created_at or now)
            updated_at = now
            output_metadata_json = json.dumps(file.output_metadata or {})
            conn.execute(
                """INSERT OR REPLACE INTO translated_output_files
                   (id, job_id, mod_id, mod_name,
                    source_file_path, translated_file_path,
                    relative_source_path, relative_translated_path,
                    file_name, file_ext,
                    game_id, parser_id, aggregation_key,
                    group_key, group_label,
                    source_size_bytes, translated_size_bytes,
                    created_at, updated_at, last_analyzed_at,
                    editor_available, status, analysis_stale,
                    output_metadata_json,
                    current_source_hash, current_translated_hash)
                   VALUES (?, ?, ?, ?,
                           ?, ?,
                           ?, ?,
                           ?, ?,
                           ?, ?, ?,
                           ?, ?,
                           ?, ?,
                           ?, ?, ?,
                           ?, ?, ?,
                           ?,
                           ?, ?)""",
                (
                    file.id, file.job_id, file.mod_id, file.mod_name,
                    file.source_file_path, file.translated_file_path,
                    file.relative_source_path, file.relative_translated_path,
                    file.file_name, file.file_ext,
                    file.game_id, file.parser_id, file.aggregation_key,
                    file.group_key, file.group_label,
                    file.source_size_bytes, file.translated_size_bytes,
                    created_at, updated_at, file.last_analyzed_at,
                    1 if file.editor_available else 0,
                    file.status,
                    1 if file.analysis_stale else 0,
                    output_metadata_json,
                    file.current_source_hash,
                    file.current_translated_hash,
                ),
            )
            conn.commit()
            file.created_at = created_at
            file.updated_at = updated_at
            return file

    def update_after_save(
        self, output_file_id: str, updated_at: str, translated_size_bytes: int,
        current_translated_hash: Optional[str] = None,
    ) -> None:
        """Update metadata after a translated content save.

        Sets ``updated_at``, ``translated_size_bytes``, ``current_translated_hash``,
        and marks ``analysis_stale = 1``.
        """
        with self._lock:
            conn = self.db.connect()
            conn.execute(
                """UPDATE translated_output_files
                   SET updated_at = ?,
                       translated_size_bytes = ?,
                       current_translated_hash = ?,
                       analysis_stale = 1
                   WHERE id = ?""",
                (updated_at, translated_size_bytes, current_translated_hash, output_file_id),
            )
            conn.commit()

    def update_current_hashes(
        self, output_file_id: str,
        current_source_hash: Optional[str] = None,
        current_translated_hash: Optional[str] = None,
    ) -> None:
        """Update the current content hashes for an output file.

        These hashes reflect the file content currently on disk and are
        used to determine whether an existing analysis result is still valid.
        """
        with self._lock:
            conn = self.db.connect()
            conn.execute(
                """UPDATE translated_output_files
                   SET current_source_hash = ?,
                       current_translated_hash = ?
                   WHERE id = ?""",
                (current_source_hash, current_translated_hash, output_file_id),
            )
            conn.commit()

    def compute_and_update_current_hashes(
        self, output_file_id: str, source_path: str, translated_path: str,
    ) -> tuple:
        """Read files from disk, compute hashes, and persist them.

        Returns ``(source_hash, translated_hash)`` — the computed hashes
        (each may be ``None`` if the file is missing or unreadable).
        """
        source_hash = read_and_hash(source_path)
        translated_hash = read_and_hash(translated_path)

        self.update_current_hashes(
            output_file_id=output_file_id,
            current_source_hash=source_hash,
            current_translated_hash=translated_hash,
        )
        return source_hash, translated_hash

    def get_by_id(self, output_file_id: str) -> Optional[TranslatedOutputFile]:
        """Get a single output file by id, with latest analysis."""
        with self._lock:
            conn = self.db.connect()
            row = conn.execute(
                "SELECT * FROM translated_output_files WHERE id = ?",
                (output_file_id,),
            ).fetchone()
            if not row:
                return None
            result = self._row_to_file(row)
            result.latest_analysis = self.get_latest_analysis(output_file_id)
            return result

    def list_files(
        self,
        job_id: Optional[str] = None,
        mod_id: Optional[str] = None,
        group_key: Optional[str] = None,
        status: Optional[str] = None,
        q: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[TranslatedOutputFile]:
        """List output files with optional filters and full-text search.

        The ``q`` parameter searches across file_name, relative_source_path,
        relative_translated_path, and mod_name.
        """
        with self._lock:
            conn = self.db.connect()
            where_clauses: List[str] = []
            params: list = []

            if job_id is not None:
                where_clauses.append("f.job_id = ?")
                params.append(job_id)
            if mod_id is not None:
                where_clauses.append("f.mod_id = ?")
                params.append(mod_id)
            if group_key is not None:
                where_clauses.append("f.group_key = ?")
                params.append(group_key)
            if status is not None:
                where_clauses.append("f.status = ?")
                params.append(status)
            if q is not None and q.strip():
                like = f"%{q.strip()}%"
                where_clauses.append(
                    "(f.file_name LIKE ? OR f.relative_source_path LIKE ? "
                    "OR f.relative_translated_path LIKE ? OR f.mod_name LIKE ?)"
                )
                params.extend([like, like, like, like])

            where = ""
            if where_clauses:
                where = "WHERE " + " AND ".join(where_clauses)

            sql = f"""
                SELECT f.*, a.id as analysis_id, a.status as analysis_status,
                       a.compilability_score, a.placeholders_score,
                       a.errors_count as analysis_errors_count,
                       a.warnings_count as analysis_warnings_count,
                       a.created_at as analysis_created_at
                FROM translated_output_files f
                LEFT JOIN translated_output_file_analysis a
                    ON a.id = (
                        SELECT a2.id FROM translated_output_file_analysis a2
                        WHERE a2.output_file_id = f.id
                        ORDER BY a2.created_at DESC LIMIT 1
                    )
                {where}
                ORDER BY f.file_name ASC
                LIMIT ? OFFSET ?
            """
            params.append(limit)
            params.append(offset)

            rows = conn.execute(sql, tuple(params)).fetchall()
            return [self._row_to_file_with_analysis(r) for r in rows]

    def count_files(
        self,
        job_id: Optional[str] = None,
        mod_id: Optional[str] = None,
        group_key: Optional[str] = None,
        status: Optional[str] = None,
        q: Optional[str] = None,
    ) -> int:
        """Count output files matching the given filters."""
        with self._lock:
            conn = self.db.connect()
            where_clauses: List[str] = []
            params: list = []

            if job_id is not None:
                where_clauses.append("job_id = ?")
                params.append(job_id)
            if mod_id is not None:
                where_clauses.append("mod_id = ?")
                params.append(mod_id)
            if group_key is not None:
                where_clauses.append("group_key = ?")
                params.append(group_key)
            if status is not None:
                where_clauses.append("status = ?")
                params.append(status)
            if q is not None and q.strip():
                like = f"%{q.strip()}%"
                where_clauses.append(
                    "(file_name LIKE ? OR relative_source_path LIKE ? "
                    "OR relative_translated_path LIKE ? OR mod_name LIKE ?)"
                )
                params.extend([like, like, like, like])

            where = ""
            if where_clauses:
                where = "WHERE " + " AND ".join(where_clauses)

            row = conn.execute(
                f"SELECT COUNT(*) as cnt FROM translated_output_files {where}",
                tuple(params),
            ).fetchone()
            return row["cnt"] if row else 0

    # ------------------------------------------------------------------
    # Analysis methods
    # ------------------------------------------------------------------

    def get_latest_analysis(self, output_file_id: str) -> Optional[OutputFileAnalysisSummary]:
        """Get the most recent analysis record for an output file.

        Returns a summary including ``source_hash`` and ``translated_hash``
        so callers can evaluate analysis validity.
        """
        with self._lock:
            conn = self.db.connect()
            row = conn.execute(
                """SELECT id, status, compilability_score, placeholders_score,
                          errors_count, warnings_count, created_at,
                          source_hash, translated_hash
                   FROM translated_output_file_analysis
                   WHERE output_file_id = ?
                   ORDER BY created_at DESC LIMIT 1""",
                (output_file_id,),
            ).fetchone()
            return self._row_to_analysis(row) if row else None

    def list_latest_analysis_for_files(
        self, output_file_ids: List[str]
    ) -> Dict[str, OutputFileAnalysisSummary]:
        """Get the latest analysis for each output file id, keyed by file id.

        Uses a single query to avoid N+1.
        """
        if not output_file_ids:
            return {}

        with self._lock:
            conn = self.db.connect()
            placeholders = ",".join("?" for _ in output_file_ids)
            rows = conn.execute(
                f"""SELECT a.*
                    FROM translated_output_file_analysis a
                    INNER JOIN (
                        SELECT output_file_id, MAX(created_at) as max_created
                        FROM translated_output_file_analysis
                        WHERE output_file_id IN ({placeholders})
                        GROUP BY output_file_id
                    ) latest ON a.output_file_id = latest.output_file_id
                        AND a.created_at = latest.max_created""",
                tuple(output_file_ids),
            ).fetchall()

            result: Dict[str, OutputFileAnalysisSummary] = {}
            for row in rows:
                analysis = self._row_to_analysis(row)
                if analysis:
                    result[row["output_file_id"]] = analysis
            return result

    # ------------------------------------------------------------------
    # Output file refs (lightweight id + path lookup)
    # ------------------------------------------------------------------

    def get_output_file_refs(
        self, job_id: str,
    ) -> List[Dict[str, str]]:
        """Return lightweight (id, translated_file_path) refs for all files
        belonging to *job_id*.  Minimal query — no JOINs, no analysis."""
        with self._lock:
            conn = self.db.connect()
            rows = conn.execute(
                "SELECT id, translated_file_path FROM translated_output_files "
                "WHERE job_id = ? ORDER BY file_name ASC",
                (job_id,),
            ).fetchall()
            return [
                {"id": row["id"], "path": row["translated_file_path"]}
                for row in rows
            ]

    def get_output_file_refs_batch(
        self, job_ids: List[str],
    ) -> Dict[str, List[Dict[str, str]]]:
        """Return output file refs grouped by job_id for all given *job_ids*.

        Returns a dict mapping each job_id to a list of ``{id, path}`` dicts.
        """
        if not job_ids:
            return {}
        with self._lock:
            conn = self.db.connect()
            placeholders = ",".join("?" for _ in job_ids)
            rows = conn.execute(
                f"SELECT id, job_id, translated_file_path "
                f"FROM translated_output_files "
                f"WHERE job_id IN ({placeholders}) "
                f"ORDER BY file_name ASC",
                tuple(job_ids),
            ).fetchall()
            result: Dict[str, List[Dict[str, str]]] = {}
            for row in rows:
                jid = row["job_id"]
                if jid not in result:
                    result[jid] = []
                result[jid].append(
                    {"id": row["id"], "path": row["translated_file_path"]}
                )
            return result

    # ------------------------------------------------------------------
    # Tree building
    # ------------------------------------------------------------------

    def build_tree(self, job_id: Optional[str] = None) -> OutputFilesTree:
        """Build a tree of jobs -> mods -> groups -> files.

        If job_id is provided, only files for that job are included.
        """
        with self._lock:
            conn = self.db.connect()
            params: list = []
            job_filter = ""
            if job_id is not None:
                job_filter = "WHERE job_id = ?"
                params.append(job_id)

            rows = conn.execute(
                f"""SELECT id, job_id, mod_id, mod_name, group_key, group_label,
                           file_name, source_file_path, relative_source_path,
                           relative_translated_path, status
                    FROM translated_output_files
                    {job_filter}
                    ORDER BY job_id, mod_id, group_key, file_name""",
                tuple(params),
            ).fetchall()

            jobs: Dict[str, OutputJobNode] = {}
            for row in rows:
                jid = row["job_id"]
                mid = row["mod_id"] or ""
                mname = row["mod_name"] or mid or ""
                gkey = row["group_key"] or "__root__"
                glabel = row["group_label"] or "Root"

                if jid not in jobs:
                    jobs[jid] = OutputJobNode(job_id=jid, mods={})

                job_node = jobs[jid]
                if mid not in job_node.mods:
                    job_node.mods[mid] = OutputModNode(
                        mod_id=mid,
                        mod_name=mname,
                        groups={},
                    )

                mod_node = job_node.mods[mid]
                if gkey not in mod_node.groups:
                    mod_node.groups[gkey] = OutputGroupNode(
                        group_key=gkey,
                        group_label=glabel,
                        files=[],
                    )

                # Compute source_file_name from source_file_path or
                # relative_source_path
                source_path = row["source_file_path"] or ""
                rel_source = row["relative_source_path"] or ""
                source_file_name = (
                    Path(source_path).name
                    if source_path
                    else (Path(rel_source).name if rel_source else None)
                )

                mod_node.groups[gkey].files.append(
                    {
                        "id": row["id"],
                        "file_name": row["file_name"],
                        "source_file_name": source_file_name,
                        "source_file_path": source_path,
                        "relative_source_path": row["relative_source_path"],
                        "relative_translated_path": row["relative_translated_path"],
                        "status": row["status"],
                    }
                )

            return OutputFilesTree(jobs=jobs)

    # ------------------------------------------------------------------
    # Summary for a job
    # ------------------------------------------------------------------

    def get_job_summary(self, job_id: str) -> dict:
        """Get summary statistics for output files of a given job."""
        with self._lock:
            conn = self.db.connect()

            # File-level counts
            file_counts = conn.execute(
                """SELECT
                       COUNT(*) as files_count,
                       COUNT(DISTINCT mod_id) as mods_count,
                       COUNT(DISTINCT group_key) as groups_count
                   FROM translated_output_files
                   WHERE job_id = ?""",
                (job_id,),
            ).fetchone()

            # Status counts
            status_rows = conn.execute(
                """SELECT status, COUNT(*) as cnt
                   FROM translated_output_files
                   WHERE job_id = ?
                   GROUP BY status""",
                (job_id,),
            ).fetchall()

            # Stale count
            stale_row = conn.execute(
                """SELECT COUNT(*) as cnt
                   FROM translated_output_files
                   WHERE job_id = ? AND analysis_stale = 1""",
                (job_id,),
            ).fetchone()

            # Analysis counts — only count the latest analysis per file
            analysis_counts = conn.execute(
                """SELECT
                       COUNT(DISTINCT a.output_file_id) as analyzed_count,
                       COALESCE(SUM(CASE WHEN a.status = 'passed' THEN 1 ELSE 0 END), 0) as passed_count,
                       COALESCE(SUM(CASE WHEN a.status = 'warning' THEN 1 ELSE 0 END), 0) as warning_count,
                       COALESCE(SUM(CASE WHEN a.status = 'failed' THEN 1 ELSE 0 END), 0) as failed_count,
                       COALESCE(SUM(CASE WHEN a.status = 'error' THEN 1 ELSE 0 END), 0) as error_count
                   FROM translated_output_file_analysis a
                   INNER JOIN (
                       SELECT output_file_id, MAX(created_at) as max_created
                       FROM translated_output_file_analysis
                       WHERE job_id = ?
                       GROUP BY output_file_id
                   ) latest ON a.output_file_id = latest.output_file_id
                       AND a.created_at = latest.max_created""",
                (job_id,),
            ).fetchone()

            analyzed_count = analysis_counts["analyzed_count"] or 0
            passed_count = analysis_counts["passed_count"] or 0
            warning_count = analysis_counts["warning_count"] or 0
            failed_count = analysis_counts["failed_count"] or 0
            error_count = analysis_counts["error_count"] or 0

            # missing: files with no analysis record
            total_files = file_counts["files_count"] or 0
            missing_count = total_files - analyzed_count

            return {
                "files_count": file_counts["files_count"] or 0,
                "mods_count": file_counts["mods_count"] or 0,
                "groups_count": file_counts["groups_count"] or 0,
                "analyzed_count": analyzed_count,
                "passed_count": passed_count,
                "warning_count": warning_count,
                "failed_count": failed_count,
                "error_count": error_count,
                "missing_count": max(missing_count, 0),
                "stale_count": stale_row["cnt"] or 0,
            }

    def save_analysis(self, result: OutputFileAnalysisResult) -> None:
        """Persist an analysis result to the ``translated_output_file_analysis`` table.

        The ``diagnostics_json`` column is stored as JSON.
        ``errors_count`` and ``warnings_count`` are derived from the
        diagnostics list.

        If ``result.analysis_metadata`` is set, it is embedded in the
        diagnostics JSON under a reserved ``__analysis_metadata__`` key
        for persistence without a schema migration.
        """
        diag_list: list[dict] = [
            {
                "severity": d.severity,
                "code": d.code,
                "message": d.message,
                "source": d.source,
                "line": d.line,
                "column": d.column,
                "key": d.key,
                "details": d.details,
            }
            for d in result.diagnostics
        ]

        if result.analysis_metadata is not None:
            diag_list.append({
                "severity": "info",
                "code": "__analysis_metadata__",
                "message": "",
                "source": "metadata",
                "details": result.analysis_metadata,
            })

        diagnostics_json = json.dumps(diag_list)

        with self._lock:
            conn = self.db.connect()
            conn.execute(
                """INSERT OR REPLACE INTO translated_output_file_analysis
                   (id, output_file_id, job_id, analyzer_version, status,
                    compilability_score, placeholders_score,
                    errors_count, warnings_count,
                    source_hash, translated_hash,
                    diagnostics_json, created_at)
                   VALUES (?, ?, ?, ?, ?,
                           ?, ?,
                           ?, ?,
                           ?, ?,
                           ?, ?)""",
                (
                    result.id,
                    result.output_file_id,
                    result.job_id,
                    result.analyzer_version,
                    result.status.value,
                    result.compilability_score,
                    result.placeholders_score,
                    result.errors_count,
                    result.warnings_count,
                    result.source_hash,
                    result.translated_hash,
                    diagnostics_json,
                    result.created_at,
                ),
            )
            conn.commit()

    def mark_analysis_complete(
        self, output_file_id: str, analyzed_at: str,
        expected_source_hash: Optional[str] = None,
        expected_translated_hash: Optional[str] = None,
    ) -> bool:
        """Update file metadata after a successful analysis.

        Sets ``last_analyzed_at`` and clears ``analysis_stale`` only if
        the current content hashes still match *expected_source_hash* and
        *expected_translated_hash*.  This prevents the race where a file
        is modified while analysis is running.

        Args:
            output_file_id: The file to update.
            analyzed_at: Timestamp of the analysis.
            expected_source_hash: The source hash the analysis was computed
                against.  If provided and the current on-disk hash differs,
                the stale flag is **not** cleared (the analysis result is
                stored in history but is no longer the latest valid).
            expected_translated_hash: Same for translated content.

        Returns:
            ``True`` if the analysis was marked complete (stale cleared),
            ``False`` if a hash mismatch was detected (stale kept).
        """
        with self._lock:
            conn = self.db.connect()

            if expected_source_hash is not None or expected_translated_hash is not None:
                # Re-read current hashes from the DB to check for races.
                # These were updated before calling mark_analysis_complete.
                current = conn.execute(
                    "SELECT current_source_hash, current_translated_hash "
                    "FROM translated_output_files WHERE id = ?",
                    (output_file_id,),
                ).fetchone()

                if current:
                    hash_mismatch = (
                        (expected_source_hash is not None
                         and current["current_source_hash"] != expected_source_hash)
                        or (expected_translated_hash is not None
                            and current["current_translated_hash"] != expected_translated_hash)
                    )
                    if hash_mismatch:
                        # File changed during analysis — store result in history
                        # but do not clear stale flag (latest valid pointer
                        # remains on the previous analysis, or none).
                        conn.execute(
                            """UPDATE translated_output_files
                               SET last_analyzed_at = ?
                               WHERE id = ?""",
                            (analyzed_at, output_file_id),
                        )
                        conn.commit()
                        logger.warning(
                            "File %s changed during analysis; result stored in "
                            "history but not set as latest valid (hash mismatch)",
                            output_file_id,
                        )
                        return False

            conn.execute(
                """UPDATE translated_output_files
                   SET last_analyzed_at = ?,
                       analysis_stale = 0
                   WHERE id = ?""",
                (analyzed_at, output_file_id),
            )
            conn.commit()
            return True

    def list_files_for_analysis(
        self,
        job_id: Optional[str] = None,
        mod_id: Optional[str] = None,
        group_key: Optional[str] = None,
        output_file_ids: Optional[List[str]] = None,
        only_stale: bool = False,
    ) -> List[TranslatedOutputFile]:
        """List output files for batch analysis, with stale-filtering support.

        Returns files matching the given criteria.  When *only_stale* is
        True, only files with ``analysis_stale = 1`` or no latest analysis
        are returned.
        """
        with self._lock:
            conn = self.db.connect()
            where_clauses: List[str] = []
            params: list = []

            if job_id is not None:
                where_clauses.append("f.job_id = ?")
                params.append(job_id)
            if mod_id is not None:
                where_clauses.append("f.mod_id = ?")
                params.append(mod_id)
            if group_key is not None:
                where_clauses.append("f.group_key = ?")
                params.append(group_key)
            if output_file_ids is not None:
                placeholders = ",".join("?" for _ in output_file_ids)
                where_clauses.append(f"f.id IN ({placeholders})")
                params.extend(output_file_ids)

            where = ""
            if where_clauses:
                where = "WHERE " + " AND ".join(where_clauses)

            if only_stale:
                # Only stale or never-analyzed files
                sql = f"""
                    SELECT f.*, a.id as analysis_id, a.status as analysis_status,
                           a.compilability_score, a.placeholders_score,
                           a.errors_count as analysis_errors_count,
                           a.warnings_count as analysis_warnings_count,
                           a.created_at as analysis_created_at
                    FROM translated_output_files f
                    LEFT JOIN translated_output_file_analysis a
                        ON a.id = (
                            SELECT a2.id FROM translated_output_file_analysis a2
                            WHERE a2.output_file_id = f.id
                            ORDER BY a2.created_at DESC LIMIT 1
                        )
                    {where}
                    HAVING f.analysis_stale = 1 OR analysis_id IS NULL
                    ORDER BY f.file_name ASC
                """
            else:
                sql = f"""
                    SELECT f.*, a.id as analysis_id, a.status as analysis_status,
                           a.compilability_score, a.placeholders_score,
                           a.errors_count as analysis_errors_count,
                           a.warnings_count as analysis_warnings_count,
                           a.created_at as analysis_created_at
                    FROM translated_output_files f
                    LEFT JOIN translated_output_file_analysis a
                        ON a.id = (
                            SELECT a2.id FROM translated_output_file_analysis a2
                            WHERE a2.output_file_id = f.id
                            ORDER BY a2.created_at DESC LIMIT 1
                        )
                    {where}
                    ORDER BY f.file_name ASC
                """

            rows = conn.execute(sql, tuple(params)).fetchall()
            return [self._row_to_file_with_analysis(r) for r in rows]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _safe_row_get(row, key, default=None):
        """Safely get a value from a ``sqlite3.Row``, returning *default* if the
        column is not present in the result set."""
        try:
            return row[key]
        except (KeyError, IndexError):
            return default

    @staticmethod
    def _row_to_file(row) -> TranslatedOutputFile:
        metadata_raw = TranslatedOutputFileRepository._safe_row_get(row, "output_metadata_json")
        output_metadata = None
        if metadata_raw:
            try:
                output_metadata = json.loads(metadata_raw) if isinstance(metadata_raw, str) else metadata_raw
            except (json.JSONDecodeError, TypeError):
                output_metadata = None
        return TranslatedOutputFile(
            id=row["id"],
            job_id=row["job_id"],
            mod_id=row["mod_id"],
            mod_name=row["mod_name"],
            source_file_path=row["source_file_path"],
            translated_file_path=row["translated_file_path"],
            relative_source_path=row["relative_source_path"],
            relative_translated_path=row["relative_translated_path"],
            file_name=row["file_name"],
            file_ext=row["file_ext"],
            game_id=row["game_id"],
            parser_id=row["parser_id"],
            aggregation_key=row["aggregation_key"],
            group_key=row["group_key"],
            group_label=row["group_label"],
            source_size_bytes=row["source_size_bytes"],
            translated_size_bytes=row["translated_size_bytes"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            last_analyzed_at=row["last_analyzed_at"],
            editor_available=bool(row["editor_available"]),
            status=row["status"],
            analysis_stale=bool(row["analysis_stale"]),
            output_metadata=output_metadata,
            current_source_hash=TranslatedOutputFileRepository._safe_row_get(row, "current_source_hash"),
            current_translated_hash=TranslatedOutputFileRepository._safe_row_get(row, "current_translated_hash"),
        )

    @staticmethod
    def _row_to_analysis(row) -> Optional[OutputFileAnalysisSummary]:
        if not row:
            return None
        return OutputFileAnalysisSummary(
            id=row["id"],
            status=row["status"],
            compilability_score=row["compilability_score"],
            placeholders_score=row["placeholders_score"],
            errors_count=row["errors_count"],
            warnings_count=row["warnings_count"],
            created_at=row["created_at"],
            source_hash=TranslatedOutputFileRepository._safe_row_get(row, "source_hash"),
            translated_hash=TranslatedOutputFileRepository._safe_row_get(row, "translated_hash"),
        )

    @staticmethod
    def _row_to_file_with_analysis(row) -> TranslatedOutputFile:
        file = TranslatedOutputFileRepository._row_to_file(row)
        if row["analysis_id"] is not None:
            file.latest_analysis = OutputFileAnalysisSummary(
                id=row["analysis_id"],
                status=row["analysis_status"],
                compilability_score=row["compilability_score"],
                placeholders_score=row["placeholders_score"],
                errors_count=row["analysis_errors_count"],
                warnings_count=row["analysis_warnings_count"],
                created_at=row["analysis_created_at"],
            )
        return file


    # ------------------------------------------------------------------
    # Freshness state computation
    # ------------------------------------------------------------------

    @staticmethod
    def compute_freshness_state(
        file: TranslatedOutputFile,
    ) -> str:
        """Determine the freshness state of the latest analysis.

        Returns one of:
            - ``"not_analyzed"`` — no analysis exists.
            - ``"unknown"`` — analysis exists but at least one required hash
              (source or translated) is ``None`` in either the analysis
              result or the current file hashes, so freshness cannot be
              determined.
            - ``"current"`` — all required hashes are non-``None`` and match.
            - ``"outdated"`` — all required hashes are non-``None`` and at
              least one pair differs.

        Hash comparison rule:
            - non-null stored source hash must equal non-null current
              source hash;
            - non-null stored translated hash must equal non-null current
              translated hash;
            - if no analysis exists → ``not_analyzed``;
            - if any required hash is ``None`` → ``unknown``;
            - if hashes are present and match → ``current``;
            - if hashes are present and differ → ``outdated``.
        """
        analysis = file.latest_analysis
        if analysis is None:
            return "not_analyzed"

        # All four hashes must be non-None to perform a valid comparison
        if (
            analysis.source_hash is None
            or analysis.translated_hash is None
            or file.current_source_hash is None
            or file.current_translated_hash is None
        ):
            return "unknown"

        source_match = analysis.source_hash == file.current_source_hash
        translated_match = analysis.translated_hash == file.current_translated_hash

        if source_match and translated_match:
            return "current"
        return "outdated"

    @staticmethod
    def get_analysis_state(
        file: TranslatedOutputFile,
    ) -> str:
        """Alias for :meth:`compute_freshness_state`.

        Retained for backward compatibility while callers migrate.
        """
        return TranslatedOutputFileRepository.compute_freshness_state(file)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
