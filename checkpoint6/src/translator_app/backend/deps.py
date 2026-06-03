"""Dependency factory: creates and provides service instances.

All persistent storage paths are obtained from ``translator_app.storage.paths``
-- service classes never construct paths themselves.
"""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

from translator_app.settings.service import SettingsService
from translator_app.settings.models import AppSettings
from translator_app.secrets.service import SecretsService
from translator_app.file_processing.service import FileProcessingService
from translator_app.jobs.manager import JobManager
from translator_app.translation.cache import TranslationCache
from translator_app.translation.config import TranslationConfig
from translator_app.translation.prompt_presets import PromptPresetService
from translator_app.translation.protection import ProtectionService
from translator_app.output.naming import OutputNamingService
from translator_app.mods.descriptor import DescriptorService
from translator_app.mods.discovery import ModDiscoveryService
from translator_app.mods.install import ModInstallService
from translator_app.storage.db import DatabaseService
from translator_app.storage.migrations import MigrationManager
from translator_app.storage.protection_snapshot_repository import (
    ProtectionSnapshotRepository,
)
from translator_app.storage.repositories import JobRepository, DiagnosticsRepository, TraceRepository
from translator_app.pairing_project.repository import PairingProjectRepository
from translator_app.outputs.analysis.placeholders import PlaceholderAnalyzer
from translator_app.outputs.analysis.profile_staleness import (
    AnalysisProfileStalenessChecker,
)
from translator_app.outputs.analysis.protection_metadata import (
    ProtectionMetadataResolver,
)
from translator_app.outputs.analysis.registry import AnalyzerRegistry
from translator_app.outputs.analysis.service import OutputAnalysisService
from translator_app.outputs.analysis.snapshot_resolver import (
    AnalysisProtectionSnapshotResolver,
)
from translator_app.outputs.analysis.divergence_repository import (
    AnalysisDivergenceRepository,
)
from translator_app.outputs.analysis.job_repository import AnalysisJobRepository
from translator_app.outputs.analysis.job_service import OutputAnalysisJobService
from translator_app.outputs.analysis.worker import OutputAnalysisWorker
from translator_app.outputs.debug_service import OutputDebugService
from translator_app.outputs.repository import TranslatedOutputFileRepository
from translator_app.outputs.scan_event_repository import ScanEventRepository
from translator_app.outputs.service import TranslatedOutputFileService
from translator_app.outputs.file_open_service import FileOpenService
from translator_app.outputs.job_output_resolver import JobOutputLocationResolver
from translator_app.outputs.persistence import OutputPersistenceService
from translator_app.outputs.scanner import TranslatedOutputScanner
from translator_app.file_processing.registry import get_default_registry
from translator_app.diagnostics.logging import LoggingService
from translator_app.diagnostics.services import DiagnosticsService
from translator_app.stellaris_cache.service import StellarisCacheService
from translator_app.translation.trace import TranslationTraceService
from translator_app.translation.profiles import TranslationProfileService
from translator_app.translation.config import TranslationConfigBuilder
from translator_app.translation.core_adapter import TranslationCoreAdapter
from translator_app.backend.services.draft_job_selection import DraftJobSelectionService
from translator_app.backend.services.provider_models import ProviderModelService
from translator_app.protection_custom.repository import CustomProtectionRuleRepository
from translator_app.protection_custom.service import CustomProtectionService
from translator_app.protection.rule_set import ProtectionRuleSetRepository
from translator_app.protection_custom.learning_repository import ProtectionLearningRepository
from translator_app.protection_custom.learning_service import ProtectionLearningService
from translator_app.backend.services.protection_learning_file_source import (
    ProtectionLearningFileSourceService,
)
from translator_app.editor_session.service import EditorSessionService
from translator_app.jobs.execution import JobExecutionService
from translator_app.storage.paths import (
    get_config_path,
    get_secrets_path,
    get_profiles_path,
    get_prompt_presets_path,
    get_db_path,
    get_cache_path,
    get_trace_path,
    get_discovery_cache_path,
    get_raw_responses_dir,
    get_output_dir,
    get_provider_models_path,
    get_data_dir,
    clear_paths_cache,
    maybe_migrate_old_paths,
)


