import { describe, it, expect } from 'vitest';
import { getCreateJobProblems, canCreateJob, canConfirmPreview } from '../jobValidation';
import type { CreateJobValidationInput } from '../jobValidation';

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function validInput(overrides: Partial<CreateJobValidationInput> = {}): CreateJobValidationInput {
  return {
    filePaths: 'path/a.yml',
    srcLang: 'english',
    dstLang: 'russian',
    provider: 'groq',
    model: 'llama-3',
    apiKeyIds: ['key-1'],
    availableKeysForProvider: 1,
    // Advanced config — provide valid defaults so existing tests pass
    promptProfileName: 'default',
    protectionStrategy: 'strict',
    validatorName: 'basic',
    maxRetries: 3,
    timeoutSec: 60,
    maxCompletionTokens: 4096,
    ...overrides,
  };
}

/* ================================================================== */
/*  getCreateJobProblems                                                */
/* ================================================================== */

describe('getCreateJobProblems', () => {
  it('returns problems for empty files', () => {
    const problems = getCreateJobProblems(validInput({ filePaths: '' }));
    expect(problems).toContain('No files selected');
  });

  it('returns problems for whitespace-only files', () => {
    const problems = getCreateJobProblems(validInput({ filePaths: '  \n\n  ' }));
    expect(problems).toContain('No files selected');
  });

  it('returns problems for empty source language', () => {
    const problems = getCreateJobProblems(validInput({ srcLang: '' }));
    expect(problems).toContain('Source language is empty');
  });

  it('returns problems for whitespace-only source language', () => {
    const problems = getCreateJobProblems(validInput({ srcLang: '  ' }));
    expect(problems).toContain('Source language is empty');
  });

  it('returns problems for empty target language', () => {
    const problems = getCreateJobProblems(validInput({ dstLang: '' }));
    expect(problems).toContain('Target language is empty');
  });

  it('returns problems when src and dst are the same', () => {
    const problems = getCreateJobProblems(validInput({ srcLang: 'english', dstLang: 'english' }));
    expect(problems).toContain('Source and target languages must be different');
  });

  it('returns problems for empty provider', () => {
    const problems = getCreateJobProblems(validInput({ provider: '' }));
    expect(problems).toContain('Provider is required');
  });

  it('returns problems for empty model', () => {
    const problems = getCreateJobProblems(validInput({ model: '' }));
    expect(problems).toContain('Model is required');
  });

  it('returns problems when no keys configured for provider', () => {
    const problems = getCreateJobProblems(validInput({ availableKeysForProvider: 0, apiKeyIds: [] }));
    expect(problems).toContain('No API keys configured for provider');
  });

  it('returns problems when no API key selected despite keys available', () => {
    const problems = getCreateJobProblems(validInput({ availableKeysForProvider: 2, apiKeyIds: [] }));
    expect(problems).toContain('No API key selected');
  });

  it('does not return key problems when provider is not set', () => {
    const problems = getCreateJobProblems(validInput({ provider: '', availableKeysForProvider: 0, apiKeyIds: [] }));
    expect(problems).not.toContain('No API keys configured for provider');
    expect(problems).not.toContain('No API key selected');
  });

  it('returns multiple problems at once', () => {
    const problems = getCreateJobProblems(validInput({
      filePaths: '',
      srcLang: '',
      dstLang: '',
      provider: '',
      model: '',
      apiKeyIds: [],
      availableKeysForProvider: 0,
    }));
    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(problems).toContain('No files selected');
    expect(problems).toContain('Source language is empty');
    expect(problems).toContain('Target language is empty');
    expect(problems).toContain('Provider is required');
    expect(problems).toContain('Model is required');
  });

  it('returns no problems for a valid form', () => {
    const problems = getCreateJobProblems(validInput({ filePaths: 'path/a.yml\npath/b.yml' }));
    expect(problems).toEqual([]);
  });

  it('returns no problems for a single file valid form', () => {
    const problems = getCreateJobProblems(validInput({ filePaths: 'path/a.yml', srcLang: 'french', dstLang: 'german' }));
    expect(problems).toEqual([]);
  });
});

/* ================================================================== */
/*  canCreateJob                                                        */
/* ================================================================== */

