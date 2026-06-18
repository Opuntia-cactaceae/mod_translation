import { describe, it, expect } from 'vitest';
import {
  toUnifiedMode,
  fromUnifiedForGeneric,
  fromUnifiedForPairing,
  groupingModeLabel,
  allGroupingModes,
} from '../groupingAdapters';
import type { GroupingMode } from '../groupingTypes';

/* ================================================================== */
/*  toUnifiedMode                                                      */
/* ================================================================== */

describe('toUnifiedMode', () => {
  it('converts generic legacy modes to unified', () => {
    expect(toUnifiedMode('folder')).toBe('directory');
    expect(toUnifiedMode('filename')).toBe('filename');
    expect(toUnifiedMode('language_marker')).toBe('language');
    expect(toUnifiedMode('smart')).toBe('smart');
  });

  it('converts pairing workspace modes to unified', () => {
    expect(toUnifiedMode('by_directory')).toBe('directory');
    expect(toUnifiedMode('by_filename')).toBe('filename');
    expect(toUnifiedMode('by_language_marker')).toBe('language');
    expect(toUnifiedMode('flat')).toBe('flat');
  });

  it('falls back to smart for unknown modes', () => {
    expect(toUnifiedMode('unknown')).toBe('smart');
    expect(toUnifiedMode('invalid')).toBe('smart');
    expect(toUnifiedMode('')).toBe('smart');
  });

  it('is idempotent for already-unified modes via generic mapping', () => {
    // These values happen to match after the generic mapping
    expect(toUnifiedMode('smart')).toBe('smart');
    expect(toUnifiedMode('filename')).toBe('filename');
  });
});

/* ================================================================== */
/*  fromUnifiedForGeneric                                              */
/* ================================================================== */

describe('fromUnifiedForGeneric', () => {
  it('converts unified modes to generic legacy strings', () => {
    expect(fromUnifiedForGeneric('directory')).toBe('folder');
    expect(fromUnifiedForGeneric('filename')).toBe('filename');
    expect(fromUnifiedForGeneric('language')).toBe('language_marker');
    expect(fromUnifiedForGeneric('smart')).toBe('smart');
    expect(fromUnifiedForGeneric('flat')).toBe('flat');
  });

  it('falls back to smart for unknown modes', () => {
    // @ts-expect-error testing invalid input
    expect(fromUnifiedForGeneric('unknown')).toBe('smart');
  });
});

/* ================================================================== */
/*  fromUnifiedForPairing                                              */
/* ================================================================== */

describe('fromUnifiedForPairing', () => {
  it('converts unified modes to pairing workspace strings', () => {
    expect(fromUnifiedForPairing('flat')).toBe('flat');
    expect(fromUnifiedForPairing('directory')).toBe('by_directory');
    expect(fromUnifiedForPairing('filename')).toBe('by_filename');
    expect(fromUnifiedForPairing('language')).toBe('by_language_marker');
    expect(fromUnifiedForPairing('smart')).toBe('by_filename'); // smart maps to by_filename for pairing
  });

  it('falls back to by_filename for unknown modes', () => {
    // @ts-expect-error testing invalid input
    expect(fromUnifiedForPairing('unknown')).toBe('by_filename');
  });
});

/* ================================================================== */
/*  Round-trip tests                                                   */
/* ================================================================== */

describe('round-trip conversions', () => {
  it('generic → unified → generic preserves meaning for known modes', () => {
    const genericModes = ['folder', 'filename', 'language_marker', 'smart'];
    for (const mode of genericModes) {
      const unified = toUnifiedMode(mode);
      const back = fromUnifiedForGeneric(unified);
      expect(back).toBe(mode);
    }
  });

  it('pairing → unified → pairing preserves meaning for known modes', () => {
    const pairingModes = ['flat', 'by_directory', 'by_filename', 'by_language_marker'];
    for (const mode of pairingModes) {
      const unified = toUnifiedMode(mode);
      const back = fromUnifiedForPairing(unified);
      expect(back).toBe(mode);
    }
  });
});

/* ================================================================== */
/*  groupingModeLabel                                                  */
/* ================================================================== */

describe('groupingModeLabel', () => {
  it('returns human-readable labels for all modes', () => {
    expect(groupingModeLabel('flat')).toBe('Flat (no grouping)');
    expect(groupingModeLabel('directory')).toBe('Directory');
    expect(groupingModeLabel('filename')).toBe('File name');
    expect(groupingModeLabel('language')).toBe('Language marker');
    expect(groupingModeLabel('smart')).toBe('Smart (filename families)');
  });

  it('returns a label for every mode in allGroupingModes', () => {
    const modes = allGroupingModes();
    for (const mode of modes) {
      expect(groupingModeLabel(mode)).toBeTruthy();
      expect(groupingModeLabel(mode).length).toBeGreaterThan(0);
    }
  });
});

/* ================================================================== */
/*  allGroupingModes                                                   */
/* ================================================================== */

describe('allGroupingModes', () => {
  it('returns all 5 modes in display order', () => {
    expect(allGroupingModes()).toEqual(['flat', 'directory', 'filename', 'language', 'smart']);
  });
});
