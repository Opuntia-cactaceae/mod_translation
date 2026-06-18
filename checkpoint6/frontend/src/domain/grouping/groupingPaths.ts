/* ------------------------------------------------------------------ */
/*  Shared grouping domain — path utilities                             */
/*                                                                      */
/*  Shared path helpers extracted from genericFileGrouping.ts.           */
/* ------------------------------------------------------------------ */

/**
 * Deduplicate paths preserving first-seen order.
 */
export function deduplicatePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of paths) {
    const norm = p.replace(/\\/g, '/').replace(/\/+/g, '/');
    if (!seen.has(norm)) {
      seen.add(norm);
      result.push(p);
    }
  }
  return result;
}

/**
 * Strip root directory prefix from an absolute file path.
 *
 * The check uses `root + '/'` to ensure the root is a proper path
 * boundary — `/home/game` will not strip `/home/games/file.txt`.
 */
export function getRelativePath(filePath: string, rootDir: string): string {
  const root = rootDir.replace(/\/+$/, '');
  const prefix = root + '/';
  if (filePath.startsWith(prefix)) {
    return filePath.slice(prefix.length);
  }
  if (filePath === root) {
    return '';
  }
  return filePath;
}

/**
 * Normalise a file path for display: convert to forward slashes,
 * collapse duplicate slashes, strip trailing slash.
 */
export function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

/**
 * Extract the basename (last path component) from a file path.
 * Handles both forward and backslashes.
 */
export function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

/**
 * Check whether a path is absolute (Unix or Windows).
 *
 * Unix absolute paths start with ``/``.
 * Windows absolute paths start with a drive letter + colon + slash,
 * e.g. ``C:\path`` or ``C:/path``.
 * Windows UNC paths (``\\server\share``) are also recognised because
 * normalised UNC paths start with ``//``.
 */
export function isAbsolutePath(path: string): boolean {
  if (!path) return false;
  // Normalise once for consistent checks
  const norm = path.replace(/\\/g, '/');
  // Unix absolute / UNC
  if (norm.startsWith('/')) return true;
  // Windows drive letter, e.g. C:/
  if (/^[a-zA-Z]:\//.test(norm)) return true;
  return false;
}
