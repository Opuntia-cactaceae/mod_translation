import type { TranslationProfile, CreateProfileRequest, UpdateProfileRequest } from "../api/types";
import { getNestedValue } from "./configFieldRegistry";
import { BUILTIN_RULE_SET_ID } from "../constants";

/* ------------------------------------------------------------------ */
/*  Domain model                                                       */
/* ------------------------------------------------------------------ */

export interface ProfileModel {
  id: string;
  name: string;
  description: string;
  game: string;
  fileHandler: string | null;
  config: Record<string, unknown>;
  isSystem: boolean;
  srcLang: string;
  dstLang: string;
  createdAt?: string;
  updatedAt?: string;
}

/* ------------------------------------------------------------------ */
/*  DTO → Domain mapper                                                */
/* ------------------------------------------------------------------ */

export function mapProfile(dto: TranslationProfile): ProfileModel {
  const cfg = dto.config ?? {};
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description ?? "",
    game: dto.game,
    fileHandler: dto.file_handler ?? null,
    config: cfg,
    isSystem: dto.is_system,
    srcLang: (cfg['src_lang'] as string | undefined) ?? "",
    dstLang: (cfg['dst_lang'] as string | undefined) ?? "",
    createdAt: dto.created_at || undefined,
    updatedAt: dto.updated_at || undefined,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function isReadonlyProfile(profile: ProfileModel): boolean {
  return profile.isSystem;
}

export function canEditProfile(profile: ProfileModel): boolean {
  return !profile.isSystem;
}

export function canDeleteProfile(profile: ProfileModel): boolean {
  return !profile.isSystem;
}

/* ------------------------------------------------------------------ */
/*  Deduplication helpers                                              */
/* ------------------------------------------------------------------ */

/**
 * Build an **id-based** dedup key for a TranslationProfile DTO.
 * All profiles with the same id are considered the same entry.
 */
function idDedupKey(profile: TranslationProfile): string {
  return profile.id ? `id:${profile.id}` : `no-id:${profile.is_system ?? false}`;
}

/**
 * Build a **content-based** dedup key for a **user** TranslationProfile DTO.
 * Two user profiles with the same name/game/file_handler/language pair
 * are considered duplicates even if they have different UUIDs.
 *
 * For system profiles, returns ``null`` so they are never content-deduped.
 */
function contentDedupKey(profile: TranslationProfile): string | null {
  if (profile.is_system) return null;
  const cfg = profile.config ?? {};
  const srcLang = (cfg['src_lang'] as string | undefined) ?? "";
  const dstLang = (cfg['dst_lang'] as string | undefined) ?? "";
  return `user:${profile.name}|${profile.game}|${profile.file_handler ?? ""}|${srcLang}|${dstLang}`;
}

/**
 * Deduplicate an array of TranslationProfile DTOs.
 *
 * Uses **two passes**:
 * 1. Id-based dedup — profiles with the same id are merged (last wins).
 * 2. Content-based dedup — for **user** profiles, those with the same
 *    ``name`` / ``game`` / ``file_handler`` / ``src_lang`` / ``dst_lang``
 *    are merged (last wins).  System profiles are never content-deduped.
 */
export function deduplicateProfiles(profiles: TranslationProfile[]): TranslationProfile[] {
  // Pass 1: id-based dedup
  const byId = new Map<string, TranslationProfile>();
  for (const p of profiles) {
    byId.set(idDedupKey(p), p);
  }
  // Pass 2: content-based dedup for user profiles
  const seen = new Map<string, TranslationProfile>();
  for (const p of byId.values()) {
    const ck = contentDedupKey(p);
    if (ck !== null) {
      seen.set(ck, p);
    } else {
      // System / no-id profiles: use id key as dedup key
      seen.set(idDedupKey(p), p);
    }
  }
  return Array.from(seen.values());
}

/**
 * Append a profile to the list without creating duplicates.
 *
 * Checks both **id-based** and **content-based** dedup:
 * - If the profile already exists by id, replaces it.
 * - For user profiles, if an equivalent profile (by name/game/handler/language)
 *   already exists, replaces it.
 * - Otherwise appends.
 */
export function appendProfileUnique(
  profiles: TranslationProfile[],
  profile: TranslationProfile,
): TranslationProfile[] {
  // Try id-based match first
  const id = idDedupKey(profile);
  const idIdx = profiles.findIndex(p => idDedupKey(p) === id);
  if (idIdx >= 0) {
    const next = [...profiles];
    next[idIdx] = profile;
    return next;
  }
  // Try content-based match for user profiles
  const ck = contentDedupKey(profile);
  if (ck !== null) {
    const ckIdx = profiles.findIndex(p => contentDedupKey(p) === ck);
    if (ckIdx >= 0) {
      const next = [...profiles];
      next[ckIdx] = profile;
      return next;
    }
  }
  // No duplicate found — append
  return [...profiles, profile];
}

/**
 * Remove a profile by its dedup key.
 */
export function removeProfile(
  profiles: TranslationProfile[],
  profileId: string,
): TranslationProfile[] {
  return profiles.filter(p => p.id !== profileId);
}

/* ------------------------------------------------------------------ */
/*  ProfileFormModel — typed form state (camelCase, no raw API keys)   */
/* ------------------------------------------------------------------ */

export interface ProfileFormModel {
  name: string;
  description: string;
  game: string;
  fileHandler: string | null;
  srcLang: string;
  dstLang: string;
  provider: string;
  model: string;
  temperature: number;
  batchSize: number;
  useCache: boolean;
  // API key fields (Task 3)
  apiKeyId: string;
  apiKeyIds: string[];
  // Runtime advanced fields (Task 4)
  maxRetries: number;
  timeoutSec: number;
  maxCompletionTokens: number;
  // Raw responses (Task 5)
  saveRawResponses: boolean;
  promptProfileName: string;
  // Prompt template fields (Parts 3-5)
  batchSystemPrompt: string;
  batchUserTemplate: string;
  singleSystemPrompt: string;
  singleUserTemplate: string;
  logPrompts: boolean;
  protectionStrategy: string;
  ruleSetIds: string[];
  validatorName: string;
  outputDir: string;
  outputRootDir: string;
  outputFilenameSuffix: string;
  outputPreserveRelativePath: boolean;
  outputOverwrite: boolean;
  outputBackup: boolean;
}

export const DEFAULT_PROFILE_FORM: ProfileFormModel = {
  name: "",
  description: "",
  game: "stellaris",
  fileHandler: null,
  srcLang: "en",
  dstLang: "ru",
  provider: "",
  model: "",
  temperature: 0,
  batchSize: 10,
  useCache: true,
  apiKeyId: "",
  apiKeyIds: [],
  maxRetries: 3,
  timeoutSec: 0,
  maxCompletionTokens: 0,
  saveRawResponses: false,
  promptProfileName: "",
  batchSystemPrompt: "",
  batchUserTemplate: "",
  singleSystemPrompt: "",
  singleUserTemplate: "",
  logPrompts: false,
  protectionStrategy: "",
  ruleSetIds: [BUILTIN_RULE_SET_ID],
  validatorName: "",
  outputDir: "",
  outputRootDir: "",
  outputFilenameSuffix: "_translated",
  outputPreserveRelativePath: true,
  outputOverwrite: false,
  outputBackup: true,
};

/* ------------------------------------------------------------------ */
/*  profileToForm — domain model / raw config → typed form             */
/*  Uses configFieldRegistry.getNestedValue for all config reads.      */
/* ------------------------------------------------------------------ */

export function profileToForm(
  profile?: ProfileModel,
  initialConfig?: Record<string, unknown>,
): ProfileFormModel {
  const cfg = profile?.config ?? {};
  const src = initialConfig ?? cfg;

  return {
    name: profile?.name ?? DEFAULT_PROFILE_FORM.name,
    description: profile?.description ?? DEFAULT_PROFILE_FORM.description,
    game: profile?.game ?? DEFAULT_PROFILE_FORM.game,
    fileHandler:
      (profile?.fileHandler as string) ??
      (getNestedValue(src, "file_handler") as string) ??
      DEFAULT_PROFILE_FORM.fileHandler,
    srcLang:
      (getNestedValue(src, "src_lang") as string) ?? DEFAULT_PROFILE_FORM.srcLang,
    dstLang:
      (getNestedValue(src, "dst_lang") as string) ?? DEFAULT_PROFILE_FORM.dstLang,
    provider:
      (getNestedValue(src, "runtime.provider") as string) ??
      DEFAULT_PROFILE_FORM.provider,
    model:
      (getNestedValue(src, "runtime.model") as string) ??
      DEFAULT_PROFILE_FORM.model,
    temperature:
      (getNestedValue(src, "runtime.temperature") as number) ??
      DEFAULT_PROFILE_FORM.temperature,
    batchSize:
      (getNestedValue(src, "batch_size") as number) ??
      DEFAULT_PROFILE_FORM.batchSize,
    useCache:
      (getNestedValue(src, "use_cache") as boolean) ??
      DEFAULT_PROFILE_FORM.useCache,
    apiKeyId:
      (getNestedValue(src, "runtime.api_key_id") as string) ??
      (getNestedValue(src, "api_key_id") as string) ??
      DEFAULT_PROFILE_FORM.apiKeyId,
    apiKeyIds:
      (getNestedValue(src, "runtime.api_key_ids") as string[]) ??
      (getNestedValue(src, "api_key_ids") as string[]) ??
      DEFAULT_PROFILE_FORM.apiKeyIds,
    maxRetries:
      (getNestedValue(src, "runtime.max_retries") as number) ??
      DEFAULT_PROFILE_FORM.maxRetries,
    timeoutSec:
      (getNestedValue(src, "runtime.timeout_sec") as number) ??
      DEFAULT_PROFILE_FORM.timeoutSec,
    maxCompletionTokens:
      (getNestedValue(src, "runtime.max_completion_tokens") as number) ??
      DEFAULT_PROFILE_FORM.maxCompletionTokens,
    saveRawResponses:
      (getNestedValue(src, "save_raw_responses") as boolean) ??
      DEFAULT_PROFILE_FORM.saveRawResponses,
    promptProfileName:
      (getNestedValue(src, "prompt.profile_name") as string) ??
      DEFAULT_PROFILE_FORM.promptProfileName,
    batchSystemPrompt:
      (getNestedValue(src, "prompt.batch_system_prompt") as string) ??
      DEFAULT_PROFILE_FORM.batchSystemPrompt,
    batchUserTemplate:
      (getNestedValue(src, "prompt.batch_user_template") as string) ??
      DEFAULT_PROFILE_FORM.batchUserTemplate,
    singleSystemPrompt:
      (getNestedValue(src, "prompt.single_system_prompt") as string) ??
      DEFAULT_PROFILE_FORM.singleSystemPrompt,
    singleUserTemplate:
      (getNestedValue(src, "prompt.single_user_template") as string) ??
      DEFAULT_PROFILE_FORM.singleUserTemplate,
    logPrompts:
      (getNestedValue(src, "prompt.log_prompts") as boolean) ??
      DEFAULT_PROFILE_FORM.logPrompts,
    protectionStrategy:
      (getNestedValue(src, "protection.strategy") as string) ??
      DEFAULT_PROFILE_FORM.protectionStrategy,
    ruleSetIds:
      (getNestedValue(src, "protection.rule_set_ids") as string[]) ??
      DEFAULT_PROFILE_FORM.ruleSetIds,
    validatorName:
      (getNestedValue(src, "validation.validator_name") as string) ??
      DEFAULT_PROFILE_FORM.validatorName,
    outputDir:
      (getNestedValue(src, "output.output_dir") as string) ??
      (getNestedValue(src, "output.dir") as string) ??
      DEFAULT_PROFILE_FORM.outputDir,
    outputRootDir:
      (getNestedValue(src, "output.root_dir") as string) ??
      DEFAULT_PROFILE_FORM.outputRootDir,
    outputFilenameSuffix:
      (getNestedValue(src, "output.filename_suffix") as string) ??
      DEFAULT_PROFILE_FORM.outputFilenameSuffix,
    outputPreserveRelativePath:
      (getNestedValue(src, "output.preserve_relative_path") as boolean) ??
      DEFAULT_PROFILE_FORM.outputPreserveRelativePath,
    outputOverwrite:
      (getNestedValue(src, "output.overwrite") as boolean) ??
      DEFAULT_PROFILE_FORM.outputOverwrite,
    outputBackup:
      (getNestedValue(src, "output.backup") as boolean) ??
      DEFAULT_PROFILE_FORM.outputBackup,
  };
}

/* ------------------------------------------------------------------ */
/*  formToProfileConfig — typed form → API-compatible config dict      */
/*  (snake_case keys exist only here)                                  */
/* ------------------------------------------------------------------ */

export function formToProfileConfig(
  form: ProfileFormModel,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  // Canonical key: output.output_dir (Task 2)
  if (form.outputDir) output.output_dir = form.outputDir;
  if (form.outputRootDir) output.root_dir = form.outputRootDir;
  output.filename_suffix = form.outputFilenameSuffix;
  output.preserve_relative_path = form.outputPreserveRelativePath;
  output.overwrite = form.outputOverwrite;
  output.backup = form.outputBackup;

  const runtime: Record<string, unknown> = {
    provider: form.provider,
    model: form.model,
    temperature: form.temperature,
  };
  // API key fields (Task 3)
  if (form.apiKeyId) runtime.api_key_id = form.apiKeyId;
  if (form.apiKeyIds && form.apiKeyIds.length > 0) runtime.api_key_ids = form.apiKeyIds;
  // Runtime advanced fields (Task 4) — write always to preserve explicit 0
  runtime.max_retries = form.maxRetries;
  runtime.timeout_sec = form.timeoutSec;
  runtime.max_completion_tokens = form.maxCompletionTokens;

  // Build prompt section — write log_prompts always if explicitly set (Task 6)
  const prompt: Record<string, unknown> = {
    profile_name: form.promptProfileName,
  };
  if (form.batchSystemPrompt) prompt.batch_system_prompt = form.batchSystemPrompt;
  if (form.batchUserTemplate) prompt.batch_user_template = form.batchUserTemplate;
  if (form.singleSystemPrompt) prompt.single_system_prompt = form.singleSystemPrompt;
  if (form.singleUserTemplate) prompt.single_user_template = form.singleUserTemplate;
  // Always write log_prompts so false can override a global default
  prompt.log_prompts = form.logPrompts;

  return {
    src_lang: form.srcLang,
    dst_lang: form.dstLang,
    batch_size: form.batchSize,
    use_cache: form.useCache,
    save_raw_responses: form.saveRawResponses,
    runtime,
    prompt,
    protection: {
      strategy: form.protectionStrategy,
      rule_set_ids: form.ruleSetIds.length > 0 ? form.ruleSetIds : undefined,
    },
    validation: {
      validator_name: form.validatorName,
    },
    output,
  };
}

/* ------------------------------------------------------------------ */
/*  formToCreateProfilePayload — typed form → CreateProfileRequest     */
/* ------------------------------------------------------------------ */

export function formToCreateProfilePayload(
  form: ProfileFormModel,
): CreateProfileRequest {
  return {
    name: form.name,
    description: form.description || undefined,
    game: form.game,
    file_handler: form.fileHandler || undefined,
    config: formToProfileConfig(form),
  };
}

/* ------------------------------------------------------------------ */
/*  formToUpdateProfilePayload — typed form → UpdateProfileRequest     */
/* ------------------------------------------------------------------ */

export function formToUpdateProfilePayload(
  form: ProfileFormModel,
): UpdateProfileRequest {
  return {
    name: form.name,
    description: form.description || undefined,
    game: form.game,
    file_handler: form.fileHandler || undefined,
    config: formToProfileConfig(form),
  };
}
