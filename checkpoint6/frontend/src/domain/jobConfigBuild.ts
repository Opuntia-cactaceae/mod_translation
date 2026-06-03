/* ------------------------------------------------------------------ */
/*  Job config assembly — pure function (no React dependencies)         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BuildJobConfigInput {
  srcLang: string;
  dstLang: string;
  batchSize: number;
  useCache: boolean;
  provider: string;
  model: string;
  apiKeyId: string;
  apiKeyIds?: string[];
  // --- Advanced config ---
  promptProfileName?: string;
  // Prompt template overrides (Parts 3-5)
  batchSystemPrompt?: string;
  batchUserTemplate?: string;
  singleSystemPrompt?: string;
  singleUserTemplate?: string;
  logPrompts?: boolean;
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
  selectedProfileId?: string;
  gameConfig?: Record<string, unknown> | null;
}

/* ------------------------------------------------------------------ */
/*  Config assembly                                                    */
/* ------------------------------------------------------------------ */

/**
 * Assembles the job config object from form values and profile/game config.
 * Maps frontend camelCase params to backend snake_case keys.
 */
export function buildJobConfig(input: BuildJobConfigInput): Record<string, unknown> {
  const hasApiKeyIds = 'apiKeyIds' in input && Array.isArray(input.apiKeyIds);

  let apiKeyId: string | undefined;
  let apiKeyIds: string[] | undefined;

  if (hasApiKeyIds) {
    // New multi-key flow: apiKeyIds is always present (may be empty)
    apiKeyIds = input.apiKeyIds!.length > 0 ? input.apiKeyIds : undefined;
    apiKeyId = apiKeyIds ? apiKeyIds[0] : (input.apiKeyId || undefined);
  } else {
    // Backward compat: single apiKeyId only
    apiKeyId = input.apiKeyId || undefined;
    apiKeyIds = input.apiKeyId ? [input.apiKeyId] : undefined;
  }

  // Build nested runtime config with only non-empty values
  const runtime: Record<string, unknown> = {};
  if (input.provider) runtime.provider = input.provider;
  if (input.model) runtime.model = input.model;
  if (input.temperature != null && input.temperature !== 0) runtime.temperature = input.temperature;
  // Preserve 0 for maxRetries (means "no retries") but skip null/undefined
  if (input.maxRetries != null && input.maxRetries >= 0) runtime.max_retries = input.maxRetries;
  if (input.timeoutSec != null && input.timeoutSec > 0) runtime.timeout_sec = input.timeoutSec;
  if (input.maxCompletionTokens != null && input.maxCompletionTokens > 0) runtime.max_completion_tokens = input.maxCompletionTokens;

  // Build nested prompt config
  const prompt: Record<string, unknown> = {};
  if (input.promptProfileName) prompt.profile_name = input.promptProfileName;
  if (input.batchSystemPrompt) prompt.batch_system_prompt = input.batchSystemPrompt;
  if (input.batchUserTemplate) prompt.batch_user_template = input.batchUserTemplate;
  if (input.singleSystemPrompt) prompt.single_system_prompt = input.singleSystemPrompt;
  if (input.singleUserTemplate) prompt.single_user_template = input.singleUserTemplate;
  // Always write log_prompts so false can override a global default (Task 6)
  if (input.logPrompts != null) prompt.log_prompts = input.logPrompts;

  // Build nested protection config
  const protection: Record<string, unknown> = {};
  if (input.protectionStrategy) protection.strategy = input.protectionStrategy;
  if (input.ruleSetIds && input.ruleSetIds.length > 0) protection.rule_set_ids = input.ruleSetIds;

  // Build nested validation config
  const validation: Record<string, unknown> = {};
  if (input.validatorName) validation.validator_name = input.validatorName;

  // Build nested output config
  const output: Record<string, unknown> = {};
  if (input.outputDir) output.output_dir = input.outputDir;
  if (input.outputFilenameSuffix != null && input.outputFilenameSuffix !== '') output.filename_suffix = input.outputFilenameSuffix;
  if (input.outputPreserveRelativePath != null) output.preserve_relative_path = input.outputPreserveRelativePath;
  if (input.outputOverwrite != null) output.overwrite = input.outputOverwrite;
  if (input.outputBackup != null) output.backup = input.outputBackup;

  const result: Record<string, unknown> = {
    src_lang: input.srcLang,
    dst_lang: input.dstLang,
    batch_size: input.batchSize,
    use_cache: input.useCache,
    save_raw_responses: input.saveRawResponses,
    provider: input.provider || undefined,
    model: input.model || undefined,
    api_key_id: apiKeyId,
    ...(apiKeyIds ? { api_key_ids: apiKeyIds } : {}),
    ...(Object.keys(runtime).length > 0 ? { runtime } : {}),
    ...(Object.keys(prompt).length > 0 ? { prompt } : {}),
    ...(Object.keys(protection).length > 0 ? { protection } : {}),
    ...(Object.keys(validation).length > 0 ? { validation } : {}),
    ...(Object.keys(output).length > 0 ? { output } : {}),
    ...(input.gameConfig ?? {}),
    ...(input.selectedProfileId ? { translation_profile_id: input.selectedProfileId } : {}),
  };

  return result;
}
