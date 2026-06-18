import { describe, it, expect } from 'vitest';
import {
  LANGUAGES,
  getLanguage,
  resolveCode,
  resolveDisplayName,
  resolveStellarisToken,
  resolveCodeFromStellarisToken,
  getLanguageSelectOptions,
} from '../languageRegistry';

/* ================================================================== */
/*  Registry basics                                                     */
/* ================================================================== */

describe('languageRegistry', () => {
  describe('LANGUAGES', () => {
    it('contains all expected languages', () => {
      const codes = LANGUAGES.map(e => e.code);
      expect(codes).toContain('en');
      expect(codes).toContain('ru');
      expect(codes).toContain('ja');
      expect(codes).toContain('ko');
      expect(codes).toContain('zh');
      expect(codes).toContain('pt-BR');
      expect(codes).toContain('hi');
    });

    it('has at least 28 entries (superset of old maps)', () => {
      expect(LANGUAGES.length).toBeGreaterThanOrEqual(28);
    });

    it('every entry has all required fields', () => {
      for (const entry of LANGUAGES) {
        expect(entry.code).toBeTruthy();
        expect(entry.displayName).toBeTruthy();
        expect(entry.nativeName).toBeTruthy();
        expect(entry.stellarisToken).toBeTruthy();
        expect(entry.aliases.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('no duplicate codes', () => {
      const codes = LANGUAGES.map(e => e.code);
      expect(new Set(codes).size).toBe(codes.length);
    });
  });

  /* ================================================================ */
  /*  getLanguage                                                       */
  /* ================================================================ */

  describe('getLanguage', () => {
    it('returns entry by canonical code', () => {
      const entry = getLanguage('ru');
      expect(entry).toBeDefined();
      expect(entry!.code).toBe('ru');
      expect(entry!.displayName).toBe('Russian');
      expect(entry!.stellarisToken).toBe('russian');
    });

    it('returns undefined for unknown code', () => {
      expect(getLanguage('klingon')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(getLanguage('')).toBeUndefined();
    });
  });

  /* ================================================================ */
  /*  resolveCode                                                       */
  /* ================================================================ */

  describe('resolveCode', () => {
    it('resolves canonical code to itself', () => {
      expect(resolveCode('ru')).toBe('ru');
      expect(resolveCode('en')).toBe('en');
    });

    it('resolves Stellaris token to canonical code', () => {
      expect(resolveCode('russian')).toBe('ru');
      expect(resolveCode('english')).toBe('en');
      expect(resolveCode('simp_chinese')).toBe('zh');
    });

    it('resolves case-insensitively', () => {
      expect(resolveCode('RuSSian')).toBe('ru');
      expect(resolveCode('RUSSIAN')).toBe('ru');
      expect(resolveCode('RUS')).toBe('ru');
    });

    it('resolves brazilian aliases to pt-BR', () => {
      expect(resolveCode('braz_por')).toBe('pt-BR');
      expect(resolveCode('brazilian')).toBe('pt-BR');
      expect(resolveCode('pt-BR')).toBe('pt-BR');
    });

    it('returns null for unknown code', () => {
      expect(resolveCode('klingon')).toBeNull();
    });
  });

  /* ================================================================ */
  /*  resolveDisplayName                                                */
  /* ================================================================ */

  describe('resolveDisplayName', () => {
    it('returns display name for known code', () => {
      expect(resolveDisplayName('en')).toBe('English');
      expect(resolveDisplayName('ru')).toBe('Russian');
      expect(resolveDisplayName('ja')).toBe('Japanese');
    });

    it('returns "Brazilian Portuguese" for pt-BR', () => {
      expect(resolveDisplayName('pt-BR')).toBe('Brazilian Portuguese');
    });

    it('falls back to code for unknown', () => {
      expect(resolveDisplayName('klingon')).toBe('klingon');
    });

    it('falls back to empty string', () => {
      expect(resolveDisplayName('')).toBe('');
    });
  });

  /* ================================================================ */
  /*  resolveStellarisToken                                             */
  /* ================================================================ */

  describe('resolveStellarisToken', () => {
    it('returns Stellaris token for known code', () => {
      expect(resolveStellarisToken('ru')).toBe('russian');
      expect(resolveStellarisToken('en')).toBe('english');
      expect(resolveStellarisToken('ja')).toBe('japanese');
    });

    it('returns braz_por for pt-BR', () => {
      expect(resolveStellarisToken('pt-BR')).toBe('braz_por');
    });

    it('returns simp_chinese for zh', () => {
      expect(resolveStellarisToken('zh')).toBe('simp_chinese');
    });

    it('returns null for unknown code', () => {
      expect(resolveStellarisToken('klingon')).toBeNull();
    });
  });

  /* ================================================================ */
  /*  resolveCodeFromStellarisToken                                     */
  /* ================================================================ */

  describe('resolveCodeFromStellarisToken', () => {
    it('resolves Stellaris token to canonical code', () => {
      expect(resolveCodeFromStellarisToken('russian')).toBe('ru');
      expect(resolveCodeFromStellarisToken('english')).toBe('en');
    });

    it('resolves braz_por to pt-BR', () => {
      expect(resolveCodeFromStellarisToken('braz_por')).toBe('pt-BR');
    });

    it('resolves simp_chinese to zh', () => {
      expect(resolveCodeFromStellarisToken('simp_chinese')).toBe('zh');
    });

    it('returns null for unknown token', () => {
      expect(resolveCodeFromStellarisToken('klingon')).toBeNull();
    });
  });

  /* ================================================================ */
  /*  getLanguageSelectOptions                                          */
  /* ================================================================ */

  describe('getLanguageSelectOptions', () => {
    it('returns all languages as options', () => {
      const options = getLanguageSelectOptions();
      expect(options.length).toBe(LANGUAGES.length);
    });

    it('each option has value=code and label="DisplayName (code)"', () => {
      const options = getLanguageSelectOptions();
      for (const option of options) {
        expect(option.value).toBeTruthy();
        expect(option.label).toMatch(/.+ \(.+\)/);
      }
    });

    it('includes English and Russian', () => {
      const options = getLanguageSelectOptions();
      const eng = options.find(o => o.value === 'en');
      expect(eng).toBeDefined();
      expect(eng!.label).toBe('English (en)');

      const rus = options.find(o => o.value === 'ru');
      expect(rus).toBeDefined();
      expect(rus!.label).toBe('Russian (ru)');
    });
  });
});
