/**
 * Centralized localStorage key namespace.
 * All keys are prefixed with `stellaris_translator.` to avoid collisions.
 */
export const STORAGE_KEYS = {
  expandedMods: 'stellaris_translator.expandedMods',
  expandedLocalisationGroups: 'stellaris_translator.expandedLocalisationGroups',
  jobsFilters: 'stellaris_translator.jobs_filters',
  pendingTranslationFiles: 'stellaris_translator.pending_translation_files',
  pendingGameConfig: 'stellaris_translator.pending_game_config',
  pendingModName: 'stellaris_translator.pending_mod_name',
  pendingSourceName: 'stellaris_translator.pending_source_name',
  pendingModId: 'stellaris_translator.pending_mod_id',
  selectedProfileId: 'stellaris_translator.selected_profile_id',
  selectedSourceLanguage: 'stellaris_translator.selectedSourceLanguage',
  showOnlySelectedLanguage: 'stellaris_translator.showOnlySelectedLanguage',
  createJobDraft: 'stellaris_translator.createJobDraft',
  draftJobFiles: 'stellaris_translator.draft_job_files',
  draftJobFileMeta: 'stellaris_translator.draft_job_file_meta',
  translatedFilesGroupMode: 'stellaris_translator.translatedFilesGroupMode',
  jobsSortOrder: 'stellaris_translator.jobsSortOrder',
  jobsGroupBy: 'stellaris_translator.jobsGroupBy',
  /** @deprecated Use translationJobsExpandedGroups */
  translationJobsExpandedDateGroups: 'stellaris_translator.translationJobsExpandedDateGroups',
  /** @deprecated Use translatedFilesExpandedGroups */
  translatedFilesExpandedDateGroups: 'stellaris_translator.translatedFilesExpandedDateGroups',
  /** Unified expanded groups state for Jobs (prefixed keys: date:*, status:*) */
  translationJobsExpandedGroups: 'stellaris_translator.translationJobsExpandedGroups',
  /** Unified expanded groups state for Translated Files (prefixed keys: date:*, job:*, mod:*) */
  translatedFilesExpandedGroups: 'stellaris_translator.translatedFilesExpandedGroups',
  /** Expanded groups state for Output Job List grouping (prefixed keys: date:*) */
  outputJobListExpandedGroups: 'stellaris_translator.outputJobListExpandedGroups',

  /* ---- Discovery section persistence (GenericFileSection, scoped by game id) ---- */
  discoveryRootDir: 'stellaris_translator.discovery.rootDir',
  discoveryOutputDir: 'stellaris_translator.discovery.outputDir',
  discoveryGroupingMode: 'stellaris_translator.discovery.groupingMode',
  discoveryExpandedGroups: 'stellaris_translator.discovery.expandedGroups',
  discoveryHandler: 'stellaris_translator.discovery.handler',
  discoveryScannedFiles: 'stellaris_translator.discovery.scannedFiles',
  /** @deprecated Checkbox selection removed from GenericFileSection; no longer written. */
  discoverySelectedFiles: 'stellaris_translator.discovery.selectedFiles',
  discoveryScanError: 'stellaris_translator.discovery.scanError',

  /* ---- Pairing project workspace persistence (scoped by project id) ---- */
  pairingGroupingMode: 'stellaris_translator.pairing.groupingMode',
  pairingExpandedGroups: 'stellaris_translator.pairing.expandedGroups',
  pairingSelectedFiles: 'stellaris_translator.pairing.selectedFiles',
  pairingIncludeFilter: 'stellaris_translator.pairing.includeFilter',
  pairingExcludeFilter: 'stellaris_translator.pairing.excludeFilter',
  pairingExtensionFilter: 'stellaris_translator.pairing.extensionFilter',
} as const;

/**
 * Map of legacy (non-namespaced) keys to their new namespaced counterparts.
 * Used for one-time migration when reading old data.
 */
export const LEGACY_KEYS: Record<string, string> = {
  [STORAGE_KEYS.jobsFilters]: 'jobs_filters',
  [STORAGE_KEYS.pendingTranslationFiles]: 'pending_translation_files',
  [STORAGE_KEYS.pendingGameConfig]: 'pending_game_config',
  [STORAGE_KEYS.pendingModName]: 'pending_mod_name',
};
