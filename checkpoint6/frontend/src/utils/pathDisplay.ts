/* ------------------------------------------------------------------ */
/*  Path display utilities for compact file chip labels               */
/* ------------------------------------------------------------------ */

/**
 * Find the longest common path prefix (by segment, not by character)
 * across an array of absolute or relative paths.
 *
 * Examples:
 *   commonPathPrefix(['/a/b/c/f1.yml', '/a/b/d/f2.yml'])  → '/a/b'
 *   commonPathPrefix(['/a/b/c/f1.yml'])                    → '/a/b/c'
 *   commonPathPrefix([])                                   → ''
 *   commonPathPrefix(['/a/b/c/f1.yml', '/x/y/z/f2.yml'])   → ''
 */
export function commonPathPrefix(paths: string[]): string {
  if (paths.length === 0) return '';

  const segments = paths.map(p => p.split('/'));

  if (paths.length === 1) {
    // For a single path, return the parent directory
    const s = segments[0];
    return s.length > 1 ? s.slice(0, -1).join('/') : '';
  }

  const minLen = Math.min(...segments.map(s => s.length));
  let commonLen = 0;
  while (commonLen < minLen) {
    const first = segments[0][commonLen];
    if (segments.every(s => s[commonLen] === first)) {
      commonLen++;
    } else {
      break;
    }
  }

  if (commonLen === 0) return '';
  return segments[0].slice(0, commonLen).join('/');
}

/**
 * Produce a compact display label for a file path.
 *
 * - If `paths` contains more than one entry, the common prefix is removed
 *   so each chip shows only the distinguishing suffix.
 * - If the resulting label is longer than 4 segments, it is truncated to
 *   the last 3 segments with a "…/" prefix.
 * - The original path is never modified.
 *
 * Examples (paths = ['/a/b/c/f1.yml', '/a/b/d/f2.yml']):
 *   displayPathTail('/a/b/c/f1.yml', paths) → 'c/f1.yml'
 *   displayPathTail('/a/b/d/f2.yml', paths) → 'd/f2.yml'
 *
 * Single path (no common-prefix needed):
 *   displayPathTail('/a/b/c/d/e/f1.yml') → '…/c/d/e/f1.yml'
 */
export function displayPathTail(path: string, paths?: string[]): string {
  let tail: string;

  if (paths && paths.length > 1) {
    const prefix = commonPathPrefix(paths);
    tail = prefix ? path.slice(prefix.length + 1) : path;
  } else {
    tail = path;
  }

  // If the tail has more than 4 meaningful segments, truncate to last 3
  const parts = tail.split('/').filter(Boolean);
  if (parts.length > 4) {
    return '…/' + parts.slice(-3).join('/');
  }

  return tail;
}
