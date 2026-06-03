import { useState, useRef, useCallback } from 'react';
import { BUILTIN_RULE_SET_ID } from '../../constants';
import type { CreateJobFormValues } from './useCreateJobFlow';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * Individual field setters — used internally by sibling hooks
 * that need to set form fields without dirty-flag management
 * (e.g. profile application, defaults restoration).
 */
export interface FieldSetters {
  setSrcLang: (v: string) => void;
  setDstLang: (v: string) => void;
  setBatchSize: (v: number) => void;
  setUseCache: (v: boolean) => void;
  setProvider: (v: string) => void;
  setModel: (v: string) => void;
  setApiKeyId: (v: string) => void;
  setApiKeyIds: (v: string[]) => void;
  // --- Advanced config setters ---
  setPromptProfileName: (v: string) => void;
  setProtectionStrategy: (v: string) => void;
  setRuleSetIds: (v: string[]) => void;
  setValidatorName: (v: string) => void;
  setOutputDir: (v: string) => void;
  setOutputFilenameSuffix: (v: string) => void;
  setOutputPreserveRelativePath: (v: boolean) => void;
  setOutputOverwrite: (v: boolean) => void;
  setOutputBackup: (v: boolean) => void;
  setTemperature: (v: number) => void;
  setMaxRetries: (v: number) => void;
  setTimeoutSec: (v: number) => void;
  setMaxCompletionTokens: (v: number) => void;
  setSaveRawResponses: (v: boolean) => void;
  // --- Prompt override fields ---
  setPromptOverrideEnabled: (v: boolean) => void;
  setBatchSystemPrompt: (v: string) => void;
  setBatchUserTemplate: (v: string) => void;
  setSingleSystemPrompt: (v: string) => void;
  setSingleUserTemplate: (v: string) => void;
  setLogPrompts: (v: boolean) => void;
}

export interface DirtyFlags {
  srcLangDirty: boolean;
  dstLangDirty: boolean;
  batchSizeDirty: boolean;
  useCacheDirty: boolean;
  providerDirty: boolean;
  modelDirty: boolean;
  // --- Advanced config dirty flags ---
  promptProfileNameDirty: boolean;
  protectionStrategyDirty: boolean;
  ruleSetIdsDirty: boolean;
  validatorNameDirty: boolean;
  outputDirDirty: boolean;
  outputFilenameSuffixDirty: boolean;
  outputPreserveRelativePathDirty: boolean;
  outputOverwriteDirty: boolean;
  outputBackupDirty: boolean;
  temperatureDirty: boolean;
  maxRetriesDirty: boolean;
  timeoutSecDirty: boolean;
  maxCompletionTokensDirty: boolean;
  saveRawResponsesDirty: boolean;
}

export interface DefaultsRefs {
  defaultSrcLangRef: { current: string };
  defaultDstLangRef: { current: string };
  defaultBatchSizeRef: { current: number };
  defaultUseCacheRef: { current: boolean };
  defaultProviderRef: { current: string };
  defaultModelRef: { current: string };
}

export interface UseCreateJobFieldsReturn {
  /** Unified field setter with dirty-flag management (scalar fields only) */
  setFormField: <K extends ScalarField>(
    field: K,
    value: CreateJobFormScalarValues[K],
  ) => void;
  /** Reset dirty-flagged fields back to their stored defaults */
  resetFormFields: () => void;
  /** Raw setters for dirty-flagged fields (consumed by sibling hooks) */
  fieldSetters: FieldSetters;
  /** Current dirty-flag state (consumed by sibling hooks) */
  dirty: DirtyFlags;
  /** Default value refs populated by settings (consumed by sibling hooks) */
  defaultsRefs: DefaultsRefs;
  /** Scalar form state exposed for assembly in parent hook */
  jobName: string;
  srcLang: string;
  dstLang: string;
  batchSize: number;
  useCache: boolean;
  provider: string;
  model: string;
  apiKeyId: string;
  apiKeyIds: string[];
  // --- Advanced config fields exposed for assembly ---
  promptProfileName: string;
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
  // --- Prompt override fields ---
  promptOverrideEnabled: boolean;
  batchSystemPrompt: string;
  batchUserTemplate: string;
  singleSystemPrompt: string;
  singleUserTemplate: string;
  logPrompts: boolean;
}

