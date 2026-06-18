/* ------------------------------------------------------------------ */
/*  Stellaris-specific localisation file grouping                     */
/*                                                                      */
/*  Uses shared utilities from the grouping domain for:                 */
/*    - getBasenameFamily (replaces old determinePrefix)                */
/*    - detectStellarisLanguage (replaces old detectLanguageFromPath)   */
/*                                                                      */
/*  Public API is unchanged.                                            */
/* ------------------------------------------------------------------ */

import { basename } from '../domain/grouping/groupingPaths';
import { getBasenameFamily } from '../domain/grouping/groupingFamilies';
import { detectStellarisLanguage } from '../domain/grouping/groupingLanguage';

export type LocalisationGroup = {
  id: string;
  label: string;
  files: string[];
  languages: string[];
};

/**
 * Detect the language code from a localisation file path.
 * Returns the language part (e.g. "english", "simp_chinese") or null.
 *
 * Delegates to shared detectStellarisLanguage.
 */
export function detectLanguageFromPath(path: string): string | null {
  return detectStellarisLanguage(path);
}

/**
 * Group an array of localisation file paths into LocalisationGroup[].
 *
 * Algorithm (unchanged):
 * 1. Extract basename without extension.
 * 2. Strip the language suffix (everything from the last `_l_`).
 * 3. Determine the group prefix via shared getBasenameFamily
 *    (first 2 underscore-delimited parts of the stripped stem).
 * 4. Collect files sharing the same prefix into one group.
 * 5. Sort groups by label, and files within each group by basename.
 */
export function groupLocalisationFiles(paths: string[]): LocalisationGroup[] {
  const groups = new Map<string, { files: string[]; languages: Set<string> }>();

  for (const path of paths) {
    const name = basename(path);
    const stem = name.replace(/\.yml$/, '');

    // Detect language
    const language = detectLanguageFromPath(path) || 'unknown';

    // Determine group prefix using shared getBasenameFamily.
    // getBasenameFamily strips extension + lang suffix, then takes first 2 parts.
    // We pass the full path so it handles stripping internally.
    const prefix = getBasenameFamily(path);

    // Accumulate into groups
    if (!groups.has(prefix)) {
      groups.set(prefix, { files: [], languages: new Set() });
    }
    const group = groups.get(prefix)!;
    group.files.push(path);
    group.languages.add(language);
  }

  // Convert map to array with labels, then sort
  const result: LocalisationGroup[] = [];

  for (const [prefix, data] of groups) {
    // Sort files within group by basename
    data.files.sort((a, b) => {
      const aName = basename(a);
      const bName = basename(b);
      return aName.localeCompare(bName);
    });

    const label =
      data.files.length > 1
        ? `${prefix}_*`
        : basename(data.files[0]);

    result.push({
      id: prefix,
      label,
      files: data.files,
      languages: Array.from(data.languages).sort(),
    });
  }

  // Sort groups by label
  result.sort((a, b) => a.label.localeCompare(b.label));

  return result;
}
