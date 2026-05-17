/* ------------------------------------------------------------------ */
/*  Create-job validation — pure functions (no React dependencies)      */
/* ------------------------------------------------------------------ */

import type { TranslationPreviewModel } from "./translation";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CreateJobValidationInput {
  filePaths: string;
  srcLang: string;
  dstLang: string;
  provider: string;
  model: string;
  apiKeyIds: string[];
  /** API keys available for the selected provider */
  availableKeysForProvider: number;
  // --- Advanced config validation ---
  promptProfileName?: string;
  protectionStrategy?: string;
  validatorName?: string;
  temperature?: number;
  maxRetries?: number;
  timeoutSec?: number;
  maxCompletionTokens?: number;
}

/* ------------------------------------------------------------------ */
/*  Validation functions                                               */
/* ------------------------------------------------------------------ */

export function getCreateJobProblems(input: CreateJobValidationInput): string[] {
  const problems: string[] = [];
  const paths = input.filePaths.split("\n").map((s) => s.trim()).filter(Boolean);
  if (paths.length === 0) {
    problems.push("No files selected");
  }
  if (!input.srcLang.trim()) {
    problems.push("Source language is empty");
  }
  if (!input.dstLang.trim()) {
    problems.push("Target language is empty");
  }
  if (
    input.srcLang.trim() &&
    input.dstLang.trim() &&
    input.srcLang.trim() === input.dstLang.trim()
  ) {
    problems.push("Source and target languages must be different");
  }
  if (!input.provider.trim()) {
    problems.push("Provider is required");
  }
  if (!input.model.trim()) {
    problems.push("Model is required");
  }
  if (input.provider.trim() && input.availableKeysForProvider === 0) {
    problems.push("No API keys configured for provider");
  }
  if (input.provider.trim() && input.availableKeysForProvider > 0 && input.apiKeyIds.length === 0) {
    problems.push("No API key selected");
  }

  // --- Advanced config validation ---
  if (!input.promptProfileName?.trim()) {
    problems.push("Prompt profile is required");
  }
  if (!input.protectionStrategy?.trim()) {
    problems.push("Protection strategy is required");
  }
  if (!input.validatorName?.trim()) {
    problems.push("Validator is required");
  }
  if (input.maxRetries != null && input.maxRetries < 0) {
    problems.push("Max retries must be >= 0");
  }
  if (input.timeoutSec != null && input.timeoutSec < 0) {
    problems.push("Timeout must not be negative (0 = provider default)");
  }
  if (input.maxCompletionTokens != null && input.maxCompletionTokens < 0) {
    problems.push("Max completion tokens must not be negative (0 = no limit)");
  }

  return problems;
}

export function canCreateJob(input: CreateJobValidationInput): boolean {
  return getCreateJobProblems(input).length === 0;
}

export function canConfirmPreview(previewData: TranslationPreviewModel | null): boolean {
  return previewData !== null && previewData.totalUnits > 0 && !previewData.hasBlockingErrors;
}

/* ------------------------------------------------------------------ */
/*  Prompt template validation (Parts 5-6)                              */
/* ------------------------------------------------------------------ */

const KNOWN_PLACEHOLDERS = new Set([
  "{text}", "{texts}", "{src_lang}", "{dst_lang}",
  "{src_lang_code}", "{dst_lang_code}",
]);

const PLACEHOLDER_RE = /\{(\w+)\}/g;

/**
 * Validate a batch user template — must contain {texts}.
 */
export function validateBatchUserTemplate(
  template: string,
  overrideEnabled: boolean,
): string | null {
  if (!overrideEnabled) return null;
  if (!template.trim()) return "Batch user template must not be empty";
  if (!template.includes("{texts}")) return "Batch user template must contain {texts}";
  const unknown = findUnknownPlaceholders(template);
  if (unknown.length > 0) return `Unknown placeholder(s): ${unknown.join(", ")}`;
  return null;
}

/**
 * Validate a single user template — must contain {text}.
 */
export function validateSingleUserTemplate(
  template: string,
  overrideEnabled: boolean,
): string | null {
  if (!overrideEnabled) return null;
  if (!template.trim()) return "Single user template must not be empty";
  if (!template.includes("{text}")) return "Single user template must contain {text}";
  const unknown = findUnknownPlaceholders(template);
  if (unknown.length > 0) return `Unknown placeholder(s): ${unknown.join(", ")}`;
  return null;
}

/**
 * Check any template for unknown placeholders.
 */
export function validatePromptTemplate(
  template: string,
  fieldLabel: string,
): string | null {
  if (!template.trim()) return null; // empty is allowed (falls back to profile)
  const unknown = findUnknownPlaceholders(template);
  if (unknown.length > 0) return `${fieldLabel}: unknown placeholder(s): ${unknown.join(", ")}`;
  return null;
}

function findUnknownPlaceholders(template: string): string[] {
  const found: string[] = [];
  let match: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((match = PLACEHOLDER_RE.exec(template)) !== null) {
    const full = `{${match[1]}}`;
    if (!KNOWN_PLACEHOLDERS.has(full)) {
      found.push(full);
    }
  }
  return [...new Set(found)];
}
