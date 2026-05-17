import { describe, it, expect } from 'vitest';
import {
  detectLocalisationLanguage,
  normaliseLocalisationLanguage,
  filterFilesByLanguage,
  groupFilesByLanguage,
  displayNameForLanguage,
  getLanguageBadge,
} from '../localisationLanguage';

/* ================================================================== */
/*  detectLocalisationLanguage                                          */
/* ================================================================== */

describe('detectLocalisationLanguage', () => {
  it('detects english from l_english.yml', () => {
    expect(detectLocalisationLanguage('l_english.yml')).toBe('english');
  });

  it('detects russian from l_russian.yml', () => {
    expect(detectLocalisationLanguage('l_russian.yml')).toBe('russian');
  });

  it('detects german from a nested path', () => {
    expect(detectLocalisationLanguage('nested/path/l_german.yml')).toBe('german');
  });

  it('detects simp_chinese', () => {
    expect(detectLocalisationLanguage('l_simp_chinese.yml')).toBe('simp_chinese');
  });

  it('detects braz_por', () => {
    expect(detectLocalisationLanguage('l_braz_por.yml')).toBe('braz_por');
  });

  it('returns null for .yaml extension', () => {
    expect(detectLocalisationLanguage('l_english.yaml')).toBeNull();
  });

  it('returns null for non-localisation filenames', () => {
    expect(detectLocalisationLanguage('readme.txt')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectLocalisationLanguage('')).toBeNull();
  });
});

/* ================================================================== */
/*  normaliseLocalisationLanguage                                       */
/* ================================================================== */

