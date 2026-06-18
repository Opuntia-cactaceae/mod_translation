import { describe, it, expect } from 'vitest';
import { getBasenameFamily } from '../groupingFamilies';

/* ================================================================== */
/*  getBasenameFamily                                                   */
/* ================================================================== */

describe('getBasenameFamily (shared)', () => {
  it('returns first 2 underscore-delimited parts for Stellaris filenames', () => {
    expect(getBasenameFamily('wsg_affection_l_english.yml')).toBe('wsg_affection');
    expect(getBasenameFamily('wsg_boss_l_english.yml')).toBe('wsg_boss');
    expect(getBasenameFamily('wsg_common_l_english.yml')).toBe('wsg_common');
  });

  it('handles single-part names', () => {
    expect(getBasenameFamily('README.md')).toBe('README');
    expect(getBasenameFamily('config.json')).toBe('config');
  });

  it('returns whole stem for short names', () => {
    expect(getBasenameFamily('data.yml')).toBe('data');
  });

  it('strips language suffix before computing family', () => {
    expect(getBasenameFamily('ms_est_blue_l_english.yml')).toBe('ms_est');
    expect(getBasenameFamily('ms_ldr_iron_l_russian.yml')).toBe('ms_ldr');
    expect(getBasenameFamily('ms_civics_l_english.yml')).toBe('ms_civics');
  });

  it('handles compound language suffixes after stripping', () => {
    expect(getBasenameFamily('wsg_affection_trait_l_english.yml')).toBe('wsg_affection');
  });
});

/* ================================================================== */
/*  Parity with old determinePrefix from localisationGrouping.ts        */
/* ================================================================== */

describe('getBasenameFamily parity with old determinePrefix', () => {
  // Old determinePrefix from localisationGrouping.ts:
  // function determinePrefix(stripped: string): string {
  //   const parts = stripped.split('_');
  //   if (parts.length >= 2) return parts.slice(0, 2).join('_');
  //   return parts[0];
  // }
  //
  // getBasenameFamily strips extension + lang suffix first, then does the same.
  // We test that for real filenames, the two-stage process (strip + prefix)
  // produces the same results as getBasenameFamily.

  const testCases = [
    // (stripped stem, expected prefix)
    { filename: 'ms_est_blue_l_english.yml', expected: 'ms_est' },
    { filename: 'ms_ldr_iron_l_english.yml', expected: 'ms_ldr' },
    { filename: 'ms_civics_l_english.yml', expected: 'ms_civics' },
    { filename: 'ms_planet_buildings_l_english.yml', expected: 'ms_planet' },
    { filename: 'something_l_english.yml', expected: 'something' },
    { filename: 'wsg_affection_l_english.yml', expected: 'wsg_affection' },
    { filename: 'wsg_boss_l_russian.yml', expected: 'wsg_boss' },
    { filename: 'single.yml', expected: 'single' },
  ];

  // Simulate the old two-step process:
  // 1. strip .yml
  // 2. strip _l_english (everything from last _l_)
  // 3. determinePrefix (first 2 underscore parts)
  const oldDeterminePrefix = (stripped: string): string => {
    const parts = stripped.split('_');
    if (parts.length >= 2) return parts.slice(0, 2).join('_');
    return parts[0];
  };

  const oldStripLanguageSuffix = (stem: string): string => {
    const idx = stem.lastIndexOf('_l_');
    return idx !== -1 ? stem.substring(0, idx) : stem;
  };

  for (const { filename, expected } of testCases) {
    it(`produces correct prefix for ${filename}`, () => {
      // Old process
      const stem = filename.replace(/\.yml$/, '');
      const stripped = oldStripLanguageSuffix(stem);
      const oldResult = oldDeterminePrefix(stripped);

      // New process
      const newResult = getBasenameFamily(filename);

      // Both should match the expected value
      expect(newResult).toBe(expected);

      // getBasenameFamily should produce the same as old two-step process
      expect(newResult).toBe(oldResult);
    });
  }
});

/* ================================================================== */
/*  Compatibility with old getBasenameFamily from genericFileGrouping   */
/* ================================================================== */

describe('getBasenameFamily compatibility with existing tests', () => {
  it('passes all existing test cases from genericFileGrouping.test.ts', () => {
    expect(getBasenameFamily('wsg_affection_l_english.yml')).toBe('wsg_affection');
    expect(getBasenameFamily('wsg_boss_l_english.yml')).toBe('wsg_boss');
    expect(getBasenameFamily('wsg_common_l_english.yml')).toBe('wsg_common');
    expect(getBasenameFamily('README.md')).toBe('README');
    expect(getBasenameFamily('config.json')).toBe('config');
    expect(getBasenameFamily('data.yml')).toBe('data');
  });
});
