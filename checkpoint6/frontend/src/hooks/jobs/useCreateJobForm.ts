import { useEffect, useState, useCallback, useRef } from 'react';
import type { CreateJobFormModel, TranslationPreviewModel } from '../../domain';
import { detectSourceLangFromPaths, normalizePathLines } from '../../domain/jobFormHelpers';
import { getCreateJobProblems } from '../../domain/jobValidation';
import type { ModInfoSchema, GameOption, TranslationProfile, ApiKeyResponse, EffectivePromptResponse, PreviewPromptResponse } from '../../api/types';
import { api } from '../../App';
import type { FoundFile } from '../../components';
import type { CreateJobFormValues } from './useCreateJobFlow';
import { useCreateJobFlow } from './useCreateJobFlow';
import { useCreateJobFields, type UseCreateJobFieldsReturn } from './useCreateJobFields';
import { useCreateJobPaths } from './useCreateJobPaths';
import { useCreateJobFileSearch } from './useCreateJobFileSearch';
import { useCreateJobDefaults } from './useCreateJobDefaults';
import { useCreateJobMods } from './useCreateJobMods';
import { useCreateJobGames } from './useCreateJobGames';
import { applyProfileToForm } from './useCreateJobProfileApplication';
import { usePersistentState } from '../usePersistentState';
import { STORAGE_KEYS } from '../../utils/storageKeys';
import { useDraftJobSelection } from '../../contexts/DraftJobSelectionContext';
import {
  groupFilesByLanguage,
  filterFilesByLanguage,
} from '../../utils/localisationLanguage';

/* ------------------------------------------------------------------ */
/*  Draft types                                                        */
/* ------------------------------------------------------------------ */

export interface CreateJobDraft {
  selectedGameId?: string;
  selectedModKey?: string;
  selectedModName?: string;
  showOnlySelectedLanguage?: boolean;
  selectedModSourceLanguage?: string;
  filePaths?: string;
  filePathList?: string[];
  addedPaths?: string[];
  jobName?: string;
  srcLang?: string;
  dstLang?: string;
  provider?: string;
  model?: string;
  apiKeyId?: string;
  apiKeyIds?: string[];
  batchSize?: number;
  useCache?: boolean;
  selectedProfileId?: string;
  gameConfig?: Record<string, unknown> | null;
  sourceName?: string | null;
  // --- Advanced config draft fields ---
  promptProfileName?: string;
  protectionStrategy?: string;
  validatorName?: string;
  outputDir?: string;
  outputFilenameSuffix?: string;
  outputPreserveRelativePath?: boolean;
  outputOverwrite?: boolean;
  outputBackup?: boolean;
  temperature?: number;
  maxRetries?: number;
  timeoutSec?: number;
  maxCompletionTokens?: number;
  saveRawResponses?: boolean;
  // --- Prompt override fields (TASK 4 persistence) ---
  promptOverrideEnabled?: boolean;
  batchSystemPrompt?: string;
  batchUserTemplate?: string;
  singleSystemPrompt?: string;
  singleUserTemplate?: string;
  logPrompts?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Language helpers                                                   */
/* ------------------------------------------------------------------ */

function getAvailableLanguages(paths: string[]): string[] {
  const groups = groupFilesByLanguage(paths);
  return Object.keys(groups).filter(l => l !== 'unknown').sort();
}

function getDefaultLangForMod(paths: string[]): string {
  const langs = getAvailableLanguages(paths);
  if (langs.length === 0) return 'en';
  if (langs.includes('en')) return 'en';
  return langs[0];
}

/* ------------------------------------------------------------------ */
/*  Hook options                                                       */
/* ------------------------------------------------------------------ */

export interface UseCreateJobFormOptions {
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  loadJobs: () => Promise<void>;
  selectJob: (jobId: string) => void;
  profiles: TranslationProfile[];
}

/* ------------------------------------------------------------------ */
/*  View model returned to CreateJobForm component                     */
/* ------------------------------------------------------------------ */

export interface CreateJobFormViewModel {
  form: CreateJobFormModel;
  setFormField: <K extends keyof CreateJobFormModel>(
    field: K,
    value: CreateJobFormModel[K],
  ) => void;

  // --- API Keys ---
  apiKeys: ApiKeyResponse[];
  filteredApiKeys: ApiKeyResponse[];
  apiKeysLoading: boolean;

  // --- Validation ---
  validationErrors: string[];

  // --- File search ---
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  foundFiles: FoundFile[];
  searching: boolean;
  searchError: string | null;
  addedPaths: Set<string>;
  pickFilePath: string;
  setPickFilePath: (p: string) => void;
  pickSearchPath: string;
  setPickSearchPath: (p: string) => void;
  addPath: (path: string) => void;
  removePath: (path: string) => void;
  handleSearch: () => Promise<void>;
  handleAddAll: () => void;

  // --- Mod selection ---
  mods: ModInfoSchema[];
  /** Mods filtered by the currently selected game */
  filteredMods: ModInfoSchema[];
  modsLoading: boolean;
  selectedMod: ModInfoSchema | null;
  handleSelectMod: (mod: ModInfoSchema) => void;
  handleClearSelection: () => void;

  // --- Game filter ---
  games: GameOption[];
  gamesWithMods: GameOption[];
  gamesLoading: boolean;
  selectedGameId: string;
  handleGameChange: (gameId: string) => void;

  // --- Language filter ---
  showOnlySelectedLanguage: boolean;
  setShowOnlySelectedLanguage: (v: boolean) => void;
  selectedLanguage: string;
  setSelectedLanguage: (v: string) => void;
  availableLanguages: string[];

