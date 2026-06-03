/* ------------------------------------------------------------------ */
/*  Imperative profile application helper                               */
/*  Applies a profile's config unconditionally to all translation       */
/*  settings. No dirty-flag checks — all-or-nothing apply.              */
/* ------------------------------------------------------------------ */

import type { TranslationProfile } from '../../api/types';
import { getProfileFormConfig } from './useCreateJobFlow';
import type { FieldSetters } from './useCreateJobFields';
import { getNestedValue } from '../../domain/configFieldRegistry';

/* ------------------------------------------------------------------ */
/*  Imperative apply — overwrites ALL translation settings              */
/*  Uses configFieldRegistry.getNestedValue for config reads.          */
/* ------------------------------------------------------------------ */

/**
 * Apply the selected profile's config to form fields unconditionally.
 * Does NOT touch file-related fields (file paths, etc.).
 * Does NOT check dirty flags — all-or-nothing.
 */
export function applyProfileToForm(
  profiles: TranslationProfile[],
  selectedProfileId: string,
  fieldSetters: FieldSetters,
  setGameConfig: (updater: Record<string, unknown> | null | ((prev: Record<string, unknown> | null) => Record<string, unknown> | null)) => void,
): void {
  const profileConfig = getProfileFormConfig(profiles, selectedProfileId);
  if (!profileConfig) return;

  const cfg = profileConfig.config;

  // --- Basic fields ---
  const srcLang = getNestedValue(cfg, 'src_lang');
  if (srcLang != null && srcLang !== '') fieldSetters.setSrcLang(String(srcLang));

  const dstLang = getNestedValue(cfg, 'dst_lang');
  if (dstLang != null && dstLang !== '') fieldSetters.setDstLang(String(dstLang));

  const batchSize = getNestedValue(cfg, 'batch_size');
  if (batchSize != null) fieldSetters.setBatchSize(Number(batchSize));

  const useCache = getNestedValue(cfg, 'use_cache');
  if (useCache != null) fieldSetters.setUseCache(Boolean(useCache));

  const saveRawResponses = getNestedValue(cfg, 'save_raw_responses');
  if (saveRawResponses != null) fieldSetters.setSaveRawResponses(Boolean(saveRawResponses));

  // --- Runtime fields ---
  const provider = getNestedValue(cfg, 'runtime.provider');
  if (provider != null && provider !== '') fieldSetters.setProvider(String(provider));

  const model = getNestedValue(cfg, 'runtime.model');
  if (model != null && model !== '') fieldSetters.setModel(String(model));

  const temperature = getNestedValue(cfg, 'runtime.temperature');
  if (temperature != null) fieldSetters.setTemperature(Number(temperature));

  const maxRetries = getNestedValue(cfg, 'runtime.max_retries');
  if (maxRetries != null) fieldSetters.setMaxRetries(Number(maxRetries));

  const timeoutSec = getNestedValue(cfg, 'runtime.timeout_sec');
  if (timeoutSec != null) fieldSetters.setTimeoutSec(Number(timeoutSec));

  const maxCompletionTokens = getNestedValue(cfg, 'runtime.max_completion_tokens');
  if (maxCompletionTokens != null) fieldSetters.setMaxCompletionTokens(Number(maxCompletionTokens));

  // --- API Keys ---
  const apiKeyId = getNestedValue(cfg, 'api_key_id');
  if (apiKeyId != null && apiKeyId !== '') fieldSetters.setApiKeyId(String(apiKeyId));

  const apiKeyIds = getNestedValue(cfg, 'api_key_ids');
  if (apiKeyIds != null && Array.isArray(apiKeyIds)) fieldSetters.setApiKeyIds(apiKeyIds as string[]);

  // --- Prompt / Protection / Validation ---
  const promptProfileName = getNestedValue(cfg, 'prompt.profile_name');
  if (promptProfileName != null && promptProfileName !== '') fieldSetters.setPromptProfileName(String(promptProfileName));

  // Prompt template overrides (apply if present in profile)
  const batchSystemPrompt = getNestedValue(cfg, 'prompt.batch_system_prompt');
  if (batchSystemPrompt != null && batchSystemPrompt !== '') fieldSetters.setBatchSystemPrompt(String(batchSystemPrompt));

  const batchUserTemplate = getNestedValue(cfg, 'prompt.batch_user_template');
  if (batchUserTemplate != null && batchUserTemplate !== '') fieldSetters.setBatchUserTemplate(String(batchUserTemplate));

  const singleSystemPrompt = getNestedValue(cfg, 'prompt.single_system_prompt');
  if (singleSystemPrompt != null && singleSystemPrompt !== '') fieldSetters.setSingleSystemPrompt(String(singleSystemPrompt));

  const singleUserTemplate = getNestedValue(cfg, 'prompt.single_user_template');
  if (singleUserTemplate != null && singleUserTemplate !== '') fieldSetters.setSingleUserTemplate(String(singleUserTemplate));

  const logPrompts = getNestedValue(cfg, 'prompt.log_prompts');
  if (logPrompts != null) fieldSetters.setLogPrompts(Boolean(logPrompts));

  const protectionStrategy = getNestedValue(cfg, 'protection.strategy');
  if (protectionStrategy != null && protectionStrategy !== '') fieldSetters.setProtectionStrategy(String(protectionStrategy));

  const ruleSetIds = getNestedValue(cfg, 'protection.rule_set_ids');
  if (ruleSetIds != null && Array.isArray(ruleSetIds)) fieldSetters.setRuleSetIds(ruleSetIds as string[]);

  const validatorName = getNestedValue(cfg, 'validation.validator_name');
  if (validatorName != null && validatorName !== '') fieldSetters.setValidatorName(String(validatorName));

  // --- Output fields ---
  const outputDir = getNestedValue(cfg, 'output.output_dir') ?? getNestedValue(cfg, 'output.dir');
  if (outputDir != null && outputDir !== '') fieldSetters.setOutputDir(String(outputDir));

  const filenameSuffix = getNestedValue(cfg, 'output.filename_suffix');
  if (filenameSuffix != null && filenameSuffix !== '') fieldSetters.setOutputFilenameSuffix(String(filenameSuffix));

  const preserveRelativePath = getNestedValue(cfg, 'output.preserve_relative_path');
  if (preserveRelativePath != null) fieldSetters.setOutputPreserveRelativePath(Boolean(preserveRelativePath));

  const overwrite = getNestedValue(cfg, 'output.overwrite');
  if (overwrite != null) fieldSetters.setOutputOverwrite(Boolean(overwrite));

  const backup = getNestedValue(cfg, 'output.backup');
  if (backup != null) fieldSetters.setOutputBackup(Boolean(backup));

  // --- Game / file_handler ---
  if (profileConfig.game || profileConfig.file_handler) {
    setGameConfig(prev => ({
      ...(prev || {}),
      ...(profileConfig.game ? { game: profileConfig.game } : {}),
      ...(profileConfig.file_handler ? { file_handler: profileConfig.file_handler } : {}),
    }));
  }
}
