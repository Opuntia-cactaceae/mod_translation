/* ------------------------------------------------------------------ */
/*  Pure helpers for the create-job form                                */
/*  Extracted from useCreateJobForm.ts — no React dependencies          */
/* ------------------------------------------------------------------ */

import type { CreateJobFormModel } from './jobForm';
import { getNestedValue } from './configFieldRegistry';

/**
 * Detect a source language code from a filename like `l_english.yml`.
 * Returns the short code (e.g. `en`) or `null` if no match.
 */
export function detectSourceLangFromFilename(path: string): string | null {
  const match = path.match(/l_(\w+)\.yml$/);
  if (!match) return null;
  const langMap: Record<string, string> = {
    english: 'en',
    french: 'fr',
    german: 'de',
    russian: 'ru',
    spanish: 'es',
    polish: 'pl',
    japanese: 'ja',
    korean: 'ko',
    simp_chinese: 'zh',
    brazilian: 'pt-BR',
    portuguese: 'pt',
    italian: 'it',
    dutch: 'nl',
    swedish: 'sv',
    czech: 'cs',
    hungarian: 'hu',
    turkish: 'tr',
    arabic: 'ar',
  };
  return langMap[match[1]] || null;
}

/**
 * Detect source language from a list of paths.
 * Returns the detected language only if all paths agree on the same language.
 */
export function detectSourceLangFromPaths(paths: string[]): string | null {
  const detected = new Set(
    paths.map(p => detectSourceLangFromFilename(p)).filter(Boolean) as string[],
  );
  return detected.size === 1 ? Array.from(detected)[0] : null;
}

/**
 * Split a multi-line text into trimmed, non-empty path strings.
 */
export function normalizePathLines(text: string): string[] {
  return text.split('\n').map(s => s.trim()).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/*  applyProfileToJobForm — extract profile config into form fields    */
/*  Uses configFieldRegistry.getNestedValue for config reads.          */
/* ------------------------------------------------------------------ */

/**
 * Extract values from a profile config into a partial CreateJobFormModel.
 * Does NOT touch file paths, file lists, or mod selection.
 */
export function applyProfileToJobForm(
  profileConfig: Record<string, unknown>,
): Partial<CreateJobFormModel> {
  const partial: Partial<CreateJobFormModel> = {};

  const srcLang = getNestedValue(profileConfig, 'src_lang');
  if (srcLang) partial.srcLang = String(srcLang);

  const dstLang = getNestedValue(profileConfig, 'dst_lang');
  if (dstLang) partial.dstLang = String(dstLang);

  const batchSize = getNestedValue(profileConfig, 'batch_size');
  if (batchSize != null) partial.batchSize = Number(batchSize);

  const useCache = getNestedValue(profileConfig, 'use_cache');
  if (useCache != null) partial.useCache = Boolean(useCache);

  // saveRawResponses (Task 5)
  const saveRawResponses = getNestedValue(profileConfig, 'save_raw_responses');
  if (saveRawResponses != null) partial.saveRawResponses = Boolean(saveRawResponses);

  const provider = getNestedValue(profileConfig, 'runtime.provider');
  if (provider) partial.provider = String(provider);

  const model = getNestedValue(profileConfig, 'runtime.model');
  if (model) partial.model = String(model);

  const temperature = getNestedValue(profileConfig, 'runtime.temperature');
  if (temperature != null) partial.temperature = Number(temperature);

  const maxRetries = getNestedValue(profileConfig, 'runtime.max_retries');
  if (maxRetries != null) partial.maxRetries = Number(maxRetries);

  const timeoutSec = getNestedValue(profileConfig, 'runtime.timeout_sec');
  if (timeoutSec != null) partial.timeoutSec = Number(timeoutSec);

  const maxCompletionTokens = getNestedValue(profileConfig, 'runtime.max_completion_tokens');
  if (maxCompletionTokens != null) partial.maxCompletionTokens = Number(maxCompletionTokens);

  const apiKeyId = getNestedValue(profileConfig, 'api_key_id');
  if (apiKeyId != null && apiKeyId !== '') partial.apiKeyId = String(apiKeyId);

  const apiKeyIds = getNestedValue(profileConfig, 'api_key_ids');
  if (apiKeyIds != null && Array.isArray(apiKeyIds)) partial.apiKeyIds = apiKeyIds as string[];

  const promptProfileName = getNestedValue(profileConfig, 'prompt.profile_name');
  if (promptProfileName) partial.promptProfileName = String(promptProfileName);

  // Prompt template overrides (read from profile so they can be applied)
  const batchSystemPrompt = getNestedValue(profileConfig, 'prompt.batch_system_prompt');
  if (batchSystemPrompt) partial.batchSystemPrompt = String(batchSystemPrompt);

  const batchUserTemplate = getNestedValue(profileConfig, 'prompt.batch_user_template');
  if (batchUserTemplate) partial.batchUserTemplate = String(batchUserTemplate);

  const singleSystemPrompt = getNestedValue(profileConfig, 'prompt.single_system_prompt');
  if (singleSystemPrompt) partial.singleSystemPrompt = String(singleSystemPrompt);

  const singleUserTemplate = getNestedValue(profileConfig, 'prompt.single_user_template');
  if (singleUserTemplate) partial.singleUserTemplate = String(singleUserTemplate);

  // logPrompts — read explicitly to allow false override
  const logPrompts = getNestedValue(profileConfig, 'prompt.log_prompts');
  if (logPrompts != null) partial.logPrompts = Boolean(logPrompts);

  const protectionStrategy = getNestedValue(profileConfig, 'protection.strategy');
  if (protectionStrategy) partial.protectionStrategy = String(protectionStrategy);

  const validatorName = getNestedValue(profileConfig, 'validation.validator_name');
  if (validatorName) partial.validatorName = String(validatorName);

  // outputDir: try canonical output.output_dir first, then legacy output.dir
  const outputDir = getNestedValue(profileConfig, 'output.output_dir') ?? getNestedValue(profileConfig, 'output.dir');
  if (outputDir) partial.outputDir = String(outputDir);

  const filenameSuffix = getNestedValue(profileConfig, 'output.filename_suffix');
  if (filenameSuffix != null && filenameSuffix !== '') partial.outputFilenameSuffix = String(filenameSuffix);

  const preservePath = getNestedValue(profileConfig, 'output.preserve_relative_path');
  if (preservePath != null) partial.outputPreserveRelativePath = Boolean(preservePath);

  const overwrite = getNestedValue(profileConfig, 'output.overwrite');
  if (overwrite != null) partial.outputOverwrite = Boolean(overwrite);

  const backup = getNestedValue(profileConfig, 'output.backup');
  if (backup != null) partial.outputBackup = Boolean(backup);

  return partial;
}
