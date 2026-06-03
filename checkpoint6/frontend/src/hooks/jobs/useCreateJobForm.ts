import { useEffect, useState, useCallback, useRef } from 'react';
import type { CreateJobFormModel, TranslationPreviewModel } from '../../domain';
import { detectSourceLangFromPaths, normalizePathLines } from '../../domain/jobFormHelpers';
import { getCreateJobProblems } from '../../domain/jobValidation';
import type { ModInfoSchema, GameOption, TranslationProfile, ApiKeyResponse, EffectivePromptResponse, PreviewPromptResponse, DraftSelectionGroup } from '../../api/types';
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
import { useDraftJobSelection, type DraftFileMeta } from '../../contexts/DraftJobSelectionContext';
import { dedupeMods } from '../../utils/dedupeMods';

/* ------------------------------------------------------------------ */
/*  Draft types                                                        */
/* ------------------------------------------------------------------ */

export interface CreateJobDraft {
  selectedGameId?: string;
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
  ruleSetIds?: string[];
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
  // --- Prompt override fields ---
  promptOverrideEnabled?: boolean;
  batchSystemPrompt?: string;
  batchUserTemplate?: string;
  singleSystemPrompt?: string;
  singleUserTemplate?: string;
  logPrompts?: boolean;
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
  /** Mods filtered by the currently selected game, deduplicated. */
  filteredMods: ModInfoSchema[];
  modsLoading: boolean;

  // --- Game filter ---
  games: GameOption[];
  gamesWithMods: GameOption[];
  gamesLoading: boolean;
  selectedGameId: string;
  handleGameChange: (gameId: string) => void;

  // --- Derived / loaded state ---
  gameConfig: Record<string, unknown> | null;

  // --- Actions ---
  handleResetDefaults: () => void;
  handlePreviewPlan: () => void;
  handleCreateJob: () => Promise<void>;

  // --- Effective prompt ---
  effectivePrompt: EffectivePromptResponse | null;
  effectivePromptLoading: boolean;

  // --- Prompt preview ---
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
  confirmProfileApply: () => void;
  cancelProfileConfirm: () => void;

  // --- Draft job selection (backend-driven) ---
  /** Grouped file tree from backend draft state. */
  draftGrouped: DraftSelectionGroup[];
  /** Per-file metadata (modId, modName) keyed by normalized path. */
  draftMeta: Record<string, DraftFileMeta>;
  /** Flat list of draft file paths. */
  draftFiles: string[];
  /** Diagnostics/warnings from backend draft state. */
  draftDiagnostics: Array<{ level: string; code: string; message: string }>;
  /** Number of files in the draft. */
  draftFileCount: number;
  /** Whether draft is loading from backend. */
  draftLoading: boolean;
  /** Error message from the last draft API mutation, or null. */
  draftError: string | null;

  /** Currently selected mod paths for multi-add. */
  selectedModPaths: string[];
  /** Set selected mod paths. */
  setSelectedModPaths: (paths: string[]) => void;

