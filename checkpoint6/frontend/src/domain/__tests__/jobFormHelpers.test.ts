import { describe, it, expect } from 'vitest';
import {
  detectSourceLangFromFilename,
  detectSourceLangFromPaths,
  normalizePathLines,
  applyProfileToJobForm,
} from '../jobFormHelpers';

/* ================================================================== */
/*  detectSourceLangFromFilename                                        */
/* ================================================================== */

describe('detectSourceLangFromFilename', () => {
  it('detects english from l_english.yml', () => {
    expect(detectSourceLangFromFilename('l_english.yml')).toBe('en');
  });

  it('detects russian from l_russian.yml', () => {
    expect(detectSourceLangFromFilename('l_russian.yml')).toBe('ru');
  });

  it('detects german from a nested path', () => {
    expect(detectSourceLangFromFilename('nested/path/l_german.yml')).toBe('de');
  });

  it('returns null for .yaml extension', () => {
    expect(detectSourceLangFromFilename('l_english.yaml')).toBeNull();
  });

  it('returns null for non-localisation filenames', () => {
    expect(detectSourceLangFromFilename('readme.txt')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectSourceLangFromFilename('')).toBeNull();
  });

  it('returns null for valid prefix but unknown language', () => {
    expect(detectSourceLangFromFilename('l_klingon.yml')).toBeNull();
  });

  it('handles all known languages', () => {
    const cases: [string, string][] = [
      ['l_french.yml', 'fr'],
      ['l_spanish.yml', 'es'],
      ['l_polish.yml', 'pl'],
      ['l_japanese.yml', 'ja'],
      ['l_korean.yml', 'ko'],
      ['l_simp_chinese.yml', 'zh'],
      ['l_brazilian.yml', 'pt-BR'],
      ['l_portuguese.yml', 'pt'],
      ['l_italian.yml', 'it'],
      ['l_dutch.yml', 'nl'],
      ['l_swedish.yml', 'sv'],
      ['l_czech.yml', 'cs'],
      ['l_hungarian.yml', 'hu'],
      ['l_turkish.yml', 'tr'],
      ['l_arabic.yml', 'ar'],
    ];
    for (const [input, expected] of cases) {
      expect(detectSourceLangFromFilename(input)).toBe(expected);
    }
  });
});

/* ================================================================== */
/*  detectSourceLangFromPaths                                           */
/* ================================================================== */

describe('detectSourceLangFromPaths', () => {
  it('detects language from a single path', () => {
    expect(detectSourceLangFromPaths(['l_english.yml'])).toBe('en');
  });

  it('detects language when all paths agree', () => {
    expect(
      detectSourceLangFromPaths(['l_english.yml', 'sub/l_english.yml']),
    ).toBe('en');
  });

  it('returns null when paths have different languages', () => {
    expect(
      detectSourceLangFromPaths(['l_english.yml', 'l_russian.yml']),
    ).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(detectSourceLangFromPaths([])).toBeNull();
  });

  it('returns null when no paths have detectable languages', () => {
    expect(
      detectSourceLangFromPaths(['readme.txt', 'notes.md']),
    ).toBeNull();
  });

  it('returns detected language when non-detectable paths are present', () => {
    // Non-detectable paths are filtered out; only detectable paths are considered
    expect(
      detectSourceLangFromPaths(['l_english.yml', 'readme.txt']),
    ).toBe('en');
  });
});

/* ================================================================== */
/*  normalizePathLines                                                  */
/* ================================================================== */

describe('normalizePathLines', () => {
  it('returns empty array for empty string', () => {
    expect(normalizePathLines('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(normalizePathLines('   ')).toEqual([]);
  });

  it('splits newline-separated paths', () => {
    expect(normalizePathLines('path/a\npath/b')).toEqual(['path/a', 'path/b']);
  });

  it('trims whitespace from each path', () => {
    expect(normalizePathLines('  path/a  \n\npath/b')).toEqual([
      'path/a',
      'path/b',
    ]);
  });

  it('skips empty lines between paths', () => {
    expect(normalizePathLines('path/a\n\n\npath/b')).toEqual([
      'path/a',
      'path/b',
    ]);
  });

  it('preserves duplicate paths (current behaviour)', () => {
    expect(normalizePathLines('dup\ndup')).toEqual(['dup', 'dup']);
  });
});

/* ================================================================== */
/*  applyProfileToJobForm                                               */
/* ================================================================== */

describe('applyProfileToJobForm', () => {
  it('extracts basic fields from config', () => {
    const result = applyProfileToJobForm({
      src_lang: 'fr', dst_lang: 'de', batch_size: 25, use_cache: false,
    });
    expect(result.srcLang).toBe('fr');
    expect(result.dstLang).toBe('de');
    expect(result.batchSize).toBe(25);
    expect(result.useCache).toBe(false);
  });

  it('extracts saveRawResponses from config', () => {
    const result = applyProfileToJobForm({ save_raw_responses: true });
    expect(result.saveRawResponses).toBe(true);
  });

  it('extracts runtime fields', () => {
    const result = applyProfileToJobForm({
      runtime: { provider: 'openai', model: 'gpt-4', temperature: 0.7 },
    });
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4');
    expect(result.temperature).toBe(0.7);
  });

  it('extracts runtime advanced fields (maxRetries, timeoutSec, maxCompletionTokens)', () => {
    const result = applyProfileToJobForm({
      runtime: { max_retries: 5, timeout_sec: 120, max_completion_tokens: 4096 },
    });
    expect(result.maxRetries).toBe(5);
    expect(result.timeoutSec).toBe(120);
    expect(result.maxCompletionTokens).toBe(4096);
  });

  it('extracts api_key_ids', () => {
    const result = applyProfileToJobForm({
      api_key_id: 'key-1', api_key_ids: ['key-1', 'key-2'],
    });
    expect(result.apiKeyId).toBe('key-1');
    expect(result.apiKeyIds).toEqual(['key-1', 'key-2']);
  });

  it('extracts prompt template overrides', () => {
    const result = applyProfileToJobForm({
      prompt: {
        profile_name: 'my-profile',
        batch_system_prompt: 'Batch system',
        batch_user_template: 'Batch user',
        single_system_prompt: 'Single system',
        single_user_template: 'Single user',
        log_prompts: true,
      },
    });
    expect(result.promptProfileName).toBe('my-profile');
    expect(result.batchSystemPrompt).toBe('Batch system');
    expect(result.batchUserTemplate).toBe('Batch user');
    expect(result.singleSystemPrompt).toBe('Single system');
    expect(result.singleUserTemplate).toBe('Single user');
    expect(result.logPrompts).toBe(true);
  });

  it('extracts protection and validation fields', () => {
    const result = applyProfileToJobForm({
      protection: { strategy: 'xml_placeholders' },
      validation: { validator_name: 'composite' },
    });
    expect(result.protectionStrategy).toBe('xml_placeholders');
    expect(result.validatorName).toBe('composite');
  });

  it('reads outputDir from canonical output.output_dir first', () => {
    const result = applyProfileToJobForm({
      output: { output_dir: '/canonical', dir: '/legacy' },
    });
    expect(result.outputDir).toBe('/canonical');
  });

  it('falls back to legacy output.dir when output.output_dir is absent', () => {
    const result = applyProfileToJobForm({
      output: { dir: '/legacy' },
    });
    expect(result.outputDir).toBe('/legacy');
  });

  it('extracts log_prompts=false explicitly', () => {
    const result = applyProfileToJobForm({
      prompt: { log_prompts: false },
    });
    expect(result.logPrompts).toBe(false);
  });
});
