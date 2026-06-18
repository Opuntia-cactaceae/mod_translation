import { describe, it, expect } from 'vitest';
import {
  detectLanguageMarker,
  stripLanguageSuffix,
  detectStellarisLanguage,
} from '../groupingLanguage';

/* ================================================================== */
/*  detectLanguageMarker                                                */
/* ================================================================== */

describe('detectLanguageMarker (shared)', () => {
  it('returns null for a filename with no language marker', () => {
    expect(detectLanguageMarker('readme.txt')).toBeNull();
    expect(detectLanguageMarker('settings.json')).toBeNull();
    expect(detectLanguageMarker('main.py')).toBeNull();
  });

  it('detects Stellaris-style _l_english marker', () => {
    expect(detectLanguageMarker('wsg_affection_l_english.yml')).toBe('english');
    expect(detectLanguageMarker('wsg_boss_l_russian.yml')).toBe('russian');
    expect(detectLanguageMarker('file_l_simp_chinese.yml')).toBe('simp_chinese');
  });

  it('detects ISO suffix language marker (_en, _ru)', () => {
    expect(detectLanguageMarker('strings_en.json')).toBe('en');
    expect(detectLanguageMarker('strings_ru.json')).toBe('ru');
    expect(detectLanguageMarker('localisation_de.yml')).toBe('de');
  });

  it('detects ISO prefix language marker (en_, ru_)', () => {
    expect(detectLanguageMarker('en_settings.yml')).toBe('en');
    expect(detectLanguageMarker('ru_dialog.txt')).toBe('ru');
    expect(detectLanguageMarker('fr_strings.json')).toBe('fr');
  });

  it('does not detect unknown tokens', () => {
    expect(detectLanguageMarker('foo_bar_baz.yml')).toBeNull();
    expect(detectLanguageMarker('xy_settings.json')).toBeNull();
  });

  it('is case-insensitive for Stellaris-style markers', () => {
    expect(detectLanguageMarker('file_l_ENGLISH.yml')).toBe('english');
    expect(detectLanguageMarker('file_l_Russian.yml')).toBe('russian');
    expect(detectLanguageMarker('file_l_English.yml')).toBe('english');
  });

  it('is case-insensitive for ISO suffix markers', () => {
    expect(detectLanguageMarker('strings_EN.json')).toBe('en');
    expect(detectLanguageMarker('strings_RU.yml')).toBe('ru');
  });

  it('supports compound regional suffixes (pt_br, en_us, zh_cn)', () => {
    expect(detectLanguageMarker('strings_pt_br.json')).toBe('pt');
    expect(detectLanguageMarker('strings_en_us.yml')).toBe('en');
    expect(detectLanguageMarker('strings_zh_cn.yml')).toBe('zh');
  });

  it('supports bare language filenames (en.json, de.yml, ru.txt)', () => {
    expect(detectLanguageMarker('en.json')).toBe('en');
    expect(detectLanguageMarker('de.yml')).toBe('de');
    expect(detectLanguageMarker('ru.txt')).toBe('ru');
    expect(detectLanguageMarker('fr.json')).toBe('fr');
  });

  it('reduces false positives for very short prefix + _xx suffix', () => {
    expect(detectLanguageMarker('a_en.txt')).toBeNull();
    expect(detectLanguageMarker('x_ru.txt')).toBeNull();
  });

  it('allows ISO suffix detection with meaningful prefix length', () => {
    expect(detectLanguageMarker('ab_en.txt')).toBe('en');
    expect(detectLanguageMarker('str_ru.yml')).toBe('ru');
  });
});

/* ================================================================== */
/*  stripLanguageSuffix                                                */
/* ================================================================== */

describe('stripLanguageSuffix (shared)', () => {
  it('strips Stellaris-style _l_english suffix', () => {
    expect(stripLanguageSuffix('wsg_affection_l_english')).toBe('wsg_affection');
    expect(stripLanguageSuffix('wsg_boss_l_russian')).toBe('wsg_boss');
  });

  it('strips ISO suffix _en, _ru', () => {
    expect(stripLanguageSuffix('strings_en')).toBe('strings');
    expect(stripLanguageSuffix('config_de')).toBe('config');
  });

  it('returns unchanged when no suffix is found', () => {
    expect(stripLanguageSuffix('wsg_affection')).toBe('wsg_affection');
    expect(stripLanguageSuffix('readme')).toBe('readme');
    expect(stripLanguageSuffix('main_file')).toBe('main_file');
  });
});

/* ================================================================== */
/*  detectStellarisLanguage                                             */
/* ================================================================== */

describe('detectStellarisLanguage', () => {
  it('detects language from Stellaris localisation path', () => {
    expect(detectStellarisLanguage('wsg_affection_l_english.yml')).toBe('english');
    expect(detectStellarisLanguage('wsg_boss_l_russian.yml')).toBe('russian');
    expect(detectStellarisLanguage('file_l_simp_chinese.yml')).toBe('simp_chinese');
    expect(detectStellarisLanguage('file_l_braz_por.yml')).toBe('braz_por');
  });

  it('returns null for non-Stellaris paths', () => {
    expect(detectStellarisLanguage('strings_en.json')).toBeNull();
    expect(detectStellarisLanguage('readme.txt')).toBeNull();
    expect(detectStellarisLanguage('settings.yml')).toBeNull();
  });

  it('matches only .yml extension', () => {
    expect(detectStellarisLanguage('file_l_english.txt')).toBeNull();
  });
});

/* ================================================================== */
/*  Compatibility with old detectLanguageFromPath                       */
/* ================================================================== */

describe('detectStellarisLanguage compatibility with old detectLanguageFromPath', () => {
  it('produces identical results to the old localisationGrouping implementation', () => {
    const testCases = [
      'wsg_affection_l_english.yml',
      'wsg_boss_l_russian.yml',
      'file_l_simp_chinese.yml',
      'file_l_braz_por.yml',
      'file_l_english.yml',
      'file_l_french.yml',
      'file_l_german.yml',
      'file_l_polish.yml',
      'file_l_spanish.yml',
    ];

    // Old implementation from localisationGrouping.ts:
    const oldDetect = (path: string) => {
      const match = path.match(/l_(\w+)\.yml$/);
      return match ? match[1] : null;
    };

    for (const path of testCases) {
      expect(detectStellarisLanguage(path)).toBe(oldDetect(path));
    }
  });
});