describe('canCreateJob', () => {
  it('returns true for valid input', () => {
    expect(canCreateJob(validInput())).toBe(true);
  });

  it('returns false for empty files', () => {
    expect(canCreateJob(validInput({ filePaths: '' }))).toBe(false);
  });

  it('returns false for empty languages', () => {
    expect(canCreateJob(validInput({ srcLang: '', dstLang: '' }))).toBe(false);
  });

  it('returns false for same languages', () => {
    expect(canCreateJob(validInput({ srcLang: 'english', dstLang: 'english' }))).toBe(false);
  });

  it('returns false for empty provider', () => {
    expect(canCreateJob(validInput({ provider: '' }))).toBe(false);
  });

  it('returns false for empty model', () => {
    expect(canCreateJob(validInput({ model: '' }))).toBe(false);
  });

  it('returns false for no API key selected', () => {
    expect(canCreateJob(validInput({ apiKeyIds: [] }))).toBe(false);
  });
});

/* ================================================================== */
/*  canConfirmPreview                                                   */
/* ================================================================== */

function createMockPreview(overrides: Partial<{
  totalUnits: number;
  hasBlockingErrors: boolean;
  warnings: string[];
  errors: string[];
}> = {}) {
  return {
    totalUnits: 0,
    totalTasks: 0,
    batchSize: 50,
    cacheHits: 0,
    cacheMisses: 0,
    diagnostics: [],
    warnings: [],
    errors: [],
    unsupportedFiles: [],
    duplicateFiles: [],
    emptyFiles: [],
    zeroUnitFiles: [],
    detectedLanguages: [],
    hasBlockingErrors: false,
    ...overrides,
  };
}

describe('canConfirmPreview', () => {
  it('returns false for null preview', () => {
    expect(canConfirmPreview(null)).toBe(false);
  });

  it('returns false for preview with zero units', () => {
    expect(canConfirmPreview(createMockPreview({ totalUnits: 0 }))).toBe(false);
  });

  it('returns false when preview has blocking errors', () => {
    expect(canConfirmPreview(createMockPreview({ totalUnits: 100, hasBlockingErrors: true }))).toBe(false);
  });

  it('returns true for valid preview', () => {
    expect(canConfirmPreview(createMockPreview({ totalUnits: 100 }))).toBe(true);
  });

  it('returns true with warnings but valid units', () => {
    expect(canConfirmPreview(createMockPreview({ totalUnits: 50, warnings: ['Some warning'] }))).toBe(true);
  });
});

/* ================================================================== */
/*  Advanced config validation                                          */
/* ================================================================== */

describe('advanced config validation', () => {
  it('returns problem when promptProfileName is missing', () => {
    const problems = getCreateJobProblems(validInput({ promptProfileName: '' }));
    expect(problems).toContain('Prompt profile is required');
  });

  it('returns problem when protectionStrategy is missing', () => {
    const problems = getCreateJobProblems(validInput({ protectionStrategy: '' }));
    expect(problems).toContain('Protection strategy is required');
  });

  it('returns problem when validatorName is missing', () => {
    const problems = getCreateJobProblems(validInput({ validatorName: '' }));
    expect(problems).toContain('Validator is required');
  });

  it('returns problem when maxRetries is negative', () => {
    const problems = getCreateJobProblems(validInput({ maxRetries: -1 }));
    expect(problems).toContain('Max retries must be >= 0');
  });

  it('allows timeoutSec=0 (provider default)', () => {
    const problems = getCreateJobProblems(validInput({ timeoutSec: 0 }));
    expect(problems.filter(p => p.includes('Timeout'))).toEqual([]);
  });

  it('returns problem when timeoutSec is negative', () => {
    const problems = getCreateJobProblems(validInput({ timeoutSec: -5 }));
    expect(problems).toContain('Timeout must not be negative (0 = provider default)');
  });

  it('allows maxCompletionTokens=0 (no limit)', () => {
    const problems = getCreateJobProblems(validInput({ maxCompletionTokens: 0 }));
    expect(problems.filter(p => p.includes('completion'))).toEqual([]);
  });

  it('returns problem when maxCompletionTokens is negative', () => {
    const problems = getCreateJobProblems(validInput({ maxCompletionTokens: -10 }));
    expect(problems).toContain('Max completion tokens must not be negative (0 = no limit)');
  });

  it('allows maxRetries=0 (no retries)', () => {
    const problems = getCreateJobProblems(validInput({ maxRetries: 0 }));
    expect(problems.filter(p => p.includes('retries'))).toEqual([]);
  });

  it('passes validation when all advanced fields are valid or default', () => {
    const problems = getCreateJobProblems(validInput({
      promptProfileName: 'default',
      protectionStrategy: 'strict',
      validatorName: 'basic',
      maxRetries: 0,
      timeoutSec: 0,
      maxCompletionTokens: 0,
    }));
    expect(problems.filter(p => p.includes('is required') || p.includes('must be'))).toEqual([]);
  });
});
