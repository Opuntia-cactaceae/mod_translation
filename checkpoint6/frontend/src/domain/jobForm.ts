/* ------------------------------------------------------------------ */
/*  Create Job Form Model — typed form state for the create-job form   */
/* ------------------------------------------------------------------ */

export interface CreateJobFormModel {
  filePaths: string;
  filePathList: string[];
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
  promptOverrideEnabled: boolean;
  batchSystemPrompt: string;
  batchUserTemplate: string;
  singleSystemPrompt: string;
  singleUserTemplate: string;
  logPrompts: boolean;
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
