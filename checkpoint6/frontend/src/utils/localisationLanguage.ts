import { resolveCode, resolveDisplayName } from './languageRegistry';

/* ------------------------------------------------------------------ */
/*  Localisation language detection and filtering utilities            */
/* ------------------------------------------------------------------ */

/**
 * Detect the raw localisation language suffix from a file path.
 *
 * Returns the language suffix (e.g. `"english"`, `"simp_chinese"`)
 * or `null` if the path is not a recognised localisation file.
 */
export function detectLocalisationLanguage(path: string): string | null {
  const match = path.match(/l_(\w+)\.yml$/);
  return match ? match[1] : null;
}

/**
 * Normalise a localisation language to its short application code.
 *
 * Accepts both raw suffixes (`"english"`) and already-normalised codes
 * (`"en"`).  Returns `null` for unknown or null input.
 *
 * Examples:
 *   normaliseLocalisationLanguage("english")      → "en"
 *   normaliseLocalisationLanguage("simp_chinese") → "zh"
 *   normaliseLocalisationLanguage("en")           → "en"
 *   normaliseLocalisationLanguage("zh")           → "zh"
 *   normaliseLocalisationLanguage(null)           → null
 *   normaliseLocalisationLanguage("klingon")      → null
 */
export function normaliseLocalisationLanguage(language: string | null): string | null {
  if (!language) return null;
  return resolveCode(language);
}

/**
 * Filter a list of localisation file paths to only those whose
 * normalised language matches `language` (a short code like `"en"`).
 *
 * Files whose language cannot be detected are excluded.
 */
export function filterFilesByLanguage(paths: string[], language: string): string[] {
  const code = normaliseLocalisationLanguage(language) ?? language;
  return paths.filter(p => {
    const raw = detectLocalisationLanguage(p);
    const norm = normaliseLocalisationLanguage(raw);
    return norm === code;
  });
}

/**
 * Group an array of localisation file paths by their normalised
 * language code.
 *
 * Returns a record keyed by short code (e.g. `"en"`, `"zh"`).
 * Files without a detectable language are grouped under `"unknown"`.
 */
export function groupFilesByLanguage(paths: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const p of paths) {
    const raw = detectLocalisationLanguage(p);
    const lang = normaliseLocalisationLanguage(raw) || 'unknown';
    if (!groups[lang]) {
      groups[lang] = [];
    }
    groups[lang].push(p);
  }
  return groups;
}

/**
 * Return a human-readable display name for a short language code.
 *
 *   displayNameForLanguage("en") → "English"
 *   displayNameForLanguage("zh") → "Simplified Chinese"
 *   displayNameForLanguage("pt-BR") → "Brazilian Portuguese"
 *
 * Falls back to the code itself if no display name is registered.
 */
export function displayNameForLanguage(code: string): string {
  return resolveDisplayName(code);
}

/**
 * Return a compact uppercase badge label for a short language code.
 *
 *   getLanguageBadge("en") → "[EN]"
 *   getLanguageBadge("zh") → "[ZH]"
 *   getLanguageBadge("pt-BR") → "[PT-BR]"
 *
 * Falls back to "[{CODE}]" if the short code is unrecognised.
 */
export function getLanguageBadge(code: string): string {
  return `[${code.toUpperCase()}]`;
}
