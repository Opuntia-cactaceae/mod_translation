import { useState, useEffect, useCallback, useRef } from 'react';
import { api, ApiError } from '../../App';
import { mapJobResponse, mapTranslationPreview } from '../../domain';
import { getCreateJobProblems, canConfirmPreview } from '../../domain/jobValidation';
import { buildJobConfig as buildDomainJobConfig } from '../../domain/jobConfigBuild';
import type { TranslationPreviewModel } from '../../domain';
import type { TranslationProfile } from '../../api/types';
import { loadPendingTranslation, clearPendingTranslation as clearPendingStorage } from '../../utils/pendingTranslation';
import { usePersistentState } from '../usePersistentState';
import { STORAGE_KEYS } from '../../utils/storageKeys';

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

import type { JobModel } from '../../domain';

/** Result returned by createDirectJob / createAndStartJob */
export interface CreateJobResult {
  job: JobModel;
}

export interface UseCreateJobFlowOptions {
  reloadJobs: () => Promise<void>;
  selectJob: (jobId: string) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

/**
 * Form values needed by the create-job flow.
 * These are owned by TranslationJobs.tsx (UI state), not by the hook.
 */
export interface CreateJobFormValues {
  filePaths: string;
  jobName: string;
  srcLang: string;
  dstLang: string;
  batchSize: number;
  useCache: boolean;
  provider: string;
  model: string;
  apiKeyId: string;
  apiKeyIds: string[];
  // --- Advanced config ---
  promptProfileName: string;
  // Prompt template overrides (Parts 3-5)
  promptOverrideEnabled?: boolean;
  batchSystemPrompt?: string;
  batchUserTemplate?: string;
  singleSystemPrompt?: string;
  singleUserTemplate?: string;
  logPrompts?: boolean;
  protectionStrategy: string;
  ruleSetIds: string[];
  validatorName: string;
  outputDir: string;
  outputFilenameSuffix: string;
  outputPreserveRelativePath: boolean;
  outputOverwrite: boolean;
  outputBackup: boolean;
  temperature: number;
  maxRetries: number;
  timeoutSec: number;
  maxCompletionTokens: number;
  saveRawResponses: boolean;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useCreateJobFlow(options: UseCreateJobFlowOptions) {
  const { reloadJobs, selectJob, showToast } = options;

  // ---------------------------------------------------------------
  //  Preview state
  // ---------------------------------------------------------------
  const [previewData, setPreviewData] = useState<TranslationPreviewModel | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ---------------------------------------------------------------
  //  Create job loading state
  // ---------------------------------------------------------------
  const [creatingJob, setCreatingJob] = useState(false);

  // ---------------------------------------------------------------
  //  Pending translation (loaded on mount from localStorage)
  // ---------------------------------------------------------------
  const [pendingFiles, setPendingFiles] = useState<string[]>([]);
  const [pendingSourceName, setPendingSourceName] = useState<string | undefined>();
  const [pendingModId, setPendingModId] = useState<string | undefined>();
  const [pendingGameConfig, setPendingGameConfig] = useState<Record<string, unknown> | undefined>();

  // Refs to always read the latest pendingModId/pendingSourceName,
  // even from async code paths or useCallback-wrapped functions that
  // may capture a stale closure.
  const pendingModIdRef = useRef(pendingModId);
  pendingModIdRef.current = pendingModId;
  const pendingSourceNameRef = useRef(pendingSourceName);
  pendingSourceNameRef.current = pendingSourceName;

  useEffect(() => {
    const pending = loadPendingTranslation();
    if (pending) {
      if (pending.files && pending.files.length > 0) {
        setPendingFiles(pending.files);
      }
      setPendingSourceName(pending.sourceName ?? pending.modName);
      setPendingModId(pending.modId);
      if (pending.gameConfig) {
        setPendingGameConfig(pending.gameConfig);
      }
      // Clear from storage immediately (consumed once on navigation)
      clearPendingStorage();
    } else {
      // No pending translation — check backend for accumulated draft files
      api.getDraftJobSelection().then(state => {
        if (state.files.length > 0) {
          setPendingFiles(state.files);
        }
      }).catch(() => {
        // Silently fail — form will show empty
      });
    }
  }, []);

  // ---------------------------------------------------------------
  //  Selected profile (persisted in localStorage)
  // ---------------------------------------------------------------
  const [selectedProfileId, setSelectedProfileId] = usePersistentState(
    STORAGE_KEYS.selectedProfileId,
    '',
  );

  // ---------------------------------------------------------------
  //  Clear pending translation and draft files (exposed for external use)
  // ---------------------------------------------------------------
  const clearPending = useCallback(() => {
    clearPendingStorage();
    api.clearDraftJobSelection().catch(() => { /* ignore */ });
  }, []);

  // ---------------------------------------------------------------
  //  Config assembly (frontend-side orchestration only)
  // ---------------------------------------------------------------
  function buildJobConfig(
    values: CreateJobFormValues,
    gameConfig: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    // Only pass prompt override fields if the toggle is enabled
    const promptOverrideFields: Record<string, unknown> = {};
    if (values.promptOverrideEnabled) {
      if (values.batchSystemPrompt) promptOverrideFields.batchSystemPrompt = values.batchSystemPrompt;
      if (values.batchUserTemplate) promptOverrideFields.batchUserTemplate = values.batchUserTemplate;
      if (values.singleSystemPrompt) promptOverrideFields.singleSystemPrompt = values.singleSystemPrompt;
      if (values.singleUserTemplate) promptOverrideFields.singleUserTemplate = values.singleUserTemplate;
      // Always write logPrompts so false can override a global default (Task 6)
      if (values.logPrompts != null) promptOverrideFields.logPrompts = values.logPrompts;
    }

    return buildDomainJobConfig({
      srcLang: values.srcLang,
      dstLang: values.dstLang,
      batchSize: values.batchSize,
      useCache: values.useCache,
      provider: values.provider,
      model: values.model,
      apiKeyId: values.apiKeyId,
      apiKeyIds: values.apiKeyIds,
      // --- Advanced config ---
      promptProfileName: values.promptProfileName,
      ...promptOverrideFields,
      protectionStrategy: values.protectionStrategy,
      ruleSetIds: values.ruleSetIds,
      validatorName: values.validatorName,
      outputDir: values.outputDir,
      outputFilenameSuffix: values.outputFilenameSuffix,
      outputPreserveRelativePath: values.outputPreserveRelativePath,
      outputOverwrite: values.outputOverwrite,
      outputBackup: values.outputBackup,
      temperature: values.temperature,
      maxRetries: values.maxRetries,
      timeoutSec: values.timeoutSec,
      maxCompletionTokens: values.maxCompletionTokens,
      selectedProfileId: selectedProfileId || undefined,
      gameConfig,
    });
  }

  // ---------------------------------------------------------------
  //  Internal: create job and optionally start it
  // ---------------------------------------------------------------
  async function createAndStartJob(values: CreateJobFormValues, gameConfig: Record<string, unknown> | null | undefined): Promise<JobModel> {
    const rawPaths = values.filePaths.split('\n').map(s => s.trim()).filter(Boolean);

    // If no paths in the textarea, use the backend draft selection
    if (rawPaths.length === 0) {
      return createJobUsingDraft(values, gameConfig);
    }

    setCreatingJob(true);
    try {
      // ---------------------------------------------------------------
      //  Sync form paths to backend draft (authoritative source of truth)
      //
      //  Before creating the job we PUT the form's current files so the
      //  backend has a consistent view.  This eliminates the race where a
      //  fire-and-forget add/remove (triggered by the user a moment ago)
      //  is still in-flight when create reads the draft.
      //
      //  The backend preserves metadata for surviving files and drops it
      //  for removed files.  The PUT response IS the fresh state — no
      //  separate GET is needed.
      // ---------------------------------------------------------------
      const draftState = await api.setDraftJobSelection({ files: rawPaths });

      // Build per-file metadata from the *fresh* backend draft state.
      let fileMetadata: Record<string, { mod_id?: string; mod_name?: string }> | undefined;
      for (const path of draftState.files) {
        const meta = draftState.file_metadata[path] as Record<string, unknown> | undefined;
        if (meta && (meta.mod_id || meta.mod_name)) {
          if (!fileMetadata) fileMetadata = {};
          fileMetadata[path] = {
            mod_id: meta.mod_id as string | undefined,
            mod_name: meta.mod_name as string | undefined,
          };
        }
      }

      // Pending translation fallback: if no backend metadata was found
      // but pendingModId/pendingSourceName are set (from pending translation
      // localStorage data), inject them as per-file metadata so the mod
      // context is preserved without relying on top-level mod_id/mod_name.
      // Uses refs to avoid stale closure issues with useCallback-wrapped callers.
      if (!fileMetadata && (pendingModIdRef.current || pendingSourceNameRef.current)) {
        fileMetadata = {};
        for (const path of draftState.files) {
          fileMetadata[path] = {
            mod_id: pendingModIdRef.current,
            mod_name: pendingSourceNameRef.current,
          };
        }
      }

      const newJob = await api.createJob({
        file_paths: draftState.files,
        name: values.jobName || undefined,
        config: buildJobConfig(values, gameConfig),
        // No top-level mod_id/mod_name — file_metadata is the primary source.
        // Legacy callers that send mod_id/mod_name without file_metadata are
        // still handled by the backend (legacy fallback).
        file_metadata: fileMetadata,
      });
      const mapped = mapJobResponse(newJob);
      showToast(`Job created: ${mapped.id.slice(0, 8)}`);
      // Select job immediately (before reload) so trace panel opens without delay
      selectJob(mapped.id);
      await reloadJobs();
      return mapped;
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(err.message, 'error');
      } else {
        showToast('Failed to create job', 'error');
      }
      throw err; // re-throw so callers can react
    } finally {
      setCreatingJob(false);
    }
  }