describe('normaliseLocalisationLanguage', () => {
  it('maps english to en', () => {
    expect(normaliseLocalisationLanguage('english')).toBe('en');
  });

  it('maps simp_chinese to zh', () => {
    expect(normaliseLocalisationLanguage('simp_chinese')).toBe('zh');
  });

  it('maps russian to ru', () => {
    expect(normaliseLocalisationLanguage('russian')).toBe('ru');
  });

  it('maps braz_por to pt-BR', () => {
    expect(normaliseLocalisationLanguage('braz_por')).toBe('pt-BR');
  });

  it('passes through already normalised codes', () => {
    expect(normaliseLocalisationLanguage('en')).toBe('en');
    expect(normaliseLocalisationLanguage('zh')).toBe('zh');
    expect(normaliseLocalisationLanguage('ru')).toBe('ru');
    expect(normaliseLocalisationLanguage('pt-BR')).toBe('pt-BR');
  });

  it('returns null for unknown language', () => {
    expect(normaliseLocalisationLanguage('klingon')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(normaliseLocalisationLanguage(null)).toBeNull();
  });

  it('covers all known Stellaris localisation languages', () => {
    const cases: [string, string][] = [
      ['english', 'en'],
      ['french', 'fr'],
      ['german', 'de'],
      ['russian', 'ru'],
      ['spanish', 'es'],
      ['polish', 'pl'],
      ['japanese', 'ja'],
      ['korean', 'ko'],
      ['simp_chinese', 'zh'],
      ['braz_por', 'pt-BR'],
      ['brazilian', 'pt-BR'],
      ['portuguese', 'pt'],
      ['italian', 'it'],
      ['dutch', 'nl'],
      ['swedish', 'sv'],
      ['czech', 'cs'],
      ['hungarian', 'hu'],
      ['turkish', 'tr'],
      ['arabic', 'ar'],
    ];
    for (const [input, expected] of cases) {
      expect(normaliseLocalisationLanguage(input)).toBe(expected);
    }
  });
});

/* ================================================================== */
/*  filterFilesByLanguage                                               */
/* ================================================================== */

describe('filterFilesByLanguage', () => {
  const paths = [
    '/mod/localisation/english/test_l_english.yml',
    '/mod/localisation/english/other_l_english.yml',
    '/mod/localisation/simp_chinese/test_l_simp_chinese.yml',
    '/mod/localisation/russian/test_l_russian.yml',
  ];

  it('filters English files filtering by short code "en"', () => {
    const filtered = filterFilesByLanguage(paths, 'en');
    expect(filtered).toHaveLength(2);
    expect(filtered[0]).toContain('l_english');
    expect(filtered[1]).toContain('l_english');
  });

  it('filters Chinese files filtering by "zh"', () => {
    const filtered = filterFilesByLanguage(paths, 'zh');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toContain('l_simp_chinese');
  });

  it('filters Russian files filtering by "ru"', () => {
    const filtered = filterFilesByLanguage(paths, 'ru');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toContain('l_russian');
  });

  it('returns empty array for non-existent language', () => {
    expect(filterFilesByLanguage(paths, 'fr')).toEqual([]);
  });

  it('returns empty array for empty paths', () => {
    expect(filterFilesByLanguage([], 'en')).toEqual([]);
  });

  it('filters correctly when paths have no detectable language', () => {
    const mixed = [
      '/mod/l_english.yml',
      '/mod/readme.txt',
      '/mod/notes.md',
    ];
    const filtered = filterFilesByLanguage(mixed, 'en');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toContain('l_english');
  });

  it('accepts raw language name as filter argument', () => {
    const filtered = filterFilesByLanguage(paths, 'en');
    expect(filtered).toHaveLength(2);
  });
});

/* ================================================================== */
/*  groupFilesByLanguage                                                */
/* ================================================================== */

describe('groupFilesByLanguage', () => {
  it('groups mixed paths by normalised language', () => {
    const paths = [
      '/mod/a_l_english.yml',
      '/mod/b_l_english.yml',
      '/mod/c_l_simp_chinese.yml',
      '/mod/d_l_russian.yml',
    ];
    const groups = groupFilesByLanguage(paths);
    expect(Object.keys(groups).sort()).toEqual(['en', 'ru', 'zh']);
    expect(groups['en']).toHaveLength(2);
    expect(groups['zh']).toHaveLength(1);
    expect(groups['ru']).toHaveLength(1);
  });

  it('handles empty paths', () => {
    expect(groupFilesByLanguage([])).toEqual({});
  });

  it('groups paths without detectable language under "unknown"', () => {
    const result = groupFilesByLanguage(['/mod/readme.txt']);
    expect(result['unknown']).toHaveLength(1);
  });

  it('handles braz_por mapping correctly', () => {
    const paths = [
      '/mod/l_braz_por.yml',
      '/mod/l_english.yml',
    ];
    const groups = groupFilesByLanguage(paths);
    expect(groups['pt-BR']).toHaveLength(1);
    expect(groups['pt-BR'][0]).toContain('l_braz_por');
    expect(groups['en']).toHaveLength(1);
  });

  it('groups multiple files of same language together', () => {
    const paths = [
      '/mod/a_l_english.yml',
      '/mod/b_l_english.yml',
      '/mod/c_l_english.yml',
      '/mod/d_l_french.yml',
    ];
    const groups = groupFilesByLanguage(paths);
    expect(groups['en']).toHaveLength(3);
    expect(groups['fr']).toHaveLength(1);
  });
});

/* ================================================================== */
/*  displayNameForLanguage                                              */
/* ================================================================== */

describe('displayNameForLanguage', () => {
  it('returns full name for "en"', () => {
    expect(displayNameForLanguage('en')).toBe('English');
  });

  it('returns full name for "zh"', () => {
    expect(displayNameForLanguage('zh')).toBe('Simplified Chinese');
  });

  it('returns full name for "pt-BR"', () => {
    expect(displayNameForLanguage('pt-BR')).toBe('Brazilian Portuguese');
  });

  it('falls back to the code itself for unknown codes', () => {
    expect(displayNameForLanguage('klingon')).toBe('klingon');
  });
});

/* ================================================================== */
/*  getLanguageBadge                                                     */
/* ================================================================== */

describe('getLanguageBadge', () => {
  it('returns [EN] for en', () => {
    expect(getLanguageBadge('en')).toBe('[EN]');
  });

  it('returns [ZH] for zh', () => {
    expect(getLanguageBadge('zh')).toBe('[ZH]');
  });

  it('returns [RU] for ru', () => {
    expect(getLanguageBadge('ru')).toBe('[RU]');
  });

  it('returns [PT-BR] for pt-BR', () => {
    expect(getLanguageBadge('pt-BR')).toBe('[PT-BR]');
  });

  it('uppercases unknown codes', () => {
    expect(getLanguageBadge('klingon')).toBe('[KLINGON]');
  });
});
