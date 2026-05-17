import { describe, it, expect } from 'vitest';
import { buildJobConfig } from '../jobConfigBuild';

/* ================================================================== */
/*  buildJobConfig                                                      */
/* ================================================================== */

describe('buildJobConfig', () => {
  it('maps camelCase fields to snake_case', () => {
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'russian',
      batchSize: 50,
      useCache: true,
      provider: 'openai',
      model: 'gpt-4',
      apiKeyId: 'key-123',
    });

    expect(config).toMatchObject({
      src_lang: 'english',
      dst_lang: 'russian',
      batch_size: 50,
      use_cache: true,
      provider: 'openai',
      model: 'gpt-4',
      api_key_id: 'key-123',
    });
  });

  it('omits empty provider, model, apiKeyId', () => {
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'russian',
      batchSize: 50,
      useCache: true,
      provider: '',
      model: '',
      apiKeyId: '',
    });

    expect(config.provider).toBeUndefined();
    expect(config.model).toBeUndefined();
    expect(config.api_key_id).toBeUndefined();
    expect(config.src_lang).toBe('english');
    expect(config.dst_lang).toBe('russian');
    expect(config.batch_size).toBe(50);
    expect(config.use_cache).toBe(true);
  });

  it('includes translation_profile_id when selectedProfileId is set', () => {
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'russian',
      batchSize: 50,
      useCache: true,
      provider: '',
      model: '',
      apiKeyId: '',
      selectedProfileId: 'profile-42',
    });

    expect(config.translation_profile_id).toBe('profile-42');
  });

  it('omits translation_profile_id when selectedProfileId is empty', () => {
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'russian',
      batchSize: 50,
      useCache: true,
      provider: '',
      model: '',
      apiKeyId: '',
      selectedProfileId: '',
    });

    expect(config.translation_profile_id).toBeUndefined();
  });

  it('merges gameConfig into result', () => {
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'russian',
      batchSize: 50,
      useCache: true,
      provider: '',
      model: '',
      apiKeyId: '',
      gameConfig: { game: 'stellaris', file_handler: 'ck3' },
    });

    expect(config.game).toBe('stellaris');
    expect(config.file_handler).toBe('ck3');
  });

  it('handles gameConfig null gracefully', () => {
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'russian',
      batchSize: 50,
      useCache: true,
      provider: '',
      model: '',
      apiKeyId: '',
      gameConfig: null,
    });

    expect(config.src_lang).toBe('english');
    expect(config.game).toBeUndefined();
  });

  it('gameConfig does not override src_lang', () => {
    // gameConfig is spread *between* the explicit fields and translation_profile_id
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'russian',
      batchSize: 50,
      useCache: true,
      provider: '',
      model: '',
      apiKeyId: '',
      gameConfig: { src_lang: 'french' },
    });

    // src_lang from the explicit field comes first, then gameConfig overrides it
    expect(config.src_lang).toBe('french');
  });

  it('handles all fields simultaneously', () => {
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'german',
      batchSize: 100,
      useCache: false,
      provider: 'anthropic',
      model: 'claude-3',
      apiKeyId: 'key-999',
      selectedProfileId: 'prof-1',
      gameConfig: { custom: 'value' },
    });

    expect(config).toEqual({
      src_lang: 'english',
      dst_lang: 'german',
      batch_size: 100,
      use_cache: false,
      provider: 'anthropic',
      model: 'claude-3',
      api_key_id: 'key-999',
      api_key_ids: ['key-999'],
      runtime: { provider: 'anthropic', model: 'claude-3' },
      custom: 'value',
      translation_profile_id: 'prof-1',
    });
  });

  it('uses apiKeyIds first element as api_key_id and includes api_key_ids array', () => {
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'russian',
      batchSize: 50,
      useCache: true,
      provider: 'groq',
      model: 'llama-3',
      apiKeyId: '',
      apiKeyIds: ['key-a', 'key-b'],
    });

    expect(config.api_key_id).toBe('key-a');
    expect(config.api_key_ids).toEqual(['key-a', 'key-b']);
  });

  it('omits api_key_ids when apiKeyIds is empty', () => {
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'russian',
      batchSize: 50,
      useCache: true,
      provider: 'groq',
      model: 'llama-3',
      apiKeyId: 'key-1',
      apiKeyIds: [],
    });

    expect(config.api_key_id).toBe('key-1');
    expect(config.api_key_ids).toBeUndefined();
  });

  /* ================================================================ */
  /*  Advanced config - nested runtime/prompt/protection/validation/output
  /* ================================================================ */

  it('includes nested runtime config when advanced fields are set', () => {
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'russian',
      batchSize: 50,
      useCache: true,
      provider: 'groq',
      model: 'llama-3',
      apiKeyId: 'key-1',
      temperature: 0.7,
      maxRetries: 3,
      timeoutSec: 120,
      maxCompletionTokens: 4096,
    });

    expect(config.runtime).toEqual({
      provider: 'groq',
      model: 'llama-3',
      temperature: 0.7,
      max_retries: 3,
      timeout_sec: 120,
      max_completion_tokens: 4096,
    });
    // Backward compat: flat keys still present
    expect(config.provider).toBe('groq');
    expect(config.model).toBe('llama-3');
  });

  it('includes nested prompt config when promptProfileName is set', () => {
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'russian',
      batchSize: 50,
      useCache: true,
      provider: '',
      model: '',
      apiKeyId: '',
      promptProfileName: 'default',
    });

    expect(config.prompt).toEqual({ profile_name: 'default' });
  });

  it('includes nested protection config when protectionStrategy is set', () => {
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'russian',
      batchSize: 50,
      useCache: true,
      provider: '',
      model: '',
      apiKeyId: '',
      protectionStrategy: 'strict',
    });

    expect(config.protection).toEqual({ strategy: 'strict' });
  });

  it('includes nested validation config when validatorName is set', () => {
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'russian',
      batchSize: 50,
      useCache: true,
      provider: '',
      model: '',
      apiKeyId: '',
      validatorName: 'basic',
    });

    expect(config.validation).toEqual({ validator_name: 'basic' });
  });

  it('includes nested output config when output fields are set', () => {
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'russian',
      batchSize: 50,
      useCache: true,
      provider: '',
      model: '',
      apiKeyId: '',
      outputDir: '/out/dir',
      outputFilenameSuffix: '_translated',
      outputPreserveRelativePath: true,
      outputOverwrite: false,
      outputBackup: true,
    });

    expect(config.output).toEqual({
      output_dir: '/out/dir',
      filename_suffix: '_translated',
      preserve_relative_path: true,
      overwrite: false,
      backup: true,
    });
  });

  it('omits nested sections when advanced fields are empty/default', () => {
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'russian',
      batchSize: 50,
      useCache: true,
      provider: '',
      model: '',
      apiKeyId: '',
    });

    expect(config.runtime).toBeUndefined();
    expect(config.prompt).toBeUndefined();
    expect(config.protection).toBeUndefined();
    expect(config.validation).toBeUndefined();
    expect(config.output).toBeUndefined();
  });

  it('handles all fields simultaneously with advanced config', () => {
    const config = buildJobConfig({
      srcLang: 'english',
      dstLang: 'german',
      batchSize: 100,
      useCache: false,
      provider: 'anthropic',
      model: 'claude-3',
      apiKeyId: 'key-999',
      promptProfileName: 'creative',
      protectionStrategy: 'strict',
      validatorName: 'advanced',
      outputDir: '/out',
      outputFilenameSuffix: '_done',
      outputPreserveRelativePath: true,
      outputOverwrite: true,
      outputBackup: false,
      temperature: 0.5,
      maxRetries: 5,
      timeoutSec: 300,
      maxCompletionTokens: 8192,
      selectedProfileId: 'prof-1',
      gameConfig: { custom: 'value' },
    });

    expect(config.src_lang).toBe('english');
    expect(config.dst_lang).toBe('german');
    expect(config.provider).toBe('anthropic');
    expect(config.model).toBe('claude-3');
    expect(config.prompt).toEqual({ profile_name: 'creative' });
    expect(config.protection).toEqual({ strategy: 'strict' });
    expect(config.validation).toEqual({ validator_name: 'advanced' });
    expect(config.output).toEqual({
      output_dir: '/out',
      filename_suffix: '_done',
      preserve_relative_path: true,
      overwrite: true,
      backup: false,
    });
    expect(config.runtime).toMatchObject({
      temperature: 0.5,
      max_retries: 5,
      timeout_sec: 300,
      max_completion_tokens: 8192,
    });
    expect(config.translation_profile_id).toBe('prof-1');
    expect(config.custom).toBe('value');
  });

  it('includes save_raw_responses when true', () => {
    const config = buildJobConfig({
      srcLang: 'en', dstLang: 'de', batchSize: 10, useCache: true,
      provider: '', model: '', apiKeyId: '', saveRawResponses: true,
    });
    expect(config.save_raw_responses).toBe(true);
  });

  it('includes save_raw_responses when false', () => {
    const config = buildJobConfig({
      srcLang: 'en', dstLang: 'de', batchSize: 10, useCache: true,
      provider: '', model: '', apiKeyId: '', saveRawResponses: false,
    });
    expect(config.save_raw_responses).toBe(false);
  });

  it('includes log_prompts=false in prompt config', () => {
    const config = buildJobConfig({
      srcLang: 'en', dstLang: 'de', batchSize: 10, useCache: true,
      provider: '', model: '', apiKeyId: '',
      promptProfileName: 'default',
      logPrompts: false,
    });
    expect(config.prompt).toEqual({ profile_name: 'default', log_prompts: false });
  });

  it('includes log_prompts=true in prompt config', () => {
    const config = buildJobConfig({
      srcLang: 'en', dstLang: 'de', batchSize: 10, useCache: true,
      provider: '', model: '', apiKeyId: '',
      promptProfileName: 'default',
      logPrompts: true,
    });
    expect(config.prompt).toEqual({ profile_name: 'default', log_prompts: true });
  });

  it('preserves maxRetries=0 in runtime config', () => {
    const config = buildJobConfig({
      srcLang: 'en', dstLang: 'de', batchSize: 10, useCache: true,
      provider: 'groq', model: 'llama', apiKeyId: 'k',
      maxRetries: 0,
    });
    expect(config.runtime).toMatchObject({ max_retries: 0, provider: 'groq', model: 'llama' });
  });

  it('includes api_key_ids and save_raw_responses in all-fields config', () => {
    const config = buildJobConfig({
      srcLang: 'en', dstLang: 'de', batchSize: 10, useCache: true,
      provider: 'groq', model: 'llama', apiKeyId: '', apiKeyIds: ['k1', 'k2'],
      saveRawResponses: true,
      promptProfileName: 'json_batch',
      logPrompts: false,
    });
    expect(config.api_key_ids).toEqual(['k1', 'k2']);
    expect(config.save_raw_responses).toBe(true);
    expect((config.prompt as Record<string, unknown>).log_prompts).toBe(false);
  });
});
