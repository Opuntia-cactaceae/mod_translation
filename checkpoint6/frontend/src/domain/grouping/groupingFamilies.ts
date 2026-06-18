/* ------------------------------------------------------------------ */
/*  Shared grouping domain — basename family extraction                 */
/*                                                                      */
/*  Single source of truth for extracting basename family prefixes.     */
/*  Replaces duplicate implementations:                                 */
/*    - `genericFileGrouping.ts` → getBasenameFamily()                  */
/*    - `localisationGrouping.ts` → determinePrefix()                   */
/* ------------------------------------------------------------------ */

import { stripLanguageSuffix } from './groupingLanguage';
import { basename } from './groupingPaths';

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
 * Determine the basename family prefix from a filename.
 *
 * Strips extension and language suffix, then takes the first 2
 * underscore-delimited parts.  If fewer than 2 parts, uses the
 * whole stem.
 *
 * This is the canonical implementation that replaces both:
 * - `getBasenameFamily()` in genericFileGrouping.ts
 * - `determinePrefix()` in localisationGrouping.ts
 *
 * Examples:
 *   "wsg_affection_l_english.yml" → "wsg_affection"
 *   "wsg_boss_l_english.yml"     → "wsg_boss"
 *   "ms_est_blue_l_english.yml"  → "ms_est"
 *   "README.md"                  → "README"
 */
export function getBasenameFamily(filename: string): string {
  const name = basename(filename);
  const stem = stripExtension(name);
  const stripped = stripLanguageSuffix(stem);
  const parts = stripped.split('_');
  if (parts.length >= 2) {
    return parts.slice(0, 2).join('_');
  }
  return parts[0];
}