  // ---------------------------------------------------------------
  //  Draft-based job creation (no textarea paths)
  //
  //  When the textarea is empty, the form delegates to the backend
  //  draft selection state via use_draft_selection=True.  The backend
  //  fills file_paths and file_metadata from its persisted draft and
  //  clears the draft after the job is created.
  // ---------------------------------------------------------------
  async function createJobUsingDraft(values: CreateJobFormValues, gameConfig: Record<string, unknown> | null | undefined): Promise<JobModel> {
    setCreatingJob(true);
    try {
      const newJob = await api.createJob({
        file_paths: [],
        name: values.jobName || undefined,
        config: buildJobConfig(values, gameConfig),
        use_draft_selection: true,
      });
      const mapped = mapJobResponse(newJob);
      showToast(`Job created: ${mapped.id.slice(0, 8)}`);
      selectJob(mapped.id);
      await reloadJobs();
      return mapped;
    } catch (err) {
      if (err instanceof ApiError) {
        showToast(err.message, 'error');
      } else {
        showToast('Failed to create job from draft', 'error');
      }
      throw err;
    } finally {
      setCreatingJob(false);
    }
  }

  // ---------------------------------------------------------------
  //  Build preview config and fetch plan
  // ---------------------------------------------------------------
  const openPreview = useCallback(
    async (values: CreateJobFormValues, gameConfig: Record<string, unknown> | null | undefined) => {
      const paths = values.filePaths.split('\n').map(s => s.trim()).filter(Boolean);
      if (paths.length === 0) return;

      setPreviewLoading(true);
      setPreviewData(null);
      try {
        const res = await api.previewTranslationPlan({
          file_paths: paths,
          config: buildJobConfig(values, gameConfig),
        });
        setPreviewData(mapTranslationPreview(res));
      } catch (err) {
        if (err instanceof ApiError) {
          showToast(err.message, 'error');
        } else {
          showToast('Preview failed', 'error');
        }
      } finally {
        setPreviewLoading(false);
      }
    },
    [selectedProfileId, showToast],
  );