  // --- Derived / loaded state ---
  modFromQuery: string | null;
  gameConfig: Record<string, unknown> | null;

  // --- Actions ---
  handleResetDefaults: () => void;
  handlePreviewPlan: () => void;
  handleCreateJob: () => Promise<void>;

  // --- Effective prompt (TASK 2) ---
  effectivePrompt: EffectivePromptResponse | null;
  effectivePromptLoading: boolean;

  // --- Prompt preview (TASK 7) ---
  previewPromptData: PreviewPromptResponse | null;
  previewPromptMode: 'batch' | 'single';
  setPreviewPromptMode: (mode: 'batch' | 'single') => void;
  handlePreviewPrompt: () => Promise<void>;
  closePreviewPrompt: () => void;
  previewPromptLoading: boolean;

  // --- From createFlow ---
  previewData: TranslationPreviewModel | null;
  previewLoading: boolean;
  creatingJob: boolean;

  // --- Profile actions ---
  selectedProfileId: string;
  profileSelectValue: string;
  handleProfileSelect: (id: string) => void;
  /** Bypass confirmation — used when saving current config as a new profile */
  selectProfileDirect: (id: string) => void;
  showProfileConfirm: boolean;
  profileConfirmType: 'apply' | 'clear';
  /** Non-empty when a mod is selected and the pending profile targets a different game */
  profileGameWarning: string;
  confirmProfileApply: () => void;
  cancelProfileConfirm: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function buildForm(
  paths: { filePaths: string; filePathList: string[] },
  fields: UseCreateJobFieldsReturn,
): CreateJobFormModel {
  return {
    filePaths: paths.filePaths,
    filePathList: paths.filePathList,
    jobName: fields.jobName,
    srcLang: fields.srcLang,
    dstLang: fields.dstLang,
    batchSize: fields.batchSize,
    useCache: fields.useCache,
    provider: fields.provider,
    model: fields.model,
    apiKeyId: fields.apiKeyId,
    apiKeyIds: fields.apiKeyIds,
    promptProfileName: fields.promptProfileName,
    protectionStrategy: fields.protectionStrategy,
    validatorName: fields.validatorName,
    outputDir: fields.outputDir,
    outputFilenameSuffix: fields.outputFilenameSuffix,
    outputPreserveRelativePath: fields.outputPreserveRelativePath,
    outputOverwrite: fields.outputOverwrite,
    outputBackup: fields.outputBackup,
    temperature: fields.temperature,
    maxRetries: fields.maxRetries,
    timeoutSec: fields.timeoutSec,
    maxCompletionTokens: fields.maxCompletionTokens,
    saveRawResponses: fields.saveRawResponses,
    promptOverrideEnabled: fields.promptOverrideEnabled,
    batchSystemPrompt: fields.batchSystemPrompt,
    batchUserTemplate: fields.batchUserTemplate,
    singleSystemPrompt: fields.singleSystemPrompt,
    singleUserTemplate: fields.singleUserTemplate,
    logPrompts: fields.logPrompts,
  };
}

/** Build CreateJobFormValues from current paths + fields (used by both preview and create). */
function buildFormValues(
  paths: { filePaths: string },
  fields: UseCreateJobFieldsReturn,
): CreateJobFormValues {
  return {
    filePaths: paths.filePaths,
    jobName: fields.jobName,
    srcLang: fields.srcLang,
    dstLang: fields.dstLang,
    batchSize: fields.batchSize,
    useCache: fields.useCache,
    provider: fields.provider,
    model: fields.model,
    apiKeyId: fields.apiKeyId,
    apiKeyIds: fields.apiKeyIds,
    promptProfileName: fields.promptProfileName,
    protectionStrategy: fields.protectionStrategy,
    validatorName: fields.validatorName,
    outputDir: fields.outputDir,
    outputFilenameSuffix: fields.outputFilenameSuffix,
    outputPreserveRelativePath: fields.outputPreserveRelativePath,
    outputOverwrite: fields.outputOverwrite,
    outputBackup: fields.outputBackup,
    temperature: fields.temperature,
    maxRetries: fields.maxRetries,
    timeoutSec: fields.timeoutSec,
    maxCompletionTokens: fields.maxCompletionTokens,
    saveRawResponses: fields.saveRawResponses,
    promptOverrideEnabled: fields.promptOverrideEnabled,
    batchSystemPrompt: fields.batchSystemPrompt,
    batchUserTemplate: fields.batchUserTemplate,
    singleSystemPrompt: fields.singleSystemPrompt,
    singleUserTemplate: fields.singleUserTemplate,
    logPrompts: fields.logPrompts,
  };
}

/** Build CreateJobDraft from current form state. */
function buildDraftFromState(
  opts: {
    gamesState: { selectedGameId: string };
    modsState: { selectedMod: ModInfoSchema | null };
    showOnlySelectedLanguage: boolean;
    selectedLanguage: string;
    paths: { filePaths: string; filePathList: string[]; addedPaths: Set<string> };
    fields: UseCreateJobFieldsReturn;
    createFlow: { selectedProfileId: string };
    gameConfig: Record<string, unknown> | null;
    modFromQuery: string | null;
  },
): CreateJobDraft {
  const { gamesState, modsState, showOnlySelectedLanguage, selectedLanguage, paths, fields, createFlow, gameConfig, modFromQuery } = opts;
  return {
    selectedGameId: gamesState.selectedGameId || undefined,
    selectedModKey: modsState.selectedMod?.mod_id,
    selectedModName: modsState.selectedMod?.name,
    showOnlySelectedLanguage,
    selectedModSourceLanguage: selectedLanguage,
    filePaths: paths.filePaths,
    filePathList: paths.filePathList,
    addedPaths: Array.from(paths.addedPaths),
    jobName: fields.jobName,
    srcLang: fields.srcLang,
    dstLang: fields.dstLang,
    provider: fields.provider,
    model: fields.model,
    apiKeyId: fields.apiKeyId,
    apiKeyIds: fields.apiKeyIds,
    batchSize: fields.batchSize,
    useCache: fields.useCache,
    selectedProfileId: createFlow.selectedProfileId,
    gameConfig,
    sourceName: modFromQuery,
    promptProfileName: fields.promptProfileName || undefined,
    protectionStrategy: fields.protectionStrategy || undefined,
    validatorName: fields.validatorName || undefined,
    outputDir: fields.outputDir || undefined,
    outputFilenameSuffix: fields.outputFilenameSuffix || undefined,
    outputPreserveRelativePath: fields.outputPreserveRelativePath || undefined,
    outputOverwrite: fields.outputOverwrite || undefined,
    outputBackup: fields.outputBackup || undefined,
    temperature: fields.temperature || undefined,
    maxRetries: fields.maxRetries || undefined,
    timeoutSec: fields.timeoutSec || undefined,
    maxCompletionTokens: fields.maxCompletionTokens || undefined,
    saveRawResponses: fields.saveRawResponses || undefined,
    promptOverrideEnabled: fields.promptOverrideEnabled ?? undefined,
    batchSystemPrompt: fields.batchSystemPrompt || undefined,
    batchUserTemplate: fields.batchUserTemplate || undefined,
    singleSystemPrompt: fields.singleSystemPrompt || undefined,
    singleUserTemplate: fields.singleUserTemplate || undefined,
    logPrompts: fields.logPrompts ?? undefined,
  };
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useCreateJobForm(
  opts: UseCreateJobFormOptions,
): CreateJobFormViewModel {
  const { showToast, loadJobs, selectJob, profiles } = opts;

  // =================================================================
  //  Create-job flow orchestration (preview, submission)
  // =================================================================

  const createFlow = useCreateJobFlow({
    reloadJobs: loadJobs,
    selectJob,
    showToast,
  });

  // =================================================================
  //  Focused hooks
  // =================================================================

  const paths = useCreateJobPaths();
  const fields = useCreateJobFields();
  const modsState = useCreateJobMods();
  const gamesState = useCreateJobGames();

  // =================================================================
  //  Shared draft job selection — single source of truth across SPA
  // =================================================================

  const ctx = useDraftJobSelection();

  // Keep local path state in sync with the shared context when the
  // draft changes from OUTSIDE the form (e.g. from ModListSection).
  // A ref tracks whether the current render was triggered by an
  // internal mutation to avoid redundant replacePaths loops.
  const internalDraftChangeRef = useRef(0);

  useEffect(() => {
    if (internalDraftChangeRef.current > 0) {
      internalDraftChangeRef.current--;
      return;
    }
    paths.replacePaths(ctx.draftFiles);
  }, [ctx.draftFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  useCreateJobDefaults({
    fieldSetters: fields.fieldSetters,
    dirty: fields.dirty,
    defaultsRefs: fields.defaultsRefs,
  });

  const [gameConfig, setGameConfig] = useState<Record<string, unknown> | null>(null);
  const [modFromQuery, setModFromQuery] = useState<string | null>(null);

  // =================================================================
  //  Wrapped path operations — sync React state with draft_job_files
  //  localStorage so that removing a file or editing the textarea is
  //  reflected in the "source of truth" draft storage.
  // =================================================================

  const handleRemovePath = useCallback((path: string) => {
    internalDraftChangeRef.current++;
    paths.removePath(path);
    ctx.removeFile(path);
  }, [paths.removePath, ctx.removeFile]);

  const handleAddPath = useCallback((path: string) => {
    internalDraftChangeRef.current++;
    paths.addPath(path);
    ctx.addFile(path);
  }, [paths.addPath, ctx.addFile]);

  // Override the fileSearch's addPath with our wrapped version
  const fileSearch = useCreateJobFileSearch({
    addPath: handleAddPath,
    addedPaths: paths.addedPaths,
  });

  // =================================================================
  //  Effective prompt — resolve prompt templates from selected profile
  // =================================================================

  const [effectivePrompt, setEffectivePrompt] = useState<EffectivePromptResponse | null>(null);
  const [effectivePromptLoading, setEffectivePromptLoading] = useState(false);

  useEffect(() => {
    const profileName = fields.promptProfileName || createFlow.selectedProfileId || '';
    if (!profileName) {
      setEffectivePrompt(null);
      return;
    }
    let cancelled = false;
    setEffectivePromptLoading(true);
    api.effectivePrompt({
      prompt: { profile_name: profileName },
      src_lang: fields.srcLang || 'en',
      dst_lang: fields.dstLang || 'ru',
    }).then(resp => {
      if (!cancelled) setEffectivePrompt(resp);
    }).catch(() => {
      if (!cancelled) setEffectivePrompt(null);
    }).finally(() => {
      if (!cancelled) setEffectivePromptLoading(false);
    });
    return () => { cancelled = true; };
  }, [fields.promptProfileName, createFlow.selectedProfileId, fields.srcLang, fields.dstLang]);

  // =================================================================
  //  Prompt preview — show effective prompt with sample texts
  // =================================================================

  const [previewPromptData, setPreviewPromptData] = useState<PreviewPromptResponse | null>(null);
  const [previewPromptMode, setPreviewPromptMode] = useState<'batch' | 'single'>('batch');
  const [previewPromptLoading, setPreviewPromptLoading] = useState(false);

  const handlePreviewPrompt = useCallback(async () => {
    setPreviewPromptLoading(true);
    try {
      const sampleTexts = ['Sample text for preview'];
      // Build the prompt dict from effective or override values
      const promptDict: Record<string, unknown> = {
        profile_name: fields.promptProfileName || createFlow.selectedProfileId || '',
      };
      if (fields.promptOverrideEnabled) {
        promptDict.batch_system_prompt = fields.batchSystemPrompt;
        promptDict.batch_user_template = fields.batchUserTemplate;
        promptDict.single_system_prompt = fields.singleSystemPrompt;
        promptDict.single_user_template = fields.singleUserTemplate;
      } else if (effectivePrompt) {
        promptDict.batch_system_prompt = effectivePrompt.batch_system_prompt;
        promptDict.batch_user_template = effectivePrompt.batch_user_template;
        promptDict.single_system_prompt = effectivePrompt.single_system_prompt;
        promptDict.single_user_template = effectivePrompt.single_user_template;
      }
      const resp = await api.previewPrompt({
        prompt: promptDict,
        src_lang: fields.srcLang || 'en',
        dst_lang: fields.dstLang || 'ru',
        mode: previewPromptMode,
        sample_texts: sampleTexts,
      });
      setPreviewPromptData(resp);
    } catch {
      setPreviewPromptData(null);
    } finally {
      setPreviewPromptLoading(false);
    }
  }, [fields.promptProfileName, createFlow.selectedProfileId, fields.promptOverrideEnabled,
      fields.batchSystemPrompt, fields.batchUserTemplate, fields.singleSystemPrompt,
      fields.singleUserTemplate, effectivePrompt, fields.srcLang, fields.dstLang, previewPromptMode]);

  const closePreviewPrompt = useCallback(() => {
    setPreviewPromptData(null);
  }, []);

  // =================================================================
  //  API keys — loaded on mount from backend
  // =================================================================

  const [apiKeys, setApiKeys] = useState<ApiKeyResponse[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setApiKeysLoading(true);
    api.listApiKeys()
      .then(res => { if (!cancelled) setApiKeys(res.keys); })
      .catch(() => { /* silently fail */ })
      .finally(() => { if (!cancelled) setApiKeysLoading(false); });
    return () => { cancelled = true; };
  }, []);

  /** API keys filtered by the currently selected provider (show all if no provider) */
  const filteredApiKeys = fields.provider
    ? apiKeys.filter(k => k.provider === fields.provider)
    : apiKeys;

  // =================================================================
  //  Profile selection — confirmation flow (no auto-apply)
  // =================================================================

  /** Tracks what the <select> shows — updated only on confirmed apply */
  const [profileSelectValue, setProfileSelectValue] = useState(createFlow.selectedProfileId);
  const [showProfileConfirm, setShowProfileConfirm] = useState(false);
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null);
  const [profileConfirmType, setProfileConfirmType] = useState<'apply' | 'clear'>('apply');

  // Sync the select value when selectedProfileId changes externally
  // (e.g. draft restore, initial load)
  useEffect(() => {
    setProfileSelectValue(createFlow.selectedProfileId);
  }, [createFlow.selectedProfileId]);

  const handleProfileSelect = useCallback((newProfileId: string) => {
    const currentId = createFlow.selectedProfileId;

    // Same profile — no action
    if (newProfileId === currentId) return;

    // Selecting "No profile" while a profile is selected
    if (newProfileId === '') {
      if (currentId !== '') {
        setPendingProfileId('');
        setProfileConfirmType('clear');
        setShowProfileConfirm(true);
      }
      return;
    }

    // Selecting a different profile
    setPendingProfileId(newProfileId);
    setProfileConfirmType('apply');
    setShowProfileConfirm(true);
  }, [createFlow.selectedProfileId]);

  const confirmProfileApply = useCallback(() => {
    if (pendingProfileId === null) return;

    if (pendingProfileId === '') {
      // Clear profile: unset the ID, do NOT reset form fields
      createFlow.setSelectedProfileId('');
    } else {
      // Apply profile config unconditionally (all-or-nothing)
      // Pass selectedMod to prevent game/file_handler desync when a mod is active
      applyProfileToForm(profiles, pendingProfileId, fields.fieldSetters, setGameConfig, modsState.selectedMod);
      createFlow.setSelectedProfileId(pendingProfileId);
    }

    // Update the displayed select value
    setProfileSelectValue(pendingProfileId);
    setShowProfileConfirm(false);
    setPendingProfileId(null);
  }, [pendingProfileId, profiles, fields.fieldSetters, createFlow.setSelectedProfileId, setGameConfig, modsState.selectedMod]);

  const cancelProfileConfirm = useCallback(() => {
    setShowProfileConfirm(false);
    setPendingProfileId(null);
  }, []);

  /** Bypass confirmation — used when saving current config as a new profile */
  const selectProfileDirect = useCallback((id: string) => {
    createFlow.setSelectedProfileId(id);
    setProfileSelectValue(id);
  }, [createFlow.setSelectedProfileId]);

  // =================================================================
  //  Language filter state
  // =================================================================

  const [showOnlySelectedLanguage, setShowOnlySelectedLanguage] =
    usePersistentState<boolean>(STORAGE_KEYS.createJobDraft + '.showOnly', true);

  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');

  // Compute available languages from selected mod's localisation paths
  const availableLanguages = modsState.selectedMod
    ? getAvailableLanguages(modsState.selectedMod.localisation_paths)
    : [];

  // =================================================================
  //  Game filter
  // =================================================================

  /** Mods filtered by the currently selected game */
  const filteredMods = gamesState.selectedGameId
    ? modsState.mods.filter(m => m.game_id === gamesState.selectedGameId)
    : modsState.mods;

  const handleGameChange = useCallback(
    (gameId: string) => {
      gamesState.setSelectedGameId(gameId);
      // If the selected mod doesn't belong to the new game, clear selection
      if (modsState.selectedMod && modsState.selectedMod.game_id !== gameId) {
        modsState.setSelectedMod(null);
        setSelectedLanguage('en');
        internalDraftChangeRef.current++;
        paths.replacePaths([]);
        ctx.clearFiles();
        fileSearch.setSearchQuery('');
        fileSearch.setFoundFiles([]);
      }
    },
    [modsState.selectedMod],
  );

  // =================================================================
  //  Draft persistence
  // =================================================================

  const [draft, setDraft, clearDraft] = usePersistentState<CreateJobDraft | null>(
    STORAGE_KEYS.createJobDraft,
    null,
  );

  const draftRestoredRef = useRef(false);

  /**
   * Guards the initial profile application effect so it only runs once
   * on mount (when both a selectedProfileId and loaded profiles become
   * available) and does NOT re-fire on subsequent manual profile switches.
   */
  const initialProfileAppliedRef = useRef(false);

  // =================================================================
  //  Apply pending translation data from createFlow (runs first)
  // =================================================================

  useEffect(() => {
    if (createFlow.pendingFiles.length > 0) {
      internalDraftChangeRef.current++;
      paths.replacePaths(createFlow.pendingFiles);
      ctx.setFiles(createFlow.pendingFiles);

      const lang = detectSourceLangFromPaths(createFlow.pendingFiles);
      if (lang) {
        fields.fieldSetters.setSrcLang(lang);
      }

      // Pending translation takes priority — mark draft as consumed
      draftRestoredRef.current = true;
    }
    if (createFlow.pendingSourceName) {
      setModFromQuery(createFlow.pendingSourceName);
    }
    if (createFlow.pendingGameConfig) {
      setGameConfig(createFlow.pendingGameConfig);
    }
  }, [createFlow.pendingFiles, createFlow.pendingSourceName, createFlow.pendingGameConfig]);

  // =================================================================
  //  Restore draft on mount (only if no pending translation)
  // =================================================================

  useEffect(() => {
    // Only restore once
    if (draftRestoredRef.current) return;
    if (!draft) {
      draftRestoredRef.current = true;
      return;
    }

    // If pending files arrived, they take priority — skip draft restore
    if (createFlow.pendingFiles.length > 0) {
      draftRestoredRef.current = true;
      return;
    }

    // Restore selected game
    if (draft.selectedGameId !== undefined) {
      gamesState.setSelectedGameId(draft.selectedGameId);
    }

    // NOTE: Path restoration has moved to a separate deferred effect
    // (see "Deferred draft path restore" below) that waits for the
    // shared context to finish loading before deciding whether to
    // restore from localStorage or use live context data.

    // Restore scalar fields
    if (draft.jobName !== undefined) fields.setFormField('jobName', draft.jobName);
    if (draft.srcLang !== undefined) fields.setFormField('srcLang', draft.srcLang);
    if (draft.dstLang !== undefined) fields.setFormField('dstLang', draft.dstLang);
    if (draft.provider !== undefined) fields.setFormField('provider', draft.provider);
    if (draft.model !== undefined) fields.setFormField('model', draft.model);
    if (draft.apiKeyId !== undefined) fields.setFormField('apiKeyId', draft.apiKeyId);
    if (draft.apiKeyIds !== undefined) fields.setFormField('apiKeyIds', draft.apiKeyIds);
    if (draft.batchSize !== undefined) fields.setFormField('batchSize', draft.batchSize);
    if (draft.useCache !== undefined) fields.setFormField('useCache', draft.useCache);

    // Restore advanced config fields from draft
    if (draft.promptProfileName !== undefined) fields.setFormField('promptProfileName', draft.promptProfileName);
    if (draft.protectionStrategy !== undefined) fields.setFormField('protectionStrategy', draft.protectionStrategy);
    if (draft.validatorName !== undefined) fields.setFormField('validatorName', draft.validatorName);
    if (draft.outputDir !== undefined) fields.setFormField('outputDir', draft.outputDir);
    if (draft.outputFilenameSuffix !== undefined) fields.setFormField('outputFilenameSuffix', draft.outputFilenameSuffix);
    if (draft.outputPreserveRelativePath !== undefined) fields.setFormField('outputPreserveRelativePath', draft.outputPreserveRelativePath);
    if (draft.outputOverwrite !== undefined) fields.setFormField('outputOverwrite', draft.outputOverwrite);
    if (draft.outputBackup !== undefined) fields.setFormField('outputBackup', draft.outputBackup);
    if (draft.temperature !== undefined) fields.setFormField('temperature', draft.temperature);
    if (draft.maxRetries !== undefined) fields.setFormField('maxRetries', draft.maxRetries);
    if (draft.timeoutSec !== undefined) fields.setFormField('timeoutSec', draft.timeoutSec);
    if (draft.maxCompletionTokens !== undefined) fields.setFormField('maxCompletionTokens', draft.maxCompletionTokens);
    if (draft.saveRawResponses !== undefined) fields.setFormField('saveRawResponses', draft.saveRawResponses);

    // Restore prompt override fields from draft
    if (draft.promptOverrideEnabled !== undefined) fields.setFormField('promptOverrideEnabled', draft.promptOverrideEnabled);
    if (draft.batchSystemPrompt !== undefined) fields.setFormField('batchSystemPrompt', draft.batchSystemPrompt);
    if (draft.batchUserTemplate !== undefined) fields.setFormField('batchUserTemplate', draft.batchUserTemplate);
    if (draft.singleSystemPrompt !== undefined) fields.setFormField('singleSystemPrompt', draft.singleSystemPrompt);
    if (draft.singleUserTemplate !== undefined) fields.setFormField('singleUserTemplate', draft.singleUserTemplate);
    if (draft.logPrompts !== undefined) fields.setFormField('logPrompts', draft.logPrompts);

    // Restore profile
    if (draft.selectedProfileId !== undefined && draft.selectedProfileId !== '') {
      createFlow.setSelectedProfileId(draft.selectedProfileId);
      // Apply profile config on draft restore (no confirmation needed)
      if (profiles.length > 0) {
        applyProfileToForm(profiles, draft.selectedProfileId, fields.fieldSetters, setGameConfig, modsState.selectedMod);
      }
    }

    // Restore game config
    if (draft.gameConfig) {
      setGameConfig(draft.gameConfig);
    }
    if (draft.sourceName) {
      setModFromQuery(draft.sourceName);
    }

    // Restore language filter state
    if (draft.showOnlySelectedLanguage !== undefined) {
      setShowOnlySelectedLanguage(draft.showOnlySelectedLanguage);
    }

    // NOTE: draftRestoredRef is set in the deferred path restore effect
    // below, after the shared context finishes loading.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // =================================================================
  //  Deferred draft path restore — waits for the shared context to
  //  finish loading before deciding whether to restore file paths
  //  from the localStorage draft or use live context data.
  //
  //  The DraftJobSelectionProvider starts with draftFiles = [] and
  //  loading = true on mount, then fetches state from the backend
  //  asynchronously.  If we restored paths in the main draft effect
  //  (above), we would see ctx.draftFiles = [] during the initial
  //  render and incorrectly overwrite live files (set from
  //  ModListSection) with stale localStorage data.
  //
  //  By deferring until ctx.loading === false we can distinguish:
  //    a) backend returns files → sync them (context takes priority)
  //    b) backend returns empty → restore from localStorage draft
  // =================================================================

  useEffect(() => {
    if (draftRestoredRef.current) return;
    if (ctx.loading) return; // wait for the initial backend fetch

    if (ctx.draftFiles.length > 0) {
      // Context already carries live files (set externally, e.g. from
      // ModListSection).  Sync them to local paths and skip draft restore.
      paths.replacePaths(ctx.draftFiles);
      draftRestoredRef.current = true;
      return;
    }

    // Context is empty after the backend fetch settled: restore from
    // localStorage draft if available.
    if (draft && draft.filePathList && draft.filePathList.length > 0) {
      paths.replacePaths(draft.filePathList);
      ctx.setFiles(draft.filePathList);
    }

    draftRestoredRef.current = true;
  }, [ctx.loading, ctx.draftFiles]);

  // =================================================================
  //  Apply selected profile on initial load (when profiles arrive
  //  asynchronously).  Catches the case where:
  //    a) no draft exists but selectedProfileId is in localStorage, OR
  //    b) draft restore attempted applyProfileToForm but profiles were
  //       not yet loaded (profiles.length === 0).
  //
  //  Uses a dedicated ref to fire only once — subsequent manual profile
  //  switches go through confirmProfileApply and are not re-applied here.
  // =================================================================

  useEffect(() => {
    if (!draftRestoredRef.current) return;
    if (initialProfileAppliedRef.current) return;
    if (!createFlow.selectedProfileId || profiles.length === 0) return;

    applyProfileToForm(
      profiles,
      createFlow.selectedProfileId,
      fields.fieldSetters,
      setGameConfig,
      modsState.selectedMod,
    );
    initialProfileAppliedRef.current = true;
  }, [profiles, createFlow.selectedProfileId]);

  // =================================================================
  //  Save draft on form state changes
  // =================================================================

  useEffect(() => {
    if (!draftRestoredRef.current) return;

    setDraft(buildDraftFromState({
      gamesState, modsState, showOnlySelectedLanguage, selectedLanguage,
      paths, fields, createFlow, gameConfig, modFromQuery,
    }));
  }, [
    modsState.selectedMod,
    gamesState.selectedGameId,
    showOnlySelectedLanguage,
    selectedLanguage,
    paths.filePaths,
    paths.filePathList,
    paths.addedPaths,
    fields.jobName,
    fields.srcLang,
    fields.dstLang,
    fields.provider,
    fields.model,
    fields.apiKeyId,
    fields.apiKeyIds,
    fields.batchSize,
    fields.useCache,
    fields.promptProfileName,
    fields.protectionStrategy,
    fields.validatorName,
    fields.outputDir,
    fields.outputFilenameSuffix,
    fields.outputPreserveRelativePath,
    fields.outputOverwrite,
    fields.outputBackup,
    fields.temperature,
    fields.maxRetries,
    fields.timeoutSec,
    fields.maxCompletionTokens,
    fields.saveRawResponses,
    fields.promptOverrideEnabled,
    fields.batchSystemPrompt,
    fields.batchUserTemplate,
    fields.singleSystemPrompt,
    fields.singleUserTemplate,
    fields.logPrompts,
    createFlow.selectedProfileId,
    gameConfig,
    modFromQuery,
  ]);

  // =================================================================
  //  Cross-cutting handlers — mod selection
  // =================================================================

  const handleSelectMod = useCallback(
    (mod: ModInfoSchema) => {
      modsState.setSelectedMod(mod);

      // Auto-switch game if mod belongs to a different game
      if (mod.game_id && mod.game_id !== gamesState.selectedGameId) {
        gamesState.setSelectedGameId(mod.game_id);
      }

      const defaultLang = getDefaultLangForMod(mod.localisation_paths);
      setSelectedLanguage(defaultLang);

      if (showOnlySelectedLanguage) {
        // Safe mode: only files for the selected language
        const filteredPaths = filterFilesByLanguage(mod.localisation_paths, defaultLang);
        internalDraftChangeRef.current++;
        paths.replacePaths(filteredPaths);
        ctx.setFiles(filteredPaths);
        // Auto-sync srcLang only if user hasn't manually overridden it
        if (!fields.dirty.srcLangDirty) {
          fields.fieldSetters.setSrcLang(defaultLang);
        }
      } else {
        // Advanced mode: all files
        internalDraftChangeRef.current++;
        paths.replacePaths(mod.localisation_paths);
        ctx.setFiles(mod.localisation_paths);
        // Auto-sync srcLang only if user hasn't manually overridden it
        if (!fields.dirty.srcLangDirty) {
          fields.fieldSetters.setSrcLang(defaultLang);
        }
      }

      fileSearch.setSearchQuery('');
      fileSearch.setFoundFiles([]);
    },
    [showOnlySelectedLanguage],
  );

  const handleClearSelection = useCallback(() => {
    modsState.setSelectedMod(null);
    setSelectedLanguage('en');
    internalDraftChangeRef.current++;
    paths.replacePaths([]);
    fileSearch.setSearchQuery('');
    fileSearch.setFoundFiles([]);
    clearDraft();
    ctx.clearFiles();
  }, []);

  // =================================================================
  //  Language toggle handler
  // =================================================================

  const handleToggleChange = useCallback(
    (showOnly: boolean) => {
      setShowOnlySelectedLanguage(showOnly);
      if (!modsState.selectedMod) return;

      if (showOnly) {
        // Switching TO safe mode: filter to selected language only
        const filteredPaths = filterFilesByLanguage(
          modsState.selectedMod.localisation_paths,
          selectedLanguage,
        );
        internalDraftChangeRef.current++;
        paths.replacePaths(filteredPaths);
        ctx.setFiles(filteredPaths);
        fields.fieldSetters.setSrcLang(selectedLanguage);
      } else {
        // Switching TO advanced mode: show all files
        internalDraftChangeRef.current++;
        paths.replacePaths(modsState.selectedMod.localisation_paths);
        ctx.setFiles(modsState.selectedMod.localisation_paths);
      }
    },
    [modsState.selectedMod, selectedLanguage],
  );

  // =================================================================
  //  Language selection handler
  // =================================================================

  const handleLanguageChange = useCallback(
    (lang: string) => {
      setSelectedLanguage(lang);

      if (showOnlySelectedLanguage && modsState.selectedMod) {
        // Safe mode: replace files with new language
        const filteredPaths = filterFilesByLanguage(
          modsState.selectedMod.localisation_paths,
          lang,
        );
        internalDraftChangeRef.current++;
        paths.replacePaths(filteredPaths);
        ctx.setFiles(filteredPaths);
        // Use setFormField to mark this as a manual override
        fields.setFormField('srcLang', lang);
      } else {
        // Advanced mode: just update srcLang (mark as manual override)
        fields.setFormField('srcLang', lang);
      }
    },
    [showOnlySelectedLanguage, modsState.selectedMod, fields.setFormField, paths.replacePaths],
  );

  // =================================================================
  //  Form actions — wired to flow layer
  // =================================================================

  const handlePreviewPlan = useCallback(() => {
    const values = buildFormValues(paths, fields);
    createFlow.openPreview(values, gameConfig);
  }, [
    paths.filePaths,
    fields.jobName,
    fields.srcLang,
    fields.dstLang,
    fields.batchSize,
    fields.useCache,
    fields.provider,
    fields.model,
    fields.apiKeyId,
    fields.apiKeyIds,
    fields.promptProfileName,
    fields.protectionStrategy,
    fields.validatorName,
    fields.outputDir,
    fields.outputFilenameSuffix,
    fields.outputPreserveRelativePath,
    fields.outputOverwrite,
    fields.outputBackup,
    fields.temperature,
    fields.maxRetries,
    fields.timeoutSec,
    fields.maxCompletionTokens,
    fields.saveRawResponses,
    fields.promptOverrideEnabled,
    fields.batchSystemPrompt,
    fields.batchUserTemplate,
    fields.singleSystemPrompt,
    fields.singleUserTemplate,
    fields.logPrompts,
    gameConfig,
  ]);

  const handleCreateJob = useCallback(async () => {
    const values = buildFormValues(paths, fields);
    // createDirectJob syncs form paths to the backend draft (authoritative)
    // before creating the job, so there is no race with fire-and-forget
    // add/remove/set mutations.  The backend also clears the draft after
    // successful job creation, so we only clear the local draft here.
    await createFlow.createDirectJob(values, gameConfig);
    clearDraft();
  }, [
    paths.filePaths,
    fields.jobName,
    fields.srcLang,
    fields.dstLang,
    fields.batchSize,
    fields.useCache,
    fields.provider,
    fields.model,
    fields.apiKeyId,
    fields.apiKeyIds,
    fields.promptProfileName,
    fields.protectionStrategy,
    fields.validatorName,
    fields.outputDir,
    fields.outputFilenameSuffix,
    fields.outputPreserveRelativePath,
    fields.outputOverwrite,
    fields.outputBackup,
    fields.temperature,
    fields.maxRetries,
    fields.timeoutSec,
    fields.maxCompletionTokens,
    fields.saveRawResponses,
    fields.promptOverrideEnabled,
    fields.batchSystemPrompt,
    fields.batchUserTemplate,
    fields.singleSystemPrompt,
    fields.singleUserTemplate,
    fields.logPrompts,
    gameConfig,
  ]);

  // =================================================================
  //  setFormField — VM-level dispatcher
  //  Routes 'filePaths' to the paths hook, everything else to fields.
  // =================================================================

  const setFormField = useCallback(
    <K extends keyof CreateJobFormModel>(
      field: K,
      value: CreateJobFormModel[K],
    ) => {
      if (field === 'filePaths') {
        internalDraftChangeRef.current++;
        paths.syncPathsFromText(value as string);
        // Sync draft storage with the new path list
        ctx.setFiles(normalizePathLines(value as string));
      } else {
        (fields.setFormField as (f: string, v: unknown) => void)(
          field as string,
          value,
        );
      }
    },
    [paths.syncPathsFromText, fields.setFormField, ctx.setFiles],
  );

  // =================================================================
  //  Build view model
  // =================================================================

  const form = buildForm(paths, fields);

  // =================================================================
  //  Validation errors — computed from current form state
  // =================================================================

  const validationErrors = getCreateJobProblems({
    filePaths: form.filePaths,
    srcLang: form.srcLang,
    dstLang: form.dstLang,
    provider: form.provider,
    model: form.model,
    apiKeyIds: form.apiKeyIds,
    availableKeysForProvider: filteredApiKeys.length,
    // --- Advanced config validation ---
    promptProfileName: form.promptProfileName,
    protectionStrategy: form.protectionStrategy,
    validatorName: form.validatorName,
    temperature: form.temperature,
    maxRetries: form.maxRetries,
    timeoutSec: form.timeoutSec,
    maxCompletionTokens: form.maxCompletionTokens,
  });

  // =================================================================
  //  Profile game warning — shown in confirmation modal when a mod is
  //  selected and the pending profile targets a different game.
  // =================================================================

  let profileGameWarning = '';
  if (
    profileConfirmType === 'apply' &&
    pendingProfileId &&
    modsState.selectedMod
  ) {
    const pendingProfile = profiles.find(p => p.id === pendingProfileId);
    if (pendingProfile?.game && pendingProfile.game !== modsState.selectedMod.game_id) {
      profileGameWarning =
        'This profile targets a different game/parser. Mod-specific game settings will not be applied.';
    }
  }

  return {
    form,
    setFormField,

    // --- API Keys ---
    apiKeys,
    filteredApiKeys,
    apiKeysLoading,

    // --- Validation ---
    validationErrors,

    searchQuery: fileSearch.searchQuery,
    setSearchQuery: fileSearch.setSearchQuery,
    foundFiles: fileSearch.foundFiles,
    searching: fileSearch.searching,
    searchError: fileSearch.searchError,
    addedPaths: paths.addedPaths,
    pickFilePath: fileSearch.pickFilePath,
    setPickFilePath: fileSearch.setPickFilePath,
    pickSearchPath: fileSearch.pickSearchPath,
    setPickSearchPath: fileSearch.setPickSearchPath,
    addPath: handleAddPath,
    removePath: handleRemovePath,
    handleSearch: fileSearch.handleSearch,
    handleAddAll: fileSearch.handleAddAll,

    mods: modsState.mods,
    filteredMods,
    modsLoading: modsState.modsLoading,
    selectedMod: modsState.selectedMod,
    handleSelectMod,
    handleClearSelection,

    // --- Game filter ---
    games: gamesState.games,
    gamesWithMods: gamesState.gamesWithMods,
    gamesLoading: gamesState.gamesLoading,
    selectedGameId: gamesState.selectedGameId,
    handleGameChange,

    showOnlySelectedLanguage,
    setShowOnlySelectedLanguage: handleToggleChange,
    selectedLanguage,
    setSelectedLanguage: handleLanguageChange,
    availableLanguages,

    modFromQuery,
    gameConfig,

    handleResetDefaults: () => {
      internalDraftChangeRef.current++;
      paths.replacePaths([]);
      fields.resetFormFields();
      clearDraft();
      ctx.clearFiles();
    },
    handlePreviewPlan,
    handleCreateJob,

    // --- Effective prompt ---
    effectivePrompt,
    effectivePromptLoading,

    // --- Prompt preview ---
    previewPromptData,
    previewPromptMode,
    setPreviewPromptMode,
    handlePreviewPrompt,
    closePreviewPrompt,
    previewPromptLoading,

    previewData: createFlow.previewData,
    previewLoading: createFlow.previewLoading,
    creatingJob: createFlow.creatingJob,
    selectedProfileId: createFlow.selectedProfileId,
    profileSelectValue,
    handleProfileSelect,
    selectProfileDirect,
    showProfileConfirm,
    profileConfirmType,
    profileGameWarning,
    confirmProfileApply,
    cancelProfileConfirm,
  };
}
