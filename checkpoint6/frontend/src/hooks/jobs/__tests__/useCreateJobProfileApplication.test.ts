import { describe, it, expect, vi } from 'vitest';
import { applyProfileToForm } from '../useCreateJobProfileApplication';
import type { ModInfoSchema, TranslationProfile } from '../../../api/types';
import type { FieldSetters } from '../useCreateJobFields';

/* ------------------------------------------------------------------ */
/*  Helper: make a minimal TranslationProfile                           */
/* ------------------------------------------------------------------ */

function makeProfile(overrides: Partial<TranslationProfile> = {}): TranslationProfile {
  return {
    id: 'p1',
    name: 'Test Profile',
    description: '',
    game: 'stellaris',
    file_handler: null,
    config: {},
    is_system: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Helper: FieldSetters with all vi.fn()                               */
/* ------------------------------------------------------------------ */

function mockSetters(): FieldSetters {
  return {
    setSrcLang: vi.fn(),
    setDstLang: vi.fn(),
    setBatchSize: vi.fn(),
    setUseCache: vi.fn(),
    setProvider: vi.fn(),
    setModel: vi.fn(),
    setApiKeyId: vi.fn(),
    setApiKeyIds: vi.fn(),
    setPromptProfileName: vi.fn(),
    setProtectionStrategy: vi.fn(),
    setRuleSetIds: vi.fn(),
    setValidatorName: vi.fn(),
    setOutputDir: vi.fn(),
    setOutputFilenameSuffix: vi.fn(),
    setOutputPreserveRelativePath: vi.fn(),
    setOutputOverwrite: vi.fn(),
    setOutputBackup: vi.fn(),
    setTemperature: vi.fn(),
    setMaxRetries: vi.fn(),
    setTimeoutSec: vi.fn(),
    setMaxCompletionTokens: vi.fn(),
    setSaveRawResponses: vi.fn(),
    setPromptOverrideEnabled: vi.fn(),
    setBatchSystemPrompt: vi.fn(),
    setBatchUserTemplate: vi.fn(),
    setSingleSystemPrompt: vi.fn(),
    setSingleUserTemplate: vi.fn(),
    setLogPrompts: vi.fn(),
  };
}

/* ------------------------------------------------------------------ */
/*  Helper: make a minimal ModInfoSchema for testing                     */
/* ------------------------------------------------------------------ */

function makeMod(overrides: Partial<ModInfoSchema> = {}): ModInfoSchema {
  return {
    name: 'Test Mod',
    mod_id: 'test-mod',
    path: '/path/to/mod',
    game_id: 'stellaris',
    version: '1.0',
    supported_version: '1.0',
    tags: [],
    localisation_paths: [],
    diagnostics: [],
    is_valid: true,
    source: 'local',
    installed: false,
    install_action: '',
    install_conflict: false,
    ...overrides,
  };
}

/* ================================================================== */
/*  Tests                                                               */
/* ================================================================== */

describe('applyProfileToForm', () => {
  /* ------------------------------------------------------------------ */
  /*  Basic fields                                                       */
  /* ------------------------------------------------------------------ */

  it('applies srcLang and dstLang from profile config', () => {
    const profiles = [makeProfile({
      id: 'p1',
      config: { src_lang: 'french', dst_lang: 'german' },
    })];
    const setters = mockSetters();
    applyProfileToForm(profiles, 'p1', setters, vi.fn());
    expect(setters.setSrcLang).toHaveBeenCalledWith('french');
    expect(setters.setDstLang).toHaveBeenCalledWith('german');
  });

  it('applies batchSize and useCache from profile config', () => {
    const profiles = [makeProfile({
      id: 'p1',
      config: { batch_size: 100, use_cache: false },
    })];
    const setters = mockSetters();
    applyProfileToForm(profiles, 'p1', setters, vi.fn());
    expect(setters.setBatchSize).toHaveBeenCalledWith(100);
    expect(setters.setUseCache).toHaveBeenCalledWith(false);
  });

  /* ------------------------------------------------------------------ */
  /*  Runtime fields                                                     */
  /* ------------------------------------------------------------------ */

  it('applies runtime fields (provider, model, temperature, etc.)', () => {
    const profiles = [makeProfile({
      id: 'p1',
      config: {
        runtime: {
          provider: 'openai',
          model: 'gpt-4',
          temperature: 0.7,
          max_retries: 3,
          timeout_sec: 60,
          max_completion_tokens: 4096,
        },
      },
    })];
    const setters = mockSetters();
    applyProfileToForm(profiles, 'p1', setters, vi.fn());
    expect(setters.setProvider).toHaveBeenCalledWith('openai');
    expect(setters.setModel).toHaveBeenCalledWith('gpt-4');
    expect(setters.setTemperature).toHaveBeenCalledWith(0.7);
    expect(setters.setMaxRetries).toHaveBeenCalledWith(3);
    expect(setters.setTimeoutSec).toHaveBeenCalledWith(60);
    expect(setters.setMaxCompletionTokens).toHaveBeenCalledWith(4096);
  });

  /* ------------------------------------------------------------------ */
  /*  API key fields                                                     */
  /* ------------------------------------------------------------------ */

  it('applies apiKeyId and apiKeyIds from profile config', () => {
    const profiles = [makeProfile({
      id: 'p1',
      config: {
        api_key_id: 'key-1',
        api_key_ids: ['key-1', 'key-2'],
      },
    })];
    const setters = mockSetters();
    applyProfileToForm(profiles, 'p1', setters, vi.fn());
    expect(setters.setApiKeyId).toHaveBeenCalledWith('key-1');
    expect(setters.setApiKeyIds).toHaveBeenCalledWith(['key-1', 'key-2']);
  });

  /* ------------------------------------------------------------------ */
  /*  Advanced fields (prompt, protection, validation)                    */
  /* ------------------------------------------------------------------ */

  it('applies prompt, protection, and validation fields', () => {
    const profiles = [makeProfile({
      id: 'p1',
      config: {
        prompt: { profile_name: 'creative' },
        protection: { strategy: 'strict' },
        validation: { validator_name: 'basic' },
      },
    })];
    const setters = mockSetters();
    applyProfileToForm(profiles, 'p1', setters, vi.fn());
    expect(setters.setPromptProfileName).toHaveBeenCalledWith('creative');
    expect(setters.setProtectionStrategy).toHaveBeenCalledWith('strict');
    expect(setters.setValidatorName).toHaveBeenCalledWith('basic');
  });

  it('applies prompt template overrides from profile config', () => {
    const profiles = [makeProfile({
      id: 'p1',
      config: {
        prompt: {
          batch_system_prompt: 'Batch system',
          batch_user_template: 'Batch user',
          single_system_prompt: 'Single system',
          single_user_template: 'Single user',
        },
      },
    })];
    const setters = mockSetters();
    applyProfileToForm(profiles, 'p1', setters, vi.fn());
    expect(setters.setBatchSystemPrompt).toHaveBeenCalledWith('Batch system');
    expect(setters.setBatchUserTemplate).toHaveBeenCalledWith('Batch user');
    expect(setters.setSingleSystemPrompt).toHaveBeenCalledWith('Single system');
    expect(setters.setSingleUserTemplate).toHaveBeenCalledWith('Single user');
  });

  it('applies logPrompts from profile config (including false)', () => {
    const profiles = [makeProfile({
      id: 'p1',
      config: { prompt: { log_prompts: false } },
    })];
    const setters = mockSetters();
    applyProfileToForm(profiles, 'p1', setters, vi.fn());
    expect(setters.setLogPrompts).toHaveBeenCalledWith(false);
  });

  it('applies logPrompts=true from profile config', () => {
    const profiles = [makeProfile({
      id: 'p1',
      config: { prompt: { log_prompts: true } },
    })];
    const setters = mockSetters();
    applyProfileToForm(profiles, 'p1', setters, vi.fn());
    expect(setters.setLogPrompts).toHaveBeenCalledWith(true);
  });

  /* ------------------------------------------------------------------ */
  /*  Output fields                                                      */
  /* ------------------------------------------------------------------ */

  it('applies output fields', () => {
    const profiles = [makeProfile({
      id: 'p1',
      config: {
        output: {
          dir: '/output',
          filename_suffix: '_translated',
          preserve_relative_path: true,
          overwrite: true,
          backup: false,
        },
      },
    })];
    const setters = mockSetters();
    applyProfileToForm(profiles, 'p1', setters, vi.fn());
    expect(setters.setOutputDir).toHaveBeenCalledWith('/output');
    expect(setters.setOutputFilenameSuffix).toHaveBeenCalledWith('_translated');
    expect(setters.setOutputPreserveRelativePath).toHaveBeenCalledWith(true);
    expect(setters.setOutputOverwrite).toHaveBeenCalledWith(true);
    expect(setters.setOutputBackup).toHaveBeenCalledWith(false);
  });

  it('supports output.output_dir as alternative to output.dir', () => {
    const profiles = [makeProfile({
      id: 'p1',
      config: { output: { output_dir: '/alt-output' } },
    })];
    const setters = mockSetters();
    applyProfileToForm(profiles, 'p1', setters, vi.fn());
    expect(setters.setOutputDir).toHaveBeenCalledWith('/alt-output');
  });

  /* ------------------------------------------------------------------ */
  /*  Edge cases                                                         */
  /* ------------------------------------------------------------------ */

  it('does nothing when selectedProfileId is empty', () => {
    const setters = mockSetters();
    applyProfileToForm([], '', setters, vi.fn());
    for (const setter of Object.values(setters)) {
      expect(setter).not.toHaveBeenCalled();
    }
  });

  it('does nothing when profile is not found', () => {
    const profiles = [makeProfile({ id: 'p1' })];
    const setters = mockSetters();
    applyProfileToForm(profiles, 'nonexistent', setters, vi.fn());
    for (const setter of Object.values(setters)) {
      expect(setter).not.toHaveBeenCalled();
    }
  });

  it('does not call setters for empty string values', () => {
    const profiles = [makeProfile({
      id: 'p1',
      config: {
        src_lang: '',
        dst_lang: '',
        runtime: { provider: '', model: '' },
      },
    })];
    const setters = mockSetters();
    applyProfileToForm(profiles, 'p1', setters, vi.fn());
    expect(setters.setSrcLang).not.toHaveBeenCalled();
    expect(setters.setDstLang).not.toHaveBeenCalled();
    expect(setters.setProvider).not.toHaveBeenCalled();
    expect(setters.setModel).not.toHaveBeenCalled();
  });

  /* ------------------------------------------------------------------ */
  /*  Game config                                                        */
  /* ------------------------------------------------------------------ */

  it('updates gameConfig when profile has game', () => {
    const profiles = [makeProfile({
      id: 'p1',
      config: { src_lang: 'en' },
      game: 'stellaris',
    })];
    const setGameConfig = vi.fn();
    applyProfileToForm(profiles, 'p1', mockSetters(), setGameConfig);
    expect(setGameConfig).toHaveBeenCalled();
    const updater = setGameConfig.mock.calls[0][0];
    const result = updater(null);
    expect(result).toHaveProperty('game', 'stellaris');
  });

  it('updates gameConfig when profile has file_handler', () => {
    const profiles = [makeProfile({
      id: 'p1',
      config: { src_lang: 'en' },
      game: 'stellaris',
      file_handler: 'stellaris_localisation',
    })];
    const setGameConfig = vi.fn();
    applyProfileToForm(profiles, 'p1', mockSetters(), setGameConfig);
    expect(setGameConfig).toHaveBeenCalled();
    const updater = setGameConfig.mock.calls[0][0];
    const result = updater(null);
    expect(result).toHaveProperty('file_handler', 'stellaris_localisation');
  });

  /* ------------------------------------------------------------------ */
  /*  Game config application (always applied, no mod guard)             */
  /* ------------------------------------------------------------------ */

  it('applies game and file_handler from profile', () => {
    const profiles = [makeProfile({
      id: 'p1',
      config: { src_lang: 'en' },
      game: 'stellaris',
      file_handler: 'stellaris_localisation',
    })];
    const setGameConfig = vi.fn();
    applyProfileToForm(profiles, 'p1', mockSetters(), setGameConfig);
    expect(setGameConfig).toHaveBeenCalled();
    const updater = setGameConfig.mock.calls[0][0];
    const result = updater(null);
    expect(result).toHaveProperty('game', 'stellaris');
    expect(result).toHaveProperty('file_handler', 'stellaris_localisation');
  });

  it('applies game config when profile has no file_handler', () => {
    const profiles = [makeProfile({
      id: 'p1',
      config: { src_lang: 'en' },
      game: 'stellaris',
    })];
    const setGameConfig = vi.fn();
    applyProfileToForm(profiles, 'p1', mockSetters(), setGameConfig);
    expect(setGameConfig).toHaveBeenCalled();
  });

  it('still applies all non-game fields from profile', () => {
    const profiles = [makeProfile({
      id: 'p1',
      config: {
        src_lang: 'french',
        dst_lang: 'german',
        runtime: { provider: 'openai', model: 'gpt-4' },
      },
      game: 'stellaris',
      file_handler: 'stellaris_localisation',
    })];
    const setters = mockSetters();
    const setGameConfig = vi.fn();

    applyProfileToForm(profiles, 'p1', setters, setGameConfig);

    // All fields must be applied
    expect(setters.setSrcLang).toHaveBeenCalledWith('french');
    expect(setters.setDstLang).toHaveBeenCalledWith('german');
    expect(setters.setProvider).toHaveBeenCalledWith('openai');
    expect(setters.setModel).toHaveBeenCalledWith('gpt-4');

    // Game config always applied (no mod guard)
    expect(setGameConfig).toHaveBeenCalled();
  });
});
