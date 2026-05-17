export type LocalisationGroup = {
  id: string;
  label: string;
  files: string[];
  languages: string[];
};

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

/**
 * Strip the language suffix from a localisation filename stem.
 * E.g. "ms_est_blue_l_english" -> "ms_est_blue"
 *
 * Strategy: find the LAST occurrence of "_l_" in the stem and remove
 * everything from there to the end. This handles all known language
 * suffixes (_l_english, _l_russian, _l_braz_por, _l_simp_chinese, etc.)
 * without needing an explicit list.
 */
function stripLanguageSuffix(stem: string): string {
  const idx = stem.lastIndexOf('_l_');
  if (idx !== -1) {
    return stem.substring(0, idx);
  }
  return stem;
}

/**
 * Detect the language code from a localisation file path.
 * Returns the language part (e.g. "english", "simp_chinese") or null.
 */
export function detectLanguageFromPath(path: string): string | null {
  const match = path.match(/l_(\w+)\.yml$/);
  return match ? match[1] : null;
}

/**
 * Determine the group prefix from a stripped stem.
 *
 * Rule: take the first 2 underscore-delimited parts.
 * If the stem has fewer than 2 parts, use the whole stem.
 *
 * Examples:
 *   "ms_est_blue"       -> "ms_est"
 *   "ms_ldr_iron"       -> "ms_ldr"
 *   "ms_civics"         -> "ms_civics"
 *   "ms_planet_buildings" -> "ms_planet"
 *   "something"         -> "something"
 */
function determinePrefix(stripped: string): string {
  const parts = stripped.split('_');
  if (parts.length >= 2) {
    return parts.slice(0, 2).join('_');
  }
  return parts[0];
}

/**
 * Group an array of localisation file paths into LocalisationGroup[].
 *
 * Grouping algorithm:
 * 1. Extract basename without extension.
 * 2. Strip the language suffix (everything from the last `_l_`).
 * 3. Determine the group prefix (first 2 underscore-delimited parts).
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

    // Strip language suffix to get the meaningful stem
    const stripped = stripLanguageSuffix(stem);

    // Determine group prefix
    const prefix = determinePrefix(stripped);

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
