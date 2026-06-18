/* ------------------------------------------------------------------ */
/*  Shared grouping domain — language detection utilities               */
/*                                                                      */
/*  Single source of truth for detecting language markers in filenames  */
/*  and stripping language suffixes.  Functions here replace the        */
/*  duplicate/inconsistent implementations previously scattered across  */
/*  genericFileGrouping.ts and localisationGrouping.ts.                 */
/* ------------------------------------------------------------------ */

import { basename } from './groupingPaths';

/* ---- Known language tokens for generic detection ---- */

const LANGUAGE_TOKENS = new Set([
  'english', 'russian', 'french', 'german', 'spanish', 'italian',
  'portuguese', 'polish', 'japanese', 'korean', 'chinese',
  'simp_chinese', 'braz_por', 'turkish', 'dutch', 'swedish',
  'czech', 'hungarian', 'romanian', 'ukrainian',
]);

const ISO_LANGUAGE_CODES = new Set([
  'en', 'ru', 'fr', 'de', 'es', 'it', 'pt', 'pl', 'ja', 'ko',
  'zh', 'tr', 'nl', 'sv', 'cs', 'hu', 'ro', 'uk',
]);

/** Minimum prefix length before an `_xx` ISO suffix is considered a language marker. */
const MIN_ISO_PREFIX_LENGTH = 2;

/* ---- Internal helpers ---- */

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/* ---- Public API ---- */

/**
 * Detect a language marker in a filename.
 *
 * Strategy:
 * 1. Stellaris-style: `_l_english`, `_l_russian`, etc. (after `_l_`, capture word chars)
 * 2. Bare language filename: `en.json`, `de.yml`, `ru.txt`
 * 3. Compound ISO suffix: filename ends with `_pt_br`, `_en_us`, `_zh_cn` before extension
 * 4. Simple ISO suffix: filename ends with `_en`, `_ru`, `_de` before extension (with min prefix length)
 * 5. ISO prefix: filename starts with `en_`, `ru_`, `de_`
 *
 * Returns the detected language token (e.g. "english", "en", "ru") or null.
 * The returned token is always lowercase.
 */
export function detectLanguageMarker(filename: string): string | null {
  const name = basename(filename);

  // 1. Stellaris-style: _l_{token} (case-insensitive)
  const stellarisMatch = name.match(/_l_(\w+)(?:\.[a-z0-9]+)?$/i);
  if (stellarisMatch) {
    const lang = stellarisMatch[1].toLowerCase();
    if (LANGUAGE_TOKENS.has(lang)) {
      return lang;
    }
  }

  const stem = stripExtension(name);

  // 2. Bare language filename: stem is exactly a 2-letter ISO code
  if (stem.length === 2 && ISO_LANGUAGE_CODES.has(stem.toLowerCase())) {
    return stem.toLowerCase();
  }

  // 3. Compound ISO suffix: _{code}_{code} (case-insensitive)
  const compoundMatch = stem.match(/_([a-zA-Z]{2})_([a-zA-Z]{2})$/);
  if (compoundMatch) {
    const lang = compoundMatch[1].toLowerCase();
    if (ISO_LANGUAGE_CODES.has(lang)) {
      return lang;
    }
  }

  // 4. Simple ISO suffix: _{code}.{ext} (case-insensitive, with min prefix length)
  const suffixMatch = stem.match(/^(.{2,})_([a-zA-Z]{2})$/);
  if (suffixMatch && suffixMatch[1].length >= MIN_ISO_PREFIX_LENGTH) {
    const lang = suffixMatch[2].toLowerCase();
    if (ISO_LANGUAGE_CODES.has(lang)) {
      return lang;
    }
  }

  // 5. ISO prefix: {code}_ (case-insensitive)
  const prefixMatch = name.match(/^([a-zA-Z]{2})_/);
  if (prefixMatch) {
    const lang = prefixMatch[1].toLowerCase();
    if (ISO_LANGUAGE_CODES.has(lang)) {
      return lang;
    }
  }

  return null;
}

/**
 * Strip a known language suffix from a filename stem.
 *
 * Handles:
 * - Stellaris-style: `_l_english` → stripped
 * - Generic ISO suffix: `_en` → stripped
 */
export function stripLanguageSuffix(stem: string): string {
  // Try Stellaris-style _l_{token} (case-insensitive)
  const stellarisMatch = stem.match(/^(.*)_l_(\w+)$/i);
  if (stellarisMatch) {
    const lang = stellarisMatch[2].toLowerCase();
    if (LANGUAGE_TOKENS.has(lang)) {
      return stellarisMatch[1];
    }
  }

  // Try generic ISO suffix: _{code} (case-insensitive, with min prefix length)
  const isoMatch = stem.match(/^(.{2,})_([a-zA-Z]{2})$/);
  if (isoMatch) {
    const lang = isoMatch[2].toLowerCase();
    if (ISO_LANGUAGE_CODES.has(lang) && isoMatch[1].length >= MIN_ISO_PREFIX_LENGTH) {
      return isoMatch[1];
    }
  }

  return stem;
}

/**
 * Detect Stellaris language from a localisation file path.
 * Returns the language part (e.g. "english", "simp_chinese") or null.
 *
 * This is the shared replacement for `localisationGrouping.ts`'s
 * `detectLanguageFromPath()`.
 */
export function detectStellarisLanguage(path: string): string | null {
  const match = path.match(/l_(\w+)\.yml$/);
  return match ? match[1] : null;
}