  // ---------------------------------------------------------------
  //  Close preview
  // ---------------------------------------------------------------
  const closePreview = useCallback(() => {
    setPreviewData(null);
  }, []);

  // ---------------------------------------------------------------
  //  Confirm preview → create job → reload → select → close
  // ---------------------------------------------------------------
  const confirmPreview = useCallback(
    async (values: CreateJobFormValues, gameConfig: Record<string, unknown> | null | undefined) => {
      await createAndStartJob(values, gameConfig);
      closePreview();
      clearPending();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [closePreview, clearPending, selectedProfileId, reloadJobs, selectJob, showToast],
  );

  // ---------------------------------------------------------------
  //  Direct create (no preview)
  // ---------------------------------------------------------------
  const createDirectJob = useCallback(
    async (values: CreateJobFormValues, gameConfig: Record<string, unknown> | null | undefined): Promise<JobModel> => {
      return createAndStartJob(values, gameConfig);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedProfileId, reloadJobs, selectJob, showToast],
  );

  // ---------------------------------------------------------------
  //  Validation rules (delegated to domain layer)
  // ---------------------------------------------------------------
  const canCreateJob = useCallback(
    (values: CreateJobFormValues, availableKeysForProvider?: number): boolean => {
      return getCreateJobProblems({
        filePaths: values.filePaths,
        srcLang: values.srcLang,
        dstLang: values.dstLang,
        provider: values.provider,
        model: values.model,
        apiKeyIds: values.apiKeyIds,
        availableKeysForProvider: availableKeysForProvider ?? values.apiKeyIds.length,
      }).length === 0;
    },
    [],
  );

  const getCreateJobProblemsFn = useCallback(
    (values: CreateJobFormValues, availableKeysForProvider?: number): string[] => {
      return getCreateJobProblems({
        filePaths: values.filePaths,
        srcLang: values.srcLang,
        dstLang: values.dstLang,
        provider: values.provider,
        model: values.model,
        apiKeyIds: values.apiKeyIds,
        availableKeysForProvider: availableKeysForProvider ?? values.apiKeyIds.length,
      });
    },
    [],
  );

  const canConfirmPreviewFn = useCallback(
    (preview: TranslationPreviewModel | null): boolean => {
      return canConfirmPreview(preview);
    },
    [],
  );

  return {
    // State
    previewData,
    previewLoading,
    creatingJob,

    // Pending translation
    pendingFiles,
    pendingSourceName,
    pendingModId,
    pendingGameConfig,

    // Profile
    selectedProfileId,
    setSelectedProfileId,

    // Actions
    openPreview,
    closePreview,
    confirmPreview,
    createDirectJob,
    clearPending,

    // Validation
    canCreateJob,
    getCreateJobProblems: getCreateJobProblemsFn,
    canConfirmPreview: canConfirmPreviewFn,

    // Config assembly
    buildJobConfig,
  };
}

/* ------------------------------------------------------------------ */
/*  Pure helpers (can be used outside hook)                            */
/* ------------------------------------------------------------------ */

/**
 * Compute the profile config that should be applied to form fields.
 * Returns null if no profile is selected or not found.
 */
export function getProfileFormConfig(
  profiles: TranslationProfile[],
  selectedProfileId: string,
): { config: Record<string, unknown>; game?: string; file_handler?: string } | null {
  if (!selectedProfileId) return null;
  const profile = profiles.find(p => p.id === selectedProfileId);
  if (!profile || !profile.config) return null;
  return {
    config: profile.config,
    game: profile.game,
    file_handler: profile.file_handler ?? undefined,
  };
}
