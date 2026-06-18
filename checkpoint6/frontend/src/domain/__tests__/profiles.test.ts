import { describe, it, expect } from 'vitest';
import type { TranslationProfile } from '../../api/types';
import {
  mapProfile,
  profileToForm,
  formToProfileConfig,
  DEFAULT_PROFILE_FORM,
  deduplicateProfiles,
  appendProfileUnique,
  removeProfile,
  isReadonlyProfile,
  canEditProfile,
  canDeleteProfile,
  type ProfileFormModel,
} from '../profiles';

/* ================================================================== */
/*  Fixtures                                                            */
/* ================================================================== */

function makeProfile(overrides: Partial<TranslationProfile> = {}): TranslationProfile {
  return {
    id: 'p1',
    name: 'Test Profile',
    description: 'A test profile',
    game: 'stellaris',
    file_handler: 'stellaris_localisation',
    config: { src_lang: 'en', dst_lang: 'ru' },
    is_system: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

const SYSTEM_PROFILE: TranslationProfile = makeProfile({
  id: 'sys1',
  name: 'System Profile',
  is_system: true,
});

const USER_PROFILE_1: TranslationProfile = makeProfile({
  id: 'u1',
  name: 'User Profile 1',
});

const USER_PROFILE_2: TranslationProfile = makeProfile({
  id: 'u2',
  name: 'User Profile 2',
});

/* ================================================================== */
/*  mapProfile                                                         */
/* ================================================================== */

describe('mapProfile', () => {
  it('maps all fields correctly', () => {
    const dto = makeProfile({
      id: 'test-id',
      name: 'My Profile',
      description: 'My description',
      game: 'generic',
      file_handler: 'json',
      config: { src_lang: 'fr', dst_lang: 'de' },
      is_system: true,
    });
    const model = mapProfile(dto);
    expect(model.id).toBe('test-id');
    expect(model.name).toBe('My Profile');
    expect(model.description).toBe('My description');
    expect(model.game).toBe('generic');
    expect(model.fileHandler).toBe('json');
    expect(model.isSystem).toBe(true);
    expect(model.srcLang).toBe('fr');
    expect(model.dstLang).toBe('de');
  });

  it('extracts src_lang/dst_lang from config', () => {
    const dto = makeProfile({ config: { src_lang: 'ja', dst_lang: 'ko' } });
    const model = mapProfile(dto);
    expect(model.srcLang).toBe('ja');
    expect(model.dstLang).toBe('ko');
  });

  it('returns empty strings for missing lang config', () => {
    const dto = makeProfile({ config: {} });
    const model = mapProfile(dto);
    expect(model.srcLang).toBe('');
    expect(model.dstLang).toBe('');
  });
});

/* ================================================================== */
/*  isReadonlyProfile / canEditProfile / canDeleteProfile              */
/* ================================================================== */

describe('profile permission helpers', () => {
  it('marks system profile as readonly', () => {
    const model = mapProfile(SYSTEM_PROFILE);
    expect(isReadonlyProfile(model)).toBe(true);
    expect(canEditProfile(model)).toBe(false);
    expect(canDeleteProfile(model)).toBe(false);
  });

  it('marks user profile as editable', () => {
    const model = mapProfile(USER_PROFILE_1);
    expect(isReadonlyProfile(model)).toBe(false);
    expect(canEditProfile(model)).toBe(true);
    expect(canDeleteProfile(model)).toBe(true);
  });
});

/* ================================================================== */
/*  deduplicateProfiles                                                 */
/* ================================================================== */

describe('deduplicateProfiles', () => {
  it('returns same list when no duplicates exist', () => {
    const list = [SYSTEM_PROFILE, USER_PROFILE_1, USER_PROFILE_2];
    const result = deduplicateProfiles(list);
    expect(result).toHaveLength(3);
    expect(result.map(p => p.id)).toEqual(['sys1', 'u1', 'u2']);
  });

  it('deduplicates profiles with same id (last wins)', () => {
    const dup1 = makeProfile({ id: 'dup', name: 'Original' });
    const dup2 = makeProfile({ id: 'dup', name: 'Updated' });
    const result = deduplicateProfiles([dup1, dup2]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Updated');
  });

  it('deduplicates by name/game/file_handler/src_lang/dst_lang when id is empty', () => {
    const a = makeProfile({ id: '', name: 'Custom', game: 'stellaris', file_handler: 'json', config: { src_lang: 'en', dst_lang: 'ru' } });
    const b = makeProfile({ id: '', name: 'Custom', game: 'stellaris', file_handler: 'json', config: { src_lang: 'en', dst_lang: 'ru' } });
    const result = deduplicateProfiles([a, b]);
    expect(result).toHaveLength(1);
  });

  it('keeps profiles with same name but different game', () => {
    const a = makeProfile({ id: 'x', name: 'Custom', game: 'stellaris' });
    const b = makeProfile({ id: 'y', name: 'Custom', game: 'generic' });
    const result = deduplicateProfiles([a, b]);
    expect(result).toHaveLength(2);
  });

  it('keeps system + user profiles distinct', () => {
    const result = deduplicateProfiles([SYSTEM_PROFILE, USER_PROFILE_1, USER_PROFILE_2]);
    expect(result).toHaveLength(3);
  });

  it('does not deduplicate system vs user profile when id is empty', () => {
    const sys = makeProfile({ id: '', name: 'Common', game: 'stellaris', file_handler: 'json', config: { src_lang: 'en', dst_lang: 'ru' }, is_system: true });
    const usr = makeProfile({ id: '', name: 'Common', game: 'stellaris', file_handler: 'json', config: { src_lang: 'en', dst_lang: 'ru' }, is_system: false });
    const result = deduplicateProfiles([sys, usr]);
    expect(result).toHaveLength(2);
  });

  it('handles empty list', () => {
    expect(deduplicateProfiles([])).toEqual([]);
  });
});

/* ================================================================== */
/*  appendProfileUnique                                                 */
/* ================================================================== */

describe('appendProfileUnique', () => {
  it('appends a new profile to the list', () => {
    const result = appendProfileUnique([SYSTEM_PROFILE], USER_PROFILE_1);
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe('u1');
  });

  it('replaces existing profile with same id', () => {
    const existing = makeProfile({ id: 'u1', name: 'Old Name' });
    const updated = makeProfile({ id: 'u1', name: 'New Name' });
    const result = appendProfileUnique([SYSTEM_PROFILE, existing], updated);
    expect(result).toHaveLength(2);
    expect(result[1].name).toBe('New Name');
  });

  it('does not create duplicate when adding same profile twice', () => {
    const list = appendProfileUnique([SYSTEM_PROFILE], USER_PROFILE_1);
    const result = appendProfileUnique(list, USER_PROFILE_1);
    expect(result).toHaveLength(2);
    expect(result.map(p => p.id)).toEqual(['sys1', 'u1']);
  });

  it('does not mutate the original array', () => {
    const original = [SYSTEM_PROFILE];
    const result = appendProfileUnique(original, USER_PROFILE_1);
    expect(original).toHaveLength(1);
    expect(result).toHaveLength(2);
  });
});

/* ================================================================== */
/*  removeProfile                                                       */
/* ================================================================== */

describe('removeProfile', () => {
  it('removes profile by id', () => {
    const result = removeProfile([SYSTEM_PROFILE, USER_PROFILE_1], 'u1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('sys1');
  });

  it('returns same list when id not found', () => {
    const result = removeProfile([SYSTEM_PROFILE, USER_PROFILE_1], 'nonexistent');
    expect(result).toHaveLength(2);
  });

  it('does not mutate the original array', () => {
    const original = [SYSTEM_PROFILE, USER_PROFILE_1];
    const result = removeProfile(original, 'u1');
    expect(original).toHaveLength(2);
    expect(result).toHaveLength(1);
  });
});

/* ================================================================== */
/*  profileToForm                                                       */
/* ================================================================== */

describe('profileToForm', () => {
  const FULL_INITIAL_CONFIG: Record<string, unknown> = {
    src_lang: 'fr',
    dst_lang: 'de',
    batch_size: 25,
    use_cache: false,
    save_raw_responses: true,
    runtime: {
      provider: 'openai',
      model: 'gpt-4',
      temperature: 0.7,
      api_key_id: 'key-1',
      api_key_ids: ['key-1', 'key-2'],
      max_retries: 5,
      timeout_sec: 120,
      max_completion_tokens: 4096,
    },
    prompt: {
      profile_name: 'my-prompt-profile',
      batch_system_prompt: 'System prompt',
      batch_user_template: 'User template',
      single_system_prompt: 'Single system',
      single_user_template: 'Single user',
      log_prompts: true,
    },
    protection: {
      strategy: 'hedging',
    },
    validation: {
      validator_name: 'comet',
    },
    output: {
      output_dir: '/custom/output',
      filename_suffix: '_custom',
      preserve_relative_path: false,
      overwrite: true,
      backup: false,
    },
    file_handler: 'custom_handler',
  };

  it('reads all fields from a full initialConfig', () => {
    const result = profileToForm(undefined, FULL_INITIAL_CONFIG);

    expect(result.srcLang).toBe('fr');
    expect(result.dstLang).toBe('de');
    expect(result.batchSize).toBe(25);
    expect(result.useCache).toBe(false);
    expect(result.saveRawResponses).toBe(true);

    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4');
    expect(result.temperature).toBe(0.7);
    expect(result.apiKeyId).toBe('key-1');
    expect(result.apiKeyIds).toEqual(['key-1', 'key-2']);
    expect(result.maxRetries).toBe(5);
    expect(result.timeoutSec).toBe(120);
    expect(result.maxCompletionTokens).toBe(4096);

    expect(result.promptProfileName).toBe('my-prompt-profile');
    expect(result.batchSystemPrompt).toBe('System prompt');
    expect(result.batchUserTemplate).toBe('User template');
    expect(result.singleSystemPrompt).toBe('Single system');
    expect(result.singleUserTemplate).toBe('Single user');
    expect(result.logPrompts).toBe(true);

    expect(result.protectionStrategy).toBe('hedging');
    expect(result.validatorName).toBe('comet');

    expect(result.outputDir).toBe('/custom/output');
    expect(result.outputFilenameSuffix).toBe('_custom');
    expect(result.outputPreserveRelativePath).toBe(false);
    expect(result.outputOverwrite).toBe(true);
    expect(result.outputBackup).toBe(false);

    expect(result.fileHandler).toBe('custom_handler');

    // Name/description/game come from profile, not initialConfig
    expect(result.name).toBe('');
    expect(result.description).toBe('');
    expect(result.game).toBe('stellaris');
  });

  it('does NOT read filePaths from initialConfig (profile is config-only)', () => {
    const withFilePaths: Record<string, unknown> = {
      ...FULL_INITIAL_CONFIG,
      file_paths: ['/some/file.txt'],
      source_name: 'test_mod',
    };
    const result = profileToForm(undefined, withFilePaths);
    // File-path keys are not part of ProfileFormModel, so they're simply ignored
    expect(result).not.toHaveProperty('filePaths');
    expect(result).not.toHaveProperty('sourceName');
    expect(result).not.toHaveProperty('filePathList');
  });

  it('defaults advanced fields when initialConfig only has basic fields', () => {
    const basicConfig: Record<string, unknown> = {
      src_lang: 'en',
      dst_lang: 'ru',
      batch_size: 10,
      use_cache: true,
      runtime: {
        provider: 'openai',
        model: 'gpt-4',
      },
    };
    const result = profileToForm(undefined, basicConfig);

    // Basic fields come through
    expect(result.srcLang).toBe('en');
    expect(result.dstLang).toBe('ru');
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4');

    // Advanced fields default
    expect(result.temperature).toBe(DEFAULT_PROFILE_FORM.temperature);
    expect(result.promptProfileName).toBe(DEFAULT_PROFILE_FORM.promptProfileName);
    expect(result.protectionStrategy).toBe(DEFAULT_PROFILE_FORM.protectionStrategy);
    expect(result.validatorName).toBe(DEFAULT_PROFILE_FORM.validatorName);
    expect(result.outputDir).toBe(DEFAULT_PROFILE_FORM.outputDir);
    expect(result.outputFilenameSuffix).toBe(DEFAULT_PROFILE_FORM.outputFilenameSuffix);
    expect(result.outputPreserveRelativePath).toBe(DEFAULT_PROFILE_FORM.outputPreserveRelativePath);
    expect(result.outputOverwrite).toBe(DEFAULT_PROFILE_FORM.outputOverwrite);
    expect(result.outputBackup).toBe(DEFAULT_PROFILE_FORM.outputBackup);
  });

  it('uses initialConfig values when both profile and initialConfig are provided', () => {
    const profile = mapProfile({
      id: 'p1',
      name: 'Pro',
      description: 'My profile',
      game: 'stellaris',
      file_handler: 'some_handler',
      config: {
        src_lang: 'profile_src',
        dst_lang: 'profile_dst',
        runtime: { provider: 'profile-provider', model: 'profile-model' },
      },
      is_system: false,
      created_at: '',
      updated_at: '',
    });
    const result = profileToForm(profile, FULL_INITIAL_CONFIG);

    // Profile metadata comes from profile model
    expect(result.name).toBe('Pro');
    expect(result.description).toBe('My profile');
    expect(result.game).toBe('stellaris');
    expect(result.fileHandler).toBe('some_handler');

    // initialConfig takes priority over profile config for all field values
    expect(result.srcLang).toBe('fr');
    expect(result.dstLang).toBe('de');
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4');

    // initialConfig also provides advanced fields
    expect(result.temperature).toBe(0.7);
    expect(result.promptProfileName).toBe('my-prompt-profile');
    expect(result.protectionStrategy).toBe('hedging');
  });

  it('returns defaults when called without arguments', () => {
    const result = profileToForm();
    expect(result).toEqual(DEFAULT_PROFILE_FORM);
  });
});

/* ================================================================== */
/*  formToProfileConfig — round-trip symmetry with profileToForm       */
/* ================================================================== */

describe('formToProfileConfig', () => {
  it('produces the same structure that profileToForm reads', () => {
    const form = profileToForm(undefined, {
      src_lang: 'ja',
      dst_lang: 'ko',
      batch_size: 50,
      use_cache: false,
      runtime: { provider: 'anthropic', model: 'claude-3', temperature: 0.5 },
      prompt: { profile_name: 'p1' },
      protection: { strategy: 'strict' },
      validation: { validator_name: 'comet' },
      output: {
        output_dir: '/out',
        filename_suffix: '_suffix',
        preserve_relative_path: false,
        overwrite: true,
        backup: false,
      },
    });

    const config = formToProfileConfig(form);

    expect(config.src_lang).toBe('ja');
    expect(config.dst_lang).toBe('ko');
    expect(config.batch_size).toBe(50);
    expect(config.use_cache).toBe(false);

    const runtime = config.runtime as Record<string, unknown>;
    expect(runtime.provider).toBe('anthropic');
    expect(runtime.model).toBe('claude-3');
    expect(runtime.temperature).toBe(0.5);

    const prompt = config.prompt as Record<string, unknown>;
    expect(prompt.profile_name).toBe('p1');

    const protection = config.protection as Record<string, unknown>;
    expect(protection.strategy).toBe('strict');

    const validation = config.validation as Record<string, unknown>;
    expect(validation.validator_name).toBe('comet');

    const output = config.output as Record<string, unknown>;
    expect(output.output_dir).toBe('/out');
    expect(output.filename_suffix).toBe('_suffix');
    expect(output.preserve_relative_path).toBe(false);
    expect(output.overwrite).toBe(true);
    expect(output.backup).toBe(false);
  });

  it('writes canonical output.output_dir (not output.dir)', () => {
    const form = { ...DEFAULT_PROFILE_FORM, outputDir: '/canonical/path' };
    const config = formToProfileConfig(form);
    const output = config.output as Record<string, unknown>;
    expect(output.output_dir).toBe('/canonical/path');
    expect(output.dir).toBeUndefined();
  });

  it('writes save_raw_responses and runtime advanced fields', () => {
    const form = {
      ...DEFAULT_PROFILE_FORM,
      saveRawResponses: true,
      maxRetries: 3,
      timeoutSec: 60,
      maxCompletionTokens: 2048,
    };
    const config = formToProfileConfig(form);
    expect(config.save_raw_responses).toBe(true);
    const runtime = config.runtime as Record<string, unknown>;
    expect(runtime.max_retries).toBe(3);
    expect(runtime.timeout_sec).toBe(60);
    expect(runtime.max_completion_tokens).toBe(2048);
  });

  it('writes api_key_ids and api_key_id', () => {
    const form = {
      ...DEFAULT_PROFILE_FORM,
      apiKeyId: 'key-1',
      apiKeyIds: ['key-1', 'key-2'],
    };
    const config = formToProfileConfig(form);
    const runtime = config.runtime as Record<string, unknown>;
    expect(runtime.api_key_id).toBe('key-1');
    expect(runtime.api_key_ids).toEqual(['key-1', 'key-2']);
  });

  it('writes log_prompts explicitly (true and false)', () => {
    const formTrue = { ...DEFAULT_PROFILE_FORM, logPrompts: true };
    const configTrue = formToProfileConfig(formTrue);
    expect((configTrue.prompt as Record<string, unknown>).log_prompts).toBe(true);

    const formFalse = { ...DEFAULT_PROFILE_FORM, logPrompts: false };
    const configFalse = formToProfileConfig(formFalse);
    expect((configFalse.prompt as Record<string, unknown>).log_prompts).toBe(false);
  });
});

describe('profile round-trip', () => {
  it('save → load preserves apiKeyIds, maxRetries, timeoutSec, maxCompletionTokens, saveRawResponses, logPrompts, outputDir', () => {
    // Simulate: user fills profile form
    const form: ProfileFormModel = {
      ...DEFAULT_PROFILE_FORM,
      srcLang: 'en',
      dstLang: 'de',
      provider: 'groq',
      model: 'llama-3',
      apiKeyId: 'key-1',
      apiKeyIds: ['key-1', 'key-2'],
      maxRetries: 3,
      timeoutSec: 120,
      maxCompletionTokens: 4096,
      saveRawResponses: true,
      logPrompts: false,
      outputDir: '/my/output',
    };

    // Save to config
    const config = formToProfileConfig(form);
    expect((config.runtime as Record<string, unknown>).max_retries).toBe(3);
    expect((config.runtime as Record<string, unknown>).timeout_sec).toBe(120);
    expect((config.runtime as Record<string, unknown>).max_completion_tokens).toBe(4096);
    expect((config.runtime as Record<string, unknown>).api_key_ids).toEqual(['key-1', 'key-2']);
    expect(config.save_raw_responses).toBe(true);
    expect((config.prompt as Record<string, unknown>).log_prompts).toBe(false);
    expect((config.output as Record<string, unknown>).output_dir).toBe('/my/output');

    // Apply back to form (simulate loading profile)
    const restored = profileToForm(undefined, config);

    expect(restored.apiKeyIds).toEqual(['key-1', 'key-2']);
    expect(restored.maxRetries).toBe(3);
    expect(restored.timeoutSec).toBe(120);
    expect(restored.maxCompletionTokens).toBe(4096);
    expect(restored.saveRawResponses).toBe(true);
    expect(restored.logPrompts).toBe(false);
    expect(restored.outputDir).toBe('/my/output');
  });

  it('profileToForm reads legacy output.dir alias', () => {
    const config = { output: { dir: '/legacy/path' } };
    const result = profileToForm(undefined, config);
    expect(result.outputDir).toBe('/legacy/path');
  });
});

/* ================================================================== */
/*  Integration: reload profiles twice does not duplicate               */
/* ================================================================== */

describe('reload profiles twice (simulated)', () => {
  it('deduplicateProfiles prevents duplicates after second load', () => {
    // Simulate first load from API
    const apiResult1 = [SYSTEM_PROFILE, USER_PROFILE_1];
    const afterLoad1 = deduplicateProfiles(apiResult1);
    expect(afterLoad1).toHaveLength(2);

    // Simulate second load from API (same data — no new profiles created)
    const apiResult2 = [SYSTEM_PROFILE, USER_PROFILE_1];
    const afterLoad2 = deduplicateProfiles(apiResult2);
    expect(afterLoad2).toHaveLength(2);
    expect(afterLoad2).toEqual(afterLoad1);
  });

  it('copy then load does not duplicate', () => {
    // Initial state
    let profiles = deduplicateProfiles([SYSTEM_PROFILE, USER_PROFILE_1]);

    // Copy system profile (simulates API returning a new profile)
    const copy = makeProfile({ id: 'copy1', name: 'System Profile (copy)', is_system: false });
    profiles = appendProfileUnique(profiles, copy);
    expect(profiles).toHaveLength(3);

    // Simulate reload from API (which now includes the copy)
    const apiResult = [SYSTEM_PROFILE, USER_PROFILE_1, copy];
    profiles = deduplicateProfiles(apiResult);
    expect(profiles).toHaveLength(3);
    expect(profiles.map(p => p.id)).toEqual(['sys1', 'u1', 'copy1']);
  });
});
