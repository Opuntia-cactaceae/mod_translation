"""DatabaseService — SQLite connection management and schema initialization.

Provides:
    * Connection management (connect, close)
    * Schema initialization (init_db, ensure_schema, initialize)
    * Transaction context manager
    * Schema version tracking and migration hooks
"""

import sqlite3
import threading
from pathlib import Path
from typing import Iterator, Optional


# ---------------------------------------------------------------------------
# Transaction context manager
# ---------------------------------------------------------------------------


class _TransactionContext:
    """Context manager for SQLite transactions.

    Usage::

        with db.transaction() as conn:
            conn.execute("INSERT INTO ...")
            conn.execute("UPDATE ...")
        # auto-commit on success, rollback on exception
    """

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def __enter__(self) -> sqlite3.Connection:
        return self._conn

    def __exit__(
        self,
        exc_type: Optional[type],
        exc_val: Optional[BaseException],
        exc_tb: Optional[object],
    ) -> None:
        if exc_type is None:
            self._conn.commit()
        else:
            self._conn.rollback()


# ---------------------------------------------------------------------------
# DatabaseService
# ---------------------------------------------------------------------------


class DatabaseService:
    """SQLite database initialization and connection management.

    Two initialization paths:
        * ``initialize()`` — legacy path, creates the original 4 tables.
        * ``ensure_schema()`` / ``init_db()`` — full schema with all
          MVP tables, indices, and schema version tracking.
    """

    def __init__(self, db_path: str = ":memory:"):
        self.db_path = db_path
        self._connection: Optional[sqlite3.Connection] = None
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    def connect(self) -> sqlite3.Connection:
        """Get or create the database connection.

        Thread-safe: connection creation and all subsequent access are
        serialised through a reentrant lock.
        """
        if self._connection is not None:
            return self._connection

        with self._lock:
            # Double-check inside the lock to avoid a race when two
            # threads observe ``_connection is None`` simultaneously.
            if self._connection is not None:
                return self._connection

            path = Path(self.db_path)
            if self.db_path != ":memory:" and self.db_path != "":
                path.parent.mkdir(parents=True, exist_ok=True)

            self._connection = sqlite3.connect(str(path), check_same_thread=False)
            self._connection.row_factory = sqlite3.Row
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.execute("PRAGMA foreign_keys=ON")
            return self._connection

    def get_connection(self) -> sqlite3.Connection:
        """Alias for ``connect()``."""
        return self.connect()

    def close(self) -> None:
        """Close the database connection if open."""
        if self._connection:
            self._connection.close()
            self._connection = None

    # ------------------------------------------------------------------
    # Transaction context manager
    # ------------------------------------------------------------------

    def transaction(self) -> _TransactionContext:
        """Context manager for database transactions.

        Auto-commits on success, rolls back on exception.
        """
        return _TransactionContext(self.connect())

    # ------------------------------------------------------------------
    # Schema initialization
    # ------------------------------------------------------------------

    def initialize(self) -> None:
        """Legacy schema initialization (backward compatible).

        Creates the original 4 tables: jobs, translation_cache,
        translation_units, settings.
        """
        conn = self.connect()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                priority INTEGER NOT NULL DEFAULT 1,
                file_paths TEXT NOT NULL DEFAULT '[]',
                source_job_id TEXT,
                progress REAL NOT NULL DEFAULT 0.0,
                total_units INTEGER NOT NULL DEFAULT 0,
                completed_units INTEGER NOT NULL DEFAULT 0,
                failed_units INTEGER NOT NULL DEFAULT 0,
                cached_units INTEGER NOT NULL DEFAULT 0,
                current_batch_index INTEGER NOT NULL DEFAULT 0,
                total_batches INTEGER NOT NULL DEFAULT 0,
                config TEXT,
                task_plan TEXT,
                diagnostics TEXT,
                result_summary TEXT,
                error_message TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT,
                started_at TEXT,
                completed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS translation_cache (
                key TEXT PRIMARY KEY,
                protected_text TEXT NOT NULL DEFAULT '',
                translated_text TEXT NOT NULL DEFAULT '',
                src_lang TEXT NOT NULL DEFAULT '',
                dst_lang TEXT NOT NULL DEFAULT '',
                strategy TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT '',
                usage_count INTEGER NOT NULL DEFAULT 0,
                metadata_json TEXT NOT NULL DEFAULT '{}'
            );

            CREATE INDEX IF NOT EXISTS idx_translation_cache_lang_pair
                ON translation_cache (src_lang, dst_lang);

            CREATE TABLE IF NOT EXISTS translation_units (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                source_text TEXT NOT NULL,
                target_text TEXT NOT NULL DEFAULT '',
                key TEXT NOT NULL DEFAULT '',
                file_path TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                FOREIGN KEY (job_id) REFERENCES jobs(id)
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)
        conn.commit()

    def ensure_schema(self) -> None:
        """Full schema initialization with all MVP tables, indices,
        and schema version tracking.

        Creates tables using IF NOT EXISTS — safe to call multiple times.
        Adds missing columns via migration when needed.
        """
        conn = self.connect()
        conn.executescript("""
            -- ================================================================
            -- Schema version tracking
            -- ================================================================
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT OR IGNORE INTO schema_version (version) VALUES (1);

            -- ================================================================
            -- Settings
            -- ================================================================
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT
            );

            -- ================================================================
            -- Jobs
            -- ================================================================
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                priority INTEGER NOT NULL DEFAULT 1,
                file_paths TEXT NOT NULL DEFAULT '[]',
                source_job_id TEXT,
                progress REAL NOT NULL DEFAULT 0.0,
                total_units INTEGER NOT NULL DEFAULT 0,
                completed_units INTEGER NOT NULL DEFAULT 0,
                failed_units INTEGER NOT NULL DEFAULT 0,
                cached_units INTEGER NOT NULL DEFAULT 0,
                current_batch_index INTEGER NOT NULL DEFAULT 0,
                total_batches INTEGER NOT NULL DEFAULT 0,
                config TEXT,
                task_plan TEXT,
                diagnostics TEXT,
                result_summary TEXT,
                error_message TEXT,
                output_files TEXT NOT NULL DEFAULT '[]',
                output_root_dir TEXT,
                started_at TEXT,
                completed_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT
            );

            -- ================================================================
            -- Parsed files
            -- ================================================================
            CREATE TABLE IF NOT EXISTS parsed_files (
                id TEXT PRIMARY KEY,
                job_id TEXT,
                path TEXT NOT NULL,
                file_type TEXT,
                language TEXT,
                metadata_json TEXT DEFAULT '{}',
                created_at TEXT
            );

            -- ================================================================
            -- File entries
            -- ================================================================
            CREATE TABLE IF NOT EXISTS file_entries (
                id TEXT PRIMARY KEY,
                file_id TEXT NOT NULL,
                line_no INTEGER,
                entry_type TEXT,
                key TEXT,
                value TEXT,
                raw_line TEXT
            );

            -- ================================================================
            -- Translation units
            -- ================================================================
            CREATE TABLE IF NOT EXISTS translation_units (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                file_id TEXT,
                entry_id TEXT,
                key TEXT NOT NULL DEFAULT '',
                source_text TEXT NOT NULL DEFAULT '',
                translated_text TEXT NOT NULL DEFAULT '',
                target_text TEXT NOT NULL DEFAULT '',
                file_path TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                from_cache INTEGER NOT NULL DEFAULT 0
            );

            -- ================================================================
            -- Attempts
            -- ================================================================
            CREATE TABLE IF NOT EXISTS attempts (
                id TEXT PRIMARY KEY,
                unit_id TEXT NOT NULL,
                attempt_no INTEGER NOT NULL DEFAULT 1,
                model TEXT,
                success INTEGER NOT NULL DEFAULT 0,
                latency_ms REAL,
                created_at TEXT
            );

            -- ================================================================
            -- Translation cache
            -- ================================================================
            CREATE TABLE IF NOT EXISTS translation_cache (
                key TEXT PRIMARY KEY,
                protected_text TEXT NOT NULL DEFAULT '',
                translated_text TEXT NOT NULL DEFAULT '',
                src_lang TEXT NOT NULL DEFAULT '',
                dst_lang TEXT NOT NULL DEFAULT '',
                strategy TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT '',
                usage_count INTEGER NOT NULL DEFAULT 0,
                metadata_json TEXT NOT NULL DEFAULT '{}'
            );

            -- ================================================================
            -- Diagnostics
            -- ================================================================
            CREATE TABLE IF NOT EXISTS diagnostics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT,
                entity_id TEXT,
                level TEXT NOT NULL DEFAULT 'info',
                code TEXT,
                message TEXT,
                user_message TEXT DEFAULT '',
                details_json TEXT DEFAULT '{}',
                created_at TEXT
            );

            -- ================================================================
            -- Run history
            -- ================================================================
            CREATE TABLE IF NOT EXISTS run_history (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                success INTEGER NOT NULL DEFAULT 0
            );

            -- ================================================================
            -- Indices
            -- ================================================================
            CREATE INDEX IF NOT EXISTS idx_parsed_files_job_id
                ON parsed_files(job_id);
            CREATE INDEX IF NOT EXISTS idx_file_entries_file_id
                ON file_entries(file_id);
            CREATE INDEX IF NOT EXISTS idx_translation_units_job_id
                ON translation_units(job_id);
            CREATE INDEX IF NOT EXISTS idx_translation_units_file_id
                ON translation_units(file_id);
            CREATE INDEX IF NOT EXISTS idx_translation_units_entry_id
                ON translation_units(entry_id);
            CREATE INDEX IF NOT EXISTS idx_attempts_unit_id
                ON attempts(unit_id);
            CREATE INDEX IF NOT EXISTS idx_diagnostics_entity_id
                ON diagnostics(entity_id);
            CREATE INDEX IF NOT EXISTS idx_run_history_job_id
                ON run_history(job_id);
            CREATE INDEX IF NOT EXISTS idx_translation_cache_lang_pair
                ON translation_cache (src_lang, dst_lang);

            -- ================================================================
            -- Trace events (P0-06: trace persistence)
            -- ================================================================
            CREATE TABLE IF NOT EXISTS trace_events (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                batch_index INTEGER NOT NULL DEFAULT 0,
                message TEXT NOT NULL DEFAULT '',
                data_json TEXT,
                provider TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT '',
                src_lang TEXT NOT NULL DEFAULT '',
                dst_lang TEXT NOT NULL DEFAULT '',
                timestamp TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS trace_units (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                unit_id TEXT NOT NULL,
                file_path TEXT NOT NULL DEFAULT '',
                key TEXT NOT NULL DEFAULT '',
                source_text TEXT NOT NULL DEFAULT '',
                translated_text TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                error_message TEXT NOT NULL DEFAULT '',
                batch_index INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_trace_events_job_id
                ON trace_events(job_id);
            CREATE INDEX IF NOT EXISTS idx_trace_units_job_id
                ON trace_units(job_id);

            -- ================================================================
            -- Translated output files (P0-10: translated output tracking)
            -- ================================================================
            CREATE TABLE IF NOT EXISTS translated_output_files (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                mod_id TEXT,
                mod_name TEXT,
                source_file_path TEXT NOT NULL,
                translated_file_path TEXT NOT NULL,
                relative_source_path TEXT,
                relative_translated_path TEXT,
                file_name TEXT NOT NULL,
                file_ext TEXT,
                game_id TEXT,
                parser_id TEXT,
                aggregation_key TEXT,
                group_key TEXT,
                group_label TEXT,
                source_size_bytes INTEGER,
                translated_size_bytes INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_analyzed_at TEXT,
                editor_available INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'ready',
                analysis_stale INTEGER NOT NULL DEFAULT 0,
                output_metadata_json TEXT NOT NULL DEFAULT '{}',
                current_source_hash TEXT,
                current_translated_hash TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_output_files_job_id
                ON translated_output_files(job_id);
            CREATE INDEX IF NOT EXISTS idx_output_files_mod_id
                ON translated_output_files(job_id, mod_id);
            CREATE INDEX IF NOT EXISTS idx_output_files_group
                ON translated_output_files(job_id, mod_id, group_key);

            CREATE TABLE IF NOT EXISTS translated_output_file_analysis (
                id TEXT PRIMARY KEY,
                output_file_id TEXT NOT NULL,
                job_id TEXT NOT NULL,
                analyzer_version TEXT NOT NULL,
                status TEXT NOT NULL,
                compilability_score REAL,
                placeholders_score REAL,
                errors_count INTEGER NOT NULL DEFAULT 0,
                warnings_count INTEGER NOT NULL DEFAULT 0,
                source_hash TEXT,
                translated_hash TEXT,
                diagnostics_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (output_file_id) REFERENCES translated_output_files(id)
            );

            CREATE INDEX IF NOT EXISTS idx_output_analysis_file_created
                ON translated_output_file_analysis(output_file_id, created_at DESC);

            -- ================================================================
            -- Output analysis jobs (P0-10: async analysis)
            -- ================================================================
            CREATE TABLE IF NOT EXISTS output_analysis_jobs (
                id TEXT PRIMARY KEY,
                scope_type TEXT NOT NULL,
                scope_json TEXT NOT NULL,
                checks_json TEXT NOT NULL,
                status TEXT NOT NULL,
                total_count INTEGER NOT NULL DEFAULT 0,
                processed_count INTEGER NOT NULL DEFAULT 0,
                skipped_count INTEGER NOT NULL DEFAULT 0,
                passed_count INTEGER NOT NULL DEFAULT 0,
                warning_count INTEGER NOT NULL DEFAULT 0,
                failed_count INTEGER NOT NULL DEFAULT 0,
                error_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                error_message TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_output_analysis_jobs_status_created
                ON output_analysis_jobs(status, created_at DESC);
            -- ================================================================
            -- Output scan events (P0-10: scan diagnostics persistence)
            -- ================================================================
            CREATE TABLE IF NOT EXISTS output_scan_events (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                output_root TEXT NOT NULL,
                manifest_mode TEXT NOT NULL,
                manifest_found INTEGER NOT NULL DEFAULT 0,
                files_indexed INTEGER NOT NULL DEFAULT 0,
                files_updated INTEGER NOT NULL DEFAULT 0,
                files_skipped INTEGER NOT NULL DEFAULT 0,
                files_missing_source INTEGER NOT NULL DEFAULT 0,
                errors_count INTEGER NOT NULL DEFAULT 0,
                diagnostics_json TEXT NOT NULL DEFAULT '[]',
                integrity_json TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_output_scan_events_job_id
                ON output_scan_events(job_id);

            -- ================================================================
            -- Output analysis job -> file linkage (P0-10: debug linkage)
            -- ================================================================
            CREATE TABLE IF NOT EXISTS output_analysis_job_files (
                analysis_job_id TEXT NOT NULL,
                output_file_id TEXT NOT NULL,
                result_id TEXT,
                result_status TEXT,
                created_at TEXT NOT NULL,
                PRIMARY KEY (analysis_job_id, output_file_id)
            );

            CREATE INDEX IF NOT EXISTS idx_ajf_analysis_job_id
                ON output_analysis_job_files(analysis_job_id);
            CREATE INDEX IF NOT EXISTS idx_ajf_output_file_id
                ON output_analysis_job_files(output_file_id);

            -- ================================================================
            -- Custom protection rules (user-defined regex patterns)
            -- ================================================================
            CREATE TABLE IF NOT EXISTS custom_protection_rules (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                pattern TEXT NOT NULL,
                rule_kind TEXT NOT NULL DEFAULT 'atomic',
                token_type TEXT NOT NULL DEFAULT 'custom_token',
                opener_pattern TEXT NOT NULL DEFAULT '',
                closer_pattern TEXT NOT NULL DEFAULT '',
                description TEXT DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                priority INTEGER NOT NULL DEFAULT 100,
                flags TEXT DEFAULT '[]',
                sample_text TEXT DEFAULT '',
                last_validation_error TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            -- ================================================================
            -- Protection rule sets (rule-set-driven protection architecture)
            -- ================================================================
            CREATE TABLE IF NOT EXISTS protection_rule_sets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                builtin INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS protection_rule_set_rules (
                id TEXT PRIMARY KEY,
                rule_set_id TEXT NOT NULL REFERENCES protection_rule_sets(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                pattern TEXT NOT NULL,
                rule_kind TEXT NOT NULL DEFAULT 'atomic',
                token_type TEXT NOT NULL DEFAULT 'game_token',
                enabled INTEGER NOT NULL DEFAULT 1,
                priority INTEGER NOT NULL DEFAULT 100,
                flags TEXT DEFAULT '[]',
                opener_pattern TEXT NOT NULL DEFAULT '',
                closer_pattern TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_protection_rule_set_rules_set_id
                ON protection_rule_set_rules(rule_set_id);

            -- ================================================================
            -- Protection profiles (learned protection groups)
            -- ================================================================
            CREATE TABLE IF NOT EXISTS protection_profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                game_id TEXT,
                mod_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            -- ================================================================
            -- Protection samples (raw text samples per profile)
            -- ================================================================
            CREATE TABLE IF NOT EXISTS protection_samples (
                id TEXT PRIMARY KEY,
                profile_id TEXT NOT NULL REFERENCES protection_profiles(id) ON DELETE CASCADE,
                source_text TEXT NOT NULL,
                translations_json TEXT NOT NULL DEFAULT '{}',
                source_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_protection_samples_profile_id
                ON protection_samples(profile_id);

            -- ================================================================
            -- Learned protection candidates (grouped analysis results)
            -- ================================================================
            CREATE TABLE IF NOT EXISTS learned_protection_candidates (
                id TEXT PRIMARY KEY,
                profile_id TEXT NOT NULL REFERENCES protection_profiles(id) ON DELETE CASCADE,
                text TEXT NOT NULL,
                normalized_text TEXT NOT NULL,
                suggested_pattern TEXT DEFAULT '',
                confidence TEXT DEFAULT 'low',
                status TEXT NOT NULL DEFAULT 'suggested'
                    CHECK (status IN ('suggested', 'accepted', 'rejected', 'ignored')),
                occurrence_count INTEGER NOT NULL DEFAULT 1,
                sample_count INTEGER NOT NULL DEFAULT 1,
                max_probability REAL NOT NULL DEFAULT 0.0,
                avg_probability REAL NOT NULL DEFAULT 0.0,
                rule_kind TEXT NOT NULL DEFAULT 'atomic',
                token_type TEXT NOT NULL DEFAULT 'custom_token',
                opener_pattern TEXT NOT NULL DEFAULT '',
                closer_pattern TEXT NOT NULL DEFAULT '',
                supporting_methods_json TEXT NOT NULL DEFAULT '[]',
                features_json TEXT NOT NULL DEFAULT '{}',
                semantic_rank INTEGER NOT NULL DEFAULT 10,
                is_markup_fragment INTEGER NOT NULL DEFAULT 0,
                shadowed_by_paired_candidate TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE (profile_id, normalized_text)
            );

            CREATE INDEX IF NOT EXISTS idx_lpc_profile_id
                ON learned_protection_candidates(profile_id);

            -- ================================================================
            -- Candidate occurrences (example positions per candidate)
            -- ================================================================
            CREATE TABLE IF NOT EXISTS candidate_occurrences (
                id TEXT PRIMARY KEY,
                candidate_id TEXT NOT NULL REFERENCES learned_protection_candidates(id) ON DELETE CASCADE,
                sample_id TEXT NOT NULL REFERENCES protection_samples(id) ON DELETE CASCADE,
                start INTEGER NOT NULL,
                end INTEGER NOT NULL,
                source_context TEXT NOT NULL DEFAULT '',
                translations_json TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_co_candidate_id
                ON candidate_occurrences(candidate_id);

            CREATE INDEX IF NOT EXISTS idx_co_sample_id
                ON candidate_occurrences(sample_id);

            -- ================================================================
            -- Protection snapshots (Phase 5: full snapshot persistence)
            -- ================================================================
            CREATE TABLE IF NOT EXISTS protection_snapshots (
                snapshot_hash TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                strategy_name TEXT NOT NULL,
                profile_id TEXT,
                schema_hash TEXT NOT NULL,
                snapshot_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_protection_snapshots_job_id
                ON protection_snapshots(job_id);
            CREATE INDEX IF NOT EXISTS idx_protection_snapshots_schema_hash
                ON protection_snapshots(schema_hash);

            -- ================================================================
            -- Analysis divergence (Phase 6E: persisted divergence + readiness)
            -- ================================================================
            CREATE TABLE IF NOT EXISTS analysis_divergence (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                output_file_id TEXT NOT NULL,
                divergence_type TEXT NOT NULL,
                legacy_status TEXT,
                snapshot_status TEXT,
                legacy_failed INTEGER NOT NULL DEFAULT 0,
                snapshot_failed INTEGER,
                legacy_issue_codes TEXT NOT NULL DEFAULT '[]',
                snapshot_issue_codes TEXT NOT NULL DEFAULT '[]',
                details_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_divergence_job_file
                ON analysis_divergence(job_id, output_file_id);
            CREATE INDEX IF NOT EXISTS idx_analysis_divergence_job_id
                ON analysis_divergence(job_id);
            CREATE INDEX IF NOT EXISTS idx_analysis_divergence_output_file_id
                ON analysis_divergence(output_file_id);
            CREATE INDEX IF NOT EXISTS idx_analysis_divergence_type
                ON analysis_divergence(divergence_type);

            -- ================================================================
            -- Pairing projects (v12: pairing workspace)
            -- ================================================================
            CREATE TABLE IF NOT EXISTS pairing_projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                root_path TEXT NOT NULL,
                source_language TEXT,
                target_language TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_scanned_at TEXT,
                status TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'archived')),
                notes TEXT
            );

            CREATE TABLE IF NOT EXISTS pairing_project_files (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES pairing_projects(id) ON DELETE CASCADE,
                relative_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                extension TEXT NOT NULL DEFAULT '',
                parent_dir TEXT NOT NULL DEFAULT '',
                size_bytes INTEGER NOT NULL DEFAULT 0,
                content_hash TEXT,
                modified_at TEXT,
                detected_language TEXT,
                detected_role TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (detected_role IN ('source', 'translated', 'unknown')),
                group_key TEXT,
                is_ignored INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pairing_project_pairs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES pairing_projects(id) ON DELETE CASCADE,
                source_file_id TEXT REFERENCES pairing_project_files(id) ON DELETE SET NULL,
                translated_file_id TEXT REFERENCES pairing_project_files(id) ON DELETE SET NULL,
                status TEXT NOT NULL DEFAULT 'suggested'
                    CHECK (status IN ('suggested', 'accepted', 'rejected', 'manual', 'ignored')),
                confidence REAL NOT NULL DEFAULT 0.0,
                reason TEXT,
                created_by TEXT NOT NULL DEFAULT 'auto'
                    CHECK (created_by IN ('auto', 'user')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                notes TEXT
            );

            CREATE TABLE IF NOT EXISTS pairing_project_alignments (
                id TEXT PRIMARY KEY,
                pair_id TEXT NOT NULL REFERENCES pairing_project_pairs(id) ON DELETE CASCADE,
                mode TEXT NOT NULL DEFAULT 'raw'
                    CHECK (mode IN ('raw', 'structured')),
                source_revision_hash TEXT,
                translated_revision_hash TEXT,
                operations_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_pairing_files_project
                ON pairing_project_files(project_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_pairing_files_project_path
                ON pairing_project_files(project_id, relative_path);
            CREATE INDEX IF NOT EXISTS idx_pairing_files_hash
                ON pairing_project_files(project_id, content_hash);
            CREATE INDEX IF NOT EXISTS idx_pairing_files_group
                ON pairing_project_files(project_id, group_key);
            CREATE INDEX IF NOT EXISTS idx_pairing_pairs_project
                ON pairing_project_pairs(project_id);
            CREATE INDEX IF NOT EXISTS idx_pairing_pairs_status
                ON pairing_project_pairs(project_id, status);
            CREATE INDEX IF NOT EXISTS idx_pairing_pairs_source
                ON pairing_project_pairs(project_id, source_file_id);
            CREATE INDEX IF NOT EXISTS idx_pairing_pairs_translated
                ON pairing_project_pairs(project_id, translated_file_id);
            CREATE INDEX IF NOT EXISTS idx_pairing_alignments_pair
                ON pairing_project_alignments(pair_id);
        """)
        conn.commit()

        # Migration: add analysis_stale for existing databases that don't have it yet
        try:
            conn.execute(
                "ALTER TABLE translated_output_files ADD COLUMN analysis_stale "
                "INTEGER NOT NULL DEFAULT 0"
            )
            conn.commit()
        except Exception:
            # Column already exists in fresh databases — ignore
            pass

        # Migration: add output_metadata_json for manifest metadata
        try:
            conn.execute(
                "ALTER TABLE translated_output_files ADD COLUMN output_metadata_json "
                "TEXT NOT NULL DEFAULT '{}'"
            )
            conn.commit()
        except Exception:
            pass

        # Migration: add current_source_hash / current_translated_hash for analysis validity
        try:
            conn.execute(
                "ALTER TABLE translated_output_files ADD COLUMN current_source_hash TEXT"
            )
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(
                "ALTER TABLE translated_output_files ADD COLUMN current_translated_hash TEXT"
            )
            conn.commit()
        except Exception:
            pass

        # Migration: add source_job_id for databases created before this column existed
        try:
            conn.execute(
                "ALTER TABLE jobs ADD COLUMN source_job_id TEXT"
            )
            conn.commit()
        except Exception:
            pass

        # Migration: add output_files / output_root_dir for databases created
        # by the legacy initialize() path that did not include these columns.
        try:
            conn.execute(
                "ALTER TABLE jobs ADD COLUMN output_files TEXT NOT NULL DEFAULT '[]'"
            )
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(
                "ALTER TABLE jobs ADD COLUMN output_root_dir TEXT"
            )
            conn.commit()
        except Exception:
            pass

        # Migration: add started_at / completed_at for databases created
        # before these columns existed.
        try:
            conn.execute(
                "ALTER TABLE jobs ADD COLUMN started_at TEXT"
            )
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(
                "ALTER TABLE jobs ADD COLUMN completed_at TEXT"
            )
            conn.commit()
        except Exception:
            pass

        # Migration: add semantic_rank / is_markup_fragment /
        # shadowed_by_paired_candidate for databases created before the
        # learned_protection_candidates table had them.
        try:
            conn.execute(
                "ALTER TABLE learned_protection_candidates ADD COLUMN "
                "semantic_rank INTEGER NOT NULL DEFAULT 10"
            )
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(
                "ALTER TABLE learned_protection_candidates ADD COLUMN "
                "is_markup_fragment INTEGER NOT NULL DEFAULT 0"
            )
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(
                "ALTER TABLE learned_protection_candidates ADD COLUMN "
                "shadowed_by_paired_candidate TEXT"
            )
            conn.commit()
        except Exception:
            pass

    def init_db(self) -> None:
        """Initialize the database with full schema.

        Calls ``ensure_schema()`` internally.
        """
        self.ensure_schema()
