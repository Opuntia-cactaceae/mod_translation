/* ------------------------------------------------------------------ */
/*  Mod deduplication helper                                            */
/* ------------------------------------------------------------------ */

import type { ModInfoSchema } from '../api/types';

/**
 * Deduplicate a list of mods, keeping the first occurrence.
 *
 * Dedup key priority (first non-empty match wins):
 *   1. `path` (filesystem path is inherently unique)
 *   2. `installed_path` (fallback when path is empty)
 *   3. `mod_id` (last resort — can collide across different mods)
 *   4. fallback: `name + version + path`
 *
 * NOTE: mod_id was historically the primary key, but two mods on disk can
 * share the same mod_id (e.g. Steam Workshop + local copy).  The filesystem
 * path is the only collision-free stable identity.
 */
export function dedupeMods(mods: ModInfoSchema[]): ModInfoSchema[] {
  const seen = new Set<string>();
  const result: ModInfoSchema[] = [];

  for (const mod of mods) {
    const key =
      mod.path ||
      mod.installed_path ||
      mod.mod_id ||
      `${mod.name}|${mod.version}|${mod.path}`;

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(mod);
  }

  return result;
}
