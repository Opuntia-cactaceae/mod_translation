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
  selectedLanguageByMod: 'stellaris_translator.selectedLanguageByMod',
  showOnlySelectedLanguage: 'stellaris_translator.showOnlySelectedLanguage',
  createJobDraft: 'stellaris_translator.createJobDraft',
  draftJobFiles: 'stellaris_translator.draft_job_files',
  draftJobFileMeta: 'stellaris_translator.draft_job_file_meta',
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