class Services:
    """Container for all application services."""

    def __init__(self):
        self.settings: SettingsService = SettingsService(config_path=get_config_path())
        self.secrets: SecretsService = SecretsService(store_path=get_secrets_path())
        self.file_processing: FileProcessingService = FileProcessingService()
        self.database: DatabaseService = DatabaseService(db_path=get_db_path())
        self.database.ensure_schema()
        MigrationManager(self.database).run()
        self._log_startup_db_info()
        self.output_naming: OutputNamingService = OutputNamingService()
        self.job_repo: JobRepository = JobRepository(self.database)
        self.jobs: JobManager = JobManager(repository=self.job_repo)
        self.cache: TranslationCache = TranslationCache(db_service=self.database)
        self.prompt_presets: PromptPresetService = PromptPresetService(
            store_path=get_prompt_presets_path(),
        )
        self.protection_rule_set_repo: ProtectionRuleSetRepository = ProtectionRuleSetRepository(
            self.database,
        )
        # Custom protection rules repository - must be created before
        # ProtectionService so that custom rules are merged into the
        # unified protection pipeline.
        self.custom_protection_repo: CustomProtectionRuleRepository = CustomProtectionRuleRepository(
            self.database,
        )
        self.protection: ProtectionService = ProtectionService(
            rule_set_repo=self.protection_rule_set_repo,
            custom_rule_repo=self.custom_protection_repo,
        )
        self.registry = get_default_registry()
        self.descriptor: DescriptorService = DescriptorService()
        self.mod_install: ModInstallService = ModInstallService()
        self.mod_discovery: ModDiscoveryService = ModDiscoveryService()
        # --- Logging / Diagnostics (module #27) ---
        self.logging: LoggingService = self._make_logging()
        diagnostics_repo = DiagnosticsRepository(self.database) if self.database else None
        self.diagnostics: DiagnosticsService = DiagnosticsService(
            diagnostics_repo=diagnostics_repo,
        )
        self.stellaris_cache: StellarisCacheService = StellarisCacheService()
        # P0-06: trace persistence via SQLite
        self.trace_repo: TraceRepository = TraceRepository(self.database)
        self.trace: TranslationTraceService = TranslationTraceService(
            # Uses TranslationTraceService default max_events=5000
            # TODO: read from AppSettings when trace settings are added to the model
            secrets_service=self.secrets,
            repo=self.trace_repo,
        )
        # Note: event.severity is an ephemeral live-indicator and is NOT
        # persisted to the trace_events DB table.  Events reloaded from
        # SQLite on backend restart will always have severity=INFO.
        # This is intentional -- severity is an in-memory-only concern
        # for the runtime status log, not a persistent audit log field.
        self.translation_profiles: TranslationProfileService = TranslationProfileService(
            store_path=get_profiles_path(),
        )
        # Custom protection rules service (CRUD + preview).  ProtectionEngine
        # integration is handled via ProtectionService (see above).
        self.custom_protection: CustomProtectionService = CustomProtectionService(
            repository=self.custom_protection_repo,
        )

        # Protection learning (SQLite-persisted profiles, samples, candidates).
        self.protection_learning_repo: ProtectionLearningRepository = ProtectionLearningRepository(
            self.database,
        )
        self.protection_learning: ProtectionLearningService = ProtectionLearningService(
            repo=self.protection_learning_repo,
            analyzer_service=self.custom_protection,
            rule_repo=self.custom_protection_repo,
        )

        # Analysis protection snapshot resolver: repo + resolver used by
        # ProtectionMetadataResolver (below) and output analysis layer.
        # Must be created here, after protection_learning/custom_protection
        # are available, but before protection_metadata_resolver.
        self.protection_snapshot_repo: ProtectionSnapshotRepository = ProtectionSnapshotRepository(
            self.database,
        )
        self.analysis_snapshot_resolver: AnalysisProtectionSnapshotResolver = AnalysisProtectionSnapshotResolver(
            trace_service=self.trace,
            snapshot_repo=self.protection_snapshot_repo,
            custom_protection_service=self.custom_protection,
            protection_learning_service=self.protection_learning,
        )

        # Protection metadata resolver: queries trace events for snapshot metadata.
        # Used by the output analysis layer to correlate analysis results with
        # the protection state at translation time.
        self.protection_metadata_resolver: ProtectionMetadataResolver = ProtectionMetadataResolver(
            trace_service=self.trace,
            snapshot_repo=self.protection_snapshot_repo,
        )
        # --- OutputPersistenceService: unified write + manifest register ---
        self.output_persistence: OutputPersistenceService = OutputPersistenceService()

        # --- Execution / Adapter / Config Builder (wired for background execution) ---
        self.translation_config_builder: TranslationConfigBuilder = TranslationConfigBuilder(
            settings_service=self.settings,
            secrets_service=self.secrets,
            prompt_preset_registry=self.prompt_presets,
            profile_service=self.translation_profiles,
        )
        self.adapter: TranslationCoreAdapter = TranslationCoreAdapter(
            runtime=None,
            protection_service=self.protection,
            logging_service=self.logging,
            diagnostics_service=self.diagnostics,
            secrets_service=self.secrets,
            trace_service=self.trace,
            protection_snapshot_repo=self.protection_snapshot_repo,
        )
        self.execution: JobExecutionService = JobExecutionService(
            job_manager=self.jobs,
            adapter=self.adapter,
            file_service=self.file_processing,
            cache=self.cache,
            logging_service=self.logging,
            diagnostics_service=self.diagnostics,
            trace_service=self.trace,
            output_scanner_callback=self._scan_outputs_after_completion,
            output_persistence=self.output_persistence,
        )
        # --- Translated output files (P0-10) ---
        self.output_files_repo: TranslatedOutputFileRepository = TranslatedOutputFileRepository(self.database)

        # Protection learning file source: backend-first file-based learning.
        # Discovers mod/game files, previews localisation files, pairs
        # source/translated files, and orchestrates learning analysis.
        # All file I/O and parsing happens here — frontend is thin.
        self.protection_learning_file_source: ProtectionLearningFileSourceService = (
            ProtectionLearningFileSourceService(
                mod_discovery=self.mod_discovery,
                file_processing=self.file_processing,
                protection_learning=self.protection_learning,
                analyzer_service=self.custom_protection,
                output_files_repo=self.output_files_repo,
                settings_service=self.settings,
            )
        )

        self.output_location_resolver: JobOutputLocationResolver = JobOutputLocationResolver(
            job_manager=self.jobs,
        )
        # --- Debug observability (P0-10) ---
        self.scan_event_repo: ScanEventRepository = ScanEventRepository(self.database)
        # Wire event persister into scanner
        from translator_app.backend.api.output_debug import make_scan_event_persister
        self.output_scanner: TranslatedOutputScanner = TranslatedOutputScanner(
            repository=self.output_files_repo,
            location_resolver=self.output_location_resolver,
            event_persister=make_scan_event_persister(self),
        )
        self.output_files: TranslatedOutputFileService = TranslatedOutputFileService(
            repository=self.output_files_repo,
            scanner=self.output_scanner,
        )
        # Path security: compute allowed roots from all known output roots
        self._allowed_output_roots = self._compute_output_roots()

        # --- File open service (P0-10) ---
        self.file_open_service: FileOpenService = FileOpenService(
            repository=self.output_files_repo,
            allowed_roots=self._allowed_output_roots,
            job_manager=self.jobs,
        )

        # --- Output file analysis (P0-10) ---
        self.analysis_divergence_repo: AnalysisDivergenceRepository = AnalysisDivergenceRepository(
            self.database,
        )
        self.analysis_registry: AnalyzerRegistry = AnalyzerRegistry()
        # The legacy compilability adapter has been removed.
        # Authoritative scoring is produced by SnapshotAuthoritativeEvaluator
        # via the snapshot-driven token integrity analysis path.
        # PlaceholderAnalyzer is kept for supplementary non-authoritative diagnostics.
        self.analysis_registry.register(
            "placeholders", PlaceholderAnalyzer()
        )
        self.output_analysis: OutputAnalysisService = OutputAnalysisService(
            repository=self.output_files_repo,
            registry=self.analysis_registry,
            file_processing=self.file_processing,
            protection_metadata_resolver=self.protection_metadata_resolver,
            divergence_repository=self.analysis_divergence_repo,
            analysis_options_resolver=self.analysis_snapshot_resolver,
        )
        # --- Debug observability (continued) — needs output_analysis ---
        self.profile_staleness_checker: AnalysisProfileStalenessChecker = (
            AnalysisProfileStalenessChecker(
                protection_learning_service=self.protection_learning,
                custom_protection_service=self.custom_protection,
            )
        )
        self.output_debug: OutputDebugService = OutputDebugService(
            file_repository=self.output_files_repo,
            scan_event_repo=self.scan_event_repo,
            protection_metadata_resolver=self.protection_metadata_resolver,
            analysis_service=self.output_analysis,
            profile_staleness_checker=self.profile_staleness_checker,
        )
        # --- Async analysis jobs (P0-10) ---
        self.analysis_job_repo: AnalysisJobRepository = AnalysisJobRepository(self.database)
        self.analysis_job_service: OutputAnalysisJobService = OutputAnalysisJobService(
            repository=self.analysis_job_repo,
        )
        self.analysis_worker: OutputAnalysisWorker = OutputAnalysisWorker(
            job_service=self.analysis_job_service,
            job_repository=self.analysis_job_repo,
            analysis_service=self.output_analysis,
        )

        # Editor session service (in-memory editing sessions)
        self.editor_session: EditorSessionService = EditorSessionService(
            repository=self.output_files_repo,
            file_processing=self.file_processing,
            output_persistence=self.output_persistence,
            allowed_output_roots=self._allowed_output_roots,
            job_manager=self.jobs,
        )

        # Draft job selection (persisted, with mod-discovery integration).
        self.draft_selection: DraftJobSelectionService = DraftJobSelectionService(
            mod_discovery=self.mod_discovery,
        )

        # Provider models directory (JSON-persisted user-editable model list).
        self.provider_models: ProviderModelService = ProviderModelService(
            store_path=get_provider_models_path(),
        )

        # Pairing Project workspace (v12: pairing workflow).
        self.pairing_project_repo: PairingProjectRepository = PairingProjectRepository(
            self.database,
        )

    def _log_startup_db_info(self) -> None:
        """Log resolved storage paths and database state on startup.

        Safe: all queries are wrapped; failures are logged, never raised.
        """
        db_path = self.database.db_path
        db_file = Path(db_path)
        logger.info("--- Startup DB info ---")
        logger.info("data_dir: %s", get_data_dir())
        logger.info("db_path: %s", db_path)
        logger.info("db file exists: %s", db_file.exists())
        if not db_file.exists():
            logger.warning(
                "DB file does not exist yet — will be created on first connect"
            )
            return

        try:
            conn = self.database.connect()
            key_tables = [
                "jobs", "settings", "translation_cache",
                "translation_units", "parsed_files",
                "trace_events", "translated_output_files",
            ]
            for table in key_tables:
                try:
                    row = conn.execute(
                        f"SELECT COUNT(*) FROM {table}"
                    ).fetchone()
                    count = row[0] if row else 0
                    if count > 0:
                        logger.info("  %-30s %d rows", table, count)
                except Exception:
                    pass
            try:
                row = conn.execute(
                    "SELECT MAX(version) FROM schema_version"
                ).fetchone()
                if row and row[0]:
                    logger.info("  %-30s %d", "schema_version", row[0])
            except Exception:
                pass
        except Exception as exc:
            logger.warning("Failed to query DB table counts: %s", exc)
        logger.info("--- End startup DB info ---")

    def _scan_outputs_after_completion(self, job_id: str) -> None:
        """Callback invoked by JobExecutionService after a job completes.

        Best-effort scan of the job's output directory.  Errors are
        logged but never propagated so they cannot break the job's
        COMPLETED status.
        """
        try:
            from translator_app.outputs.scanner import (
                TranslatedOutputScanRequest,
            )
            request = TranslatedOutputScanRequest(job_id=job_id, job_scoped=True)
            self.output_scanner.scan_job_outputs(request)
        except Exception as exc:
            logger.exception(
                "Auto-scan of output files failed for job %s: %s",
                job_id, exc,
            )

    def _compute_output_roots(self) -> list:
        """Gather and normalise all known output roots for path security.

        Best-effort: errors (e.g. missing DB schema during testing) are
        logged but never propagated, returning an empty list.
        """
        from translator_app.outputs.path_security import compute_allowed_roots

        roots: set = set()
        try:
            from translator_app.jobs.models import JobStatus
            jobs = self.job_repo.list_by_status(JobStatus.COMPLETED)
            for j in jobs:
                if j.output_root_dir:
                    roots.add(j.output_root_dir)
        except Exception as exc:
            logger.warning("Failed to compute output roots: %s", exc)
        return compute_allowed_roots(roots)

    @staticmethod
    def _make_logging() -> LoggingService:
        return LoggingService(max_entries=10000)


_services: Services = None


def get_services() -> Services:
    """Get or create the global Services singleton."""
    global _services
    if _services is None:
        maybe_migrate_old_paths()
        _services = Services()
    return _services


def reset_services() -> None:
    """Reset services (useful for testing).

    Also clears the cached storage paths so that the next ``get_services()``
    call re-resolves all paths from environment variables.
    """
    global _services
    _services = None
    clear_paths_cache()