/** Fields handled by useCreateJobFields (excludes filePaths which is in useCreateJobPaths) */
export type CreateJobFormScalarValues = Pick<
  CreateJobFormValues,
  'jobName' | 'srcLang' | 'dstLang' | 'batchSize' | 'useCache' | 'provider' | 'model' | 'apiKeyId' | 'apiKeyIds'
  | 'promptProfileName' | 'protectionStrategy' | 'ruleSetIds' | 'validatorName'
  | 'outputDir' | 'outputFilenameSuffix' | 'outputPreserveRelativePath' | 'outputOverwrite' | 'outputBackup'
  | 'temperature' | 'maxRetries' | 'timeoutSec' | 'maxCompletionTokens'
  | 'saveRawResponses'
  | 'promptOverrideEnabled' | 'batchSystemPrompt' | 'batchUserTemplate' | 'singleSystemPrompt' | 'singleUserTemplate'
  | 'logPrompts'
>;

type ScalarField = keyof CreateJobFormScalarValues;

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useCreateJobFields(): UseCreateJobFieldsReturn {
  // =================================================================
  //  Form fields
  // =================================================================

  const [jobName, setJobName] = useState('');
  const [srcLang, setSrcLang] = useState('english');
  const [dstLang, setDstLang] = useState('russian');
  const [batchSize, setBatchSize] = useState(50);
  const [useCache, setUseCache] = useState(true);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [apiKeyId, setApiKeyId] = useState('');
  const [apiKeyIds, setApiKeyIds] = useState<string[]>([]);

  // --- Advanced config state ---
  const [promptProfileName, setPromptProfileName] = useState('');
  const [protectionStrategy, setProtectionStrategy] = useState('');
  const [ruleSetIds, setRuleSetIds] = useState<string[]>([BUILTIN_RULE_SET_ID]);
  const [validatorName, setValidatorName] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [outputFilenameSuffix, setOutputFilenameSuffix] = useState('');
  const [outputPreserveRelativePath, setOutputPreserveRelativePath] = useState(false);
  const [outputOverwrite, setOutputOverwrite] = useState(false);
  const [outputBackup, setOutputBackup] = useState(false);
  const [temperature, setTemperature] = useState(0);
  const [maxRetries, setMaxRetries] = useState(3);
  const [timeoutSec, setTimeoutSec] = useState(0);
  const [maxCompletionTokens, setMaxCompletionTokens] = useState(0);
  const [saveRawResponses, setSaveRawResponses] = useState(false);

  // --- Prompt override fields (Part 4) — no dirty-flag needed ---
  const [promptOverrideEnabled, setPromptOverrideEnabled] = useState(false);
  const [batchSystemPrompt, setBatchSystemPrompt] = useState('');
  const [batchUserTemplate, setBatchUserTemplate] = useState('');
  const [singleSystemPrompt, setSingleSystemPrompt] = useState('');
  const [singleUserTemplate, setSingleUserTemplate] = useState('');
  const [logPrompts, setLogPrompts] = useState(false);

  // =================================================================
  //  Dirty flags — prevent settings/profile overrides from
  //  overwriting user edits
  // =================================================================

  const [srcLangDirty, setSrcLangDirty] = useState(false);
  const [dstLangDirty, setDstLangDirty] = useState(false);
  const [providerDirty, setProviderDirty] = useState(false);
  const [modelDirty, setModelDirty] = useState(false);
  const [batchSizeDirty, setBatchSizeDirty] = useState(false);
  const [useCacheDirty, setUseCacheDirty] = useState(false);

  // --- Advanced config dirty flags ---
  const [promptProfileNameDirty, setPromptProfileNameDirty] = useState(false);
  const [protectionStrategyDirty, setProtectionStrategyDirty] = useState(false);
  const [ruleSetIdsDirty, setRuleSetIdsDirty] = useState(false);
  const [validatorNameDirty, setValidatorNameDirty] = useState(false);
  const [outputDirDirty, setOutputDirDirty] = useState(false);
  const [outputFilenameSuffixDirty, setOutputFilenameSuffixDirty] = useState(false);
  const [outputPreserveRelativePathDirty, setOutputPreserveRelativePathDirty] = useState(false);
  const [outputOverwriteDirty, setOutputOverwriteDirty] = useState(false);
  const [outputBackupDirty, setOutputBackupDirty] = useState(false);
  const [temperatureDirty, setTemperatureDirty] = useState(false);
  const [maxRetriesDirty, setMaxRetriesDirty] = useState(false);
  const [timeoutSecDirty, setTimeoutSecDirty] = useState(false);
  const [maxCompletionTokensDirty, setMaxCompletionTokensDirty] = useState(false);
  const [saveRawResponsesDirty, setSaveRawResponsesDirty] = useState(false);

  // =================================================================
  //  Settings defaults refs
  // =================================================================

  const defaultSrcLangRef = useRef('english');
  const defaultDstLangRef = useRef('russian');
  const defaultProviderRef = useRef('');
  const defaultModelRef = useRef('');
  const defaultBatchSizeRef = useRef(50);
  const defaultUseCacheRef = useRef(true);

  // =================================================================
  //  setFormField — unified typed setter with dirty-flag management
  //  Scalar fields only. Path fields are handled by useCreateJobPaths.
  // =================================================================

  const setFormField = useCallback(
    <K extends ScalarField>(
      field: K,
      value: CreateJobFormScalarValues[K],
    ) => {
      switch (field) {
        case 'jobName':
          setJobName(value as string);
          break;
        case 'srcLang': {
          const v = value as string;
          setSrcLang(v);
          setSrcLangDirty(true);
          break;
        }
        case 'dstLang': {
          const v = value as string;
          setDstLang(v);
          setDstLangDirty(true);
          break;
        }
        case 'batchSize': {
          const v = value as number;
          setBatchSize(v);
          setBatchSizeDirty(true);
          break;
        }
        case 'useCache': {
          const v = value as boolean;
          setUseCache(v);
          setUseCacheDirty(true);
          break;
        }
        case 'provider': {
          const v = value as string;
          setProvider(v);
          setProviderDirty(true);
          break;
        }
        case 'model': {
          const v = value as string;
          setModel(v);
          setModelDirty(true);
          break;
        }
        case 'apiKeyId':
          setApiKeyId(value as string);
          break;
        case 'apiKeyIds':
          setApiKeyIds(value as string[]);
          break;
        // --- Advanced config setters ---
        case 'promptProfileName': {
          const v = value as string;
          setPromptProfileName(v);
          setPromptProfileNameDirty(true);
          break;
        }
        case 'protectionStrategy': {
          const v = value as string;
          setProtectionStrategy(v);
          setProtectionStrategyDirty(true);
          break;
        }
        case 'ruleSetIds': {
          const v = value as string[];
          setRuleSetIds(v);
          setRuleSetIdsDirty(true);
          break;
        }
        case 'validatorName': {
          const v = value as string;
          setValidatorName(v);
          setValidatorNameDirty(true);
          break;
        }
        case 'outputDir': {
          const v = value as string;
          setOutputDir(v);
          setOutputDirDirty(true);
          break;
        }
        case 'outputFilenameSuffix': {
          const v = value as string;
          setOutputFilenameSuffix(v);
          setOutputFilenameSuffixDirty(true);
          break;
        }
        case 'outputPreserveRelativePath': {
          const v = value as boolean;
          setOutputPreserveRelativePath(v);
          setOutputPreserveRelativePathDirty(true);
          break;
        }
        case 'outputOverwrite': {
          const v = value as boolean;
          setOutputOverwrite(v);
          setOutputOverwriteDirty(true);
          break;
        }
        case 'outputBackup': {
          const v = value as boolean;
          setOutputBackup(v);
          setOutputBackupDirty(true);
          break;
        }
        case 'temperature': {
          const v = value as number;
          setTemperature(v);
          setTemperatureDirty(true);
          break;
        }
        case 'maxRetries': {
          const v = value as number;
          setMaxRetries(v);
          setMaxRetriesDirty(true);
          break;
        }
        case 'timeoutSec': {
          const v = value as number;
          setTimeoutSec(v);
          setTimeoutSecDirty(true);
          break;
        }
        case 'maxCompletionTokens': {
          const v = value as number;
          setMaxCompletionTokens(v);
          setMaxCompletionTokensDirty(true);
          break;
        }
        case 'saveRawResponses': {
          const v = value as boolean;
          setSaveRawResponses(v);
          setSaveRawResponsesDirty(true);
          break;
        }
        // --- Prompt override fields ---
        case 'promptOverrideEnabled':
          setPromptOverrideEnabled(value as boolean);
          break;
        case 'batchSystemPrompt':
          setBatchSystemPrompt(value as string);
          break;
        case 'batchUserTemplate':
          setBatchUserTemplate(value as string);
          break;
        case 'singleSystemPrompt':
          setSingleSystemPrompt(value as string);
          break;
        case 'singleUserTemplate':
          setSingleUserTemplate(value as string);
          break;
        case 'logPrompts':
          setLogPrompts(value as boolean);
          break;
      }
    },
    [],
  );

  // =================================================================
  //  handleResetDefaults — reset fields to stored defaults
  // =================================================================

  function resetFormFields() {
    setSrcLang(defaultSrcLangRef.current);
    setSrcLangDirty(false);
    setDstLang(defaultDstLangRef.current);
    setDstLangDirty(false);
    setProvider(defaultProviderRef.current);
    setProviderDirty(false);
    setModel(defaultModelRef.current);
    setModelDirty(false);
    setBatchSize(defaultBatchSizeRef.current);
    setBatchSizeDirty(false);
    setUseCache(defaultUseCacheRef.current);
    setUseCacheDirty(false);
    // Reset advanced config fields to empty defaults
    setPromptProfileName('');
    setPromptProfileNameDirty(false);
    setProtectionStrategy('');
    setProtectionStrategyDirty(false);
    setRuleSetIds([BUILTIN_RULE_SET_ID]);
    setRuleSetIdsDirty(false);
    setValidatorName('');
    setValidatorNameDirty(false);
    setOutputDir('');
    setOutputDirDirty(false);
    setOutputFilenameSuffix('');
    setOutputFilenameSuffixDirty(false);
    setOutputPreserveRelativePath(false);
    setOutputPreserveRelativePathDirty(false);
    setOutputOverwrite(false);
    setOutputOverwriteDirty(false);
    setOutputBackup(false);
    setOutputBackupDirty(false);
    setTemperature(0);
    setTemperatureDirty(false);
    setMaxRetries(3);
    setMaxRetriesDirty(false);
    setTimeoutSec(0);
    setTimeoutSecDirty(false);
    setMaxCompletionTokens(0);
    setMaxCompletionTokensDirty(false);
    setSaveRawResponses(false);
    setSaveRawResponsesDirty(false);
  }

  // =================================================================
  //  Field setters — exposed for sibling hooks
  // =================================================================

  const fieldSetters: FieldSetters = {
    setSrcLang,
    setDstLang,
    setBatchSize,
    setUseCache,
    setProvider,
    setModel,
    setApiKeyId,
    setApiKeyIds,
    setPromptProfileName,
    setProtectionStrategy,
    setRuleSetIds,
    setValidatorName,
    setOutputDir,
    setOutputFilenameSuffix,
    setOutputPreserveRelativePath,
    setOutputOverwrite,
    setOutputBackup,
    setTemperature,
    setMaxRetries,
    setTimeoutSec,
    setMaxCompletionTokens,
    setSaveRawResponses,
    // --- Prompt override fields ---
    setPromptOverrideEnabled,
    setBatchSystemPrompt,
    setBatchUserTemplate,
    setSingleSystemPrompt,
    setSingleUserTemplate,
    setLogPrompts,
  };

  const dirty: DirtyFlags = {
    srcLangDirty,
    dstLangDirty,
    batchSizeDirty,
    useCacheDirty,
    providerDirty,
    modelDirty,
    promptProfileNameDirty,
    protectionStrategyDirty,
    ruleSetIdsDirty,
    validatorNameDirty,
    outputDirDirty,
    outputFilenameSuffixDirty,
    outputPreserveRelativePathDirty,
    outputOverwriteDirty,
    outputBackupDirty,
    temperatureDirty,
    maxRetriesDirty,
    timeoutSecDirty,
    maxCompletionTokensDirty,
    saveRawResponsesDirty,
  };

  const defaultsRefs: DefaultsRefs = {
    defaultSrcLangRef,
    defaultDstLangRef,
    defaultBatchSizeRef,
    defaultUseCacheRef,
    defaultProviderRef,
    defaultModelRef,
  };

  return {
    setFormField,
    resetFormFields,
    fieldSetters,
    dirty,
    defaultsRefs,
    jobName,
    srcLang,
    dstLang,
    batchSize,
    useCache,
    provider,
    model,
    apiKeyId,
    apiKeyIds,
    // --- Advanced config fields ---
    promptProfileName,
    protectionStrategy,
    ruleSetIds,
    validatorName,
    outputDir,
    outputFilenameSuffix,
    outputPreserveRelativePath,
    outputOverwrite,
    outputBackup,
    temperature,
    maxRetries,
    timeoutSec,
    maxCompletionTokens,
    saveRawResponses,
    // --- Prompt override fields ---
    promptOverrideEnabled,
    batchSystemPrompt,
    batchUserTemplate,
    singleSystemPrompt,
    singleUserTemplate,
    logPrompts,
  };
}