  /** Add localisation files from the selected mods via backend. */
  handleAddModFiles: () => Promise<void>;
  /** Search and add localisation files via backend. */
  handleSearchAndAdd: () => Promise<void>;
  /** Remove a single file from the draft (calls backend DELETE). */
  handleRemoveDraftFile: (path: string) => Promise<void>;
  /** Remove multiple files from the draft (batch DELETE). */
  handleRemoveDraftFiles: (paths: string[]) => Promise<void>;
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
    ruleSetIds: fields.ruleSetIds,
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
    ruleSetIds: fields.ruleSetIds,
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
    paths: { filePaths: string; filePathList: string[]; addedPaths: Set<string> };
    fields: UseCreateJobFieldsReturn;
    createFlow: { selectedProfileId: string };
    gameConfig: Record<string, unknown> | null;
  },
): CreateJobDraft {
  const { gamesState, paths, fields, createFlow, gameConfig } = opts;
  return {
    selectedGameId: gamesState.selectedGameId || undefined,
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
    sourceName: null,
    promptProfileName: fields.promptProfileName || undefined,
    protectionStrategy: fields.protectionStrategy || undefined,
    ruleSetIds: fields.ruleSetIds.length > 0 ? fields.ruleSetIds : undefined,
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

  // =================================================================
  //  Wrapped path operations — sync React state with draft_job_files
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
      applyProfileToForm(profiles, pendingProfileId, fields.fieldSetters, setGameConfig);
      createFlow.setSelectedProfileId(pendingProfileId);
    }

    // Update the displayed select value
    setProfileSelectValue(pendingProfileId);
    setShowProfileConfirm(false);
    setPendingProfileId(null);
  }, [pendingProfileId, profiles, fields.fieldSetters, createFlow.setSelectedProfileId, setGameConfig]);

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
  //  Game filter
  // =================================================================

  /** Mods filtered by the currently selected game, deduplicated. */
  const filteredMods = gamesState.selectedGameId
    ? dedupeMods(modsState.mods.filter(m => m.game_id === gamesState.selectedGameId))
    : dedupeMods(modsState.mods);

  const handleGameChange = useCallback(
    (gameId: string) => {
      gamesState.setSelectedGameId(gameId);
      // Clear file state when game changes
      internalDraftChangeRef.current++;
      paths.replacePaths([]);
      ctx.clearFiles();
      fileSearch.setSearchQuery('');
      fileSearch.setFoundFiles([]);
    },
    [],
  );

  // =================================================================
  //  Draft job selection — multi-mod, visual view, backend handlers
  // =================================================================

  /** Mod paths selected for multi-add. */
  const [selectedModPaths, setSelectedModPaths] = useState<string[]>([]);

  /** Add localisation files from the selected mods via backend. */
  const handleAddModFiles = useCallback(async () => {
    if (selectedModPaths.length === 0) return;
    try {
      // Send paths directly to avoid mod_id aliasing issues.
      await ctx.addFilesFromMods([], 'stellaris_localisation', 'english', selectedModPaths);
      setSelectedModPaths([]);
    } catch {
      showToast('Failed to add mod files', 'error');
    }
  }, [selectedModPaths, ctx.addFilesFromMods, showToast]);

  /** Search and add localisation files via backend. */
  const handleSearchAndAdd = useCallback(async () => {
    const roots = fileSearch.searchQuery.split('\n').map(s => s.trim()).filter(Boolean);
    if (roots.length === 0) return;
    try {
      await ctx.searchAndAddFiles(roots, 'stellaris_localisation', undefined, true);
      fileSearch.setSearchQuery('');
      fileSearch.setFoundFiles([]);
    } catch {
      showToast('Failed to search and add files', 'error');
    }
  }, [fileSearch.searchQuery, ctx.searchAndAddFiles, showToast]);

  /** Remove a single file and sync local paths state. */
  const handleRemoveDraftFile = useCallback(async (path: string) => {
    internalDraftChangeRef.current++;
    paths.removePath(path);
    await ctx.removeFile(path);
  }, [paths.removePath, ctx.removeFile]);

  /** Remove multiple files in batch and sync local paths. */
  const handleRemoveDraftFiles = useCallback(async (filePaths: string[]) => {
    internalDraftChangeRef.current++;
    for (const p of filePaths) {
      paths.removePath(p);
    }
    await ctx.removeFiles(filePaths);
  }, [paths.removePath, ctx.removeFiles]);

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
    if (createFlow.pendingGameConfig) {
      setGameConfig(createFlow.pendingGameConfig);
    }
  }, [createFlow.pendingFiles, createFlow.pendingGameConfig]);

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
    if (draft.ruleSetIds !== undefined) fields.setFormField('ruleSetIds', draft.ruleSetIds);
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
        applyProfileToForm(profiles, draft.selectedProfileId, fields.fieldSetters, setGameConfig);
      }
    }

    // Restore game config
    if (draft.gameConfig) {
      setGameConfig(draft.gameConfig);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // =================================================================
  //  Deferred draft path restore
  // =================================================================

  useEffect(() => {
    if (draftRestoredRef.current) return;
    if (ctx.loading) return;

    if (ctx.draftFiles.length > 0) {
      paths.replacePaths(ctx.draftFiles);
      draftRestoredRef.current = true;
      return;
    }

    if (draft && draft.filePathList && draft.filePathList.length > 0) {
      paths.replacePaths(draft.filePathList);
      ctx.setFiles(draft.filePathList);
    }

    draftRestoredRef.current = true;
  }, [ctx.loading, ctx.draftFiles]);

  // =================================================================
  //  Apply selected profile on initial load (when profiles arrive
  //  asynchronously)
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
    );
    initialProfileAppliedRef.current = true;
  }, [profiles, createFlow.selectedProfileId]);

  // =================================================================
  //  Save draft on form state changes
  // =================================================================

  useEffect(() => {
    if (!draftRestoredRef.current) return;

    setDraft(buildDraftFromState({
      gamesState, paths, fields, createFlow, gameConfig,
    }));
  }, [
    gamesState.selectedGameId,
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
    fields.ruleSetIds,
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
  ]);

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
    fields.ruleSetIds,
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
    await flushRawTextDebounce();

    const values = buildFormValues(paths, fields);
    const result = await createFlow.createDirectJob(values, gameConfig);

    // Do not clear the form if the job has zero translation units.
    // This keeps the user's file selection so they can adjust config
    // (language, header, etc.) and retry without re-adding files.
    if (result.totalUnits === 0) {
      const noUnitsDiag = result.diagnostics.find(
        d => d.code === 'NO_TRANSLATION_UNITS_FOUND' || d.code === 'NO_UNITS',
      );
      if (noUnitsDiag) {
        showToast(
          'No translation units found. Files were kept so you can adjust language/header/config.',
          'warning',
        );
        return;
      }
    }

    clearDraft();

    await ctx.refresh();
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
    fields.ruleSetIds,
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
    ctx.refresh,
    showToast,
  ]);

  // =================================================================
  //  Debounced raw textarea sync
  // =================================================================

  const rawTextDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DEBOUNCE_MS = 600;

  const filePathsRef = useRef(paths.filePaths);
  filePathsRef.current = paths.filePaths;

  const debouncedSyncPathsToBackend = useCallback((text: string) => {
    if (rawTextDebounceRef.current) {
      clearTimeout(rawTextDebounceRef.current);
    }
    rawTextDebounceRef.current = setTimeout(() => {
      ctx.setFiles(normalizePathLines(text));
      rawTextDebounceRef.current = null;
    }, DEBOUNCE_MS);
  }, [ctx.setFiles]);

  async function flushRawTextDebounce(): Promise<void> {
    if (rawTextDebounceRef.current) {
      clearTimeout(rawTextDebounceRef.current);
      rawTextDebounceRef.current = null;
      const currentPaths = normalizePathLines(filePathsRef.current);
      await ctx.setFiles(currentPaths);
    }
  }

  useEffect(() => {
    return () => {
      if (rawTextDebounceRef.current) {
        clearTimeout(rawTextDebounceRef.current);
      }
    };
  }, []);

  // =================================================================
  //  setFormField — VM-level dispatcher
  // =================================================================

  const setFormField = useCallback(
    <K extends keyof CreateJobFormModel>(
      field: K,
      value: CreateJobFormModel[K],
    ) => {
      if (field === 'filePaths') {
        internalDraftChangeRef.current++;
        paths.syncPathsFromText(value as string);
        debouncedSyncPathsToBackend(value as string);
      } else {
        (fields.setFormField as (f: string, v: unknown) => void)(
          field as string,
          value,
        );
      }
    },
    [paths.syncPathsFromText, fields.setFormField, debouncedSyncPathsToBackend],
  );

  // =================================================================
  //  Build view model
  // =================================================================

  const form = buildForm(paths, fields);

  // =================================================================
  //  Validation errors
  // =================================================================

  const validationErrors = getCreateJobProblems({
    filePaths: form.filePaths,
    srcLang: form.srcLang,
    dstLang: form.dstLang,
    provider: form.provider,
    model: form.model,
    apiKeyIds: form.apiKeyIds,
    availableKeysForProvider: filteredApiKeys.length,
    promptProfileName: form.promptProfileName,
    protectionStrategy: form.protectionStrategy,
    validatorName: form.validatorName,
    temperature: form.temperature,
    maxRetries: form.maxRetries,
    timeoutSec: form.timeoutSec,
    maxCompletionTokens: form.maxCompletionTokens,
  });

  // =================================================================
  //  Return view model
  // =================================================================

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

    // --- Game filter ---
    games: gamesState.games,
    gamesWithMods: gamesState.gamesWithMods,
    gamesLoading: gamesState.gamesLoading,
    selectedGameId: gamesState.selectedGameId,
    handleGameChange,

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
    confirmProfileApply,
    cancelProfileConfirm,

    // --- Draft job selection ---
    draftGrouped: ctx.grouped,
    draftMeta: ctx.draftMeta,
    draftFiles: ctx.draftFiles,
    draftDiagnostics: ctx.diagnostics,
    draftFileCount: ctx.fileCount,
    draftLoading: ctx.loading,
    draftError: ctx.error,
    selectedModPaths,
    setSelectedModPaths,
    handleAddModFiles,
    handleSearchAndAdd,
    handleRemoveDraftFile,
    handleRemoveDraftFiles,
  };
}
