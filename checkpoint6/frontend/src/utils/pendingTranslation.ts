import { STORAGE_KEYS, LEGACY_KEYS } from './storageKeys';

/* ------------------------------------------------------------------ */
/*  Custom event for same-tab draft sync                                */
/* ------------------------------------------------------------------ */

/**
 * Custom event name dispatched on `window` whenever the draft job files
 * or metadata are mutated.  This enables same-tab reactivity — the
 * native `StorageEvent` only fires in *other* tabs, not the originating
 * one, so SPA components on the same page need this custom signal.
 */
export const DRAFT_JOB_FILES_CHANGED_EVENT = 'draft-job-files-changed';

function dispatchDraftJobFilesChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(DRAFT_JOB_FILES_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

/**
 * Data carried across pages when navigating from a game/mods page
 * to the Translation Jobs page.
 */
export interface PendingTranslationData {
  files?: string[];
  sourceName?: string;
  modName?: string;
  modId?: string;
  gameConfig?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Read a value from the new namespaced key, falling back to a legacy key.
 * If the legacy key has data, migrate it to the new key and remove the old one.
 */
function readWithFallback(newKey: string, legacyKey: string): string | null {
  const newRaw = safeGetItem(newKey);
  if (newRaw !== null) return newRaw;

  const legacyRaw = safeGetItem(legacyKey);
  if (legacyRaw !== null) {
    // Migrate
    safeSetItem(newKey, legacyRaw);
    safeRemoveItem(legacyKey);
    return legacyRaw;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Save pending translation data to localStorage (new namespaced keys).
 */
export function savePendingTranslation(data: PendingTranslationData): void {
  if (data.files !== undefined) {
    safeSetItem(STORAGE_KEYS.pendingTranslationFiles, JSON.stringify(data.files));
  }

  // Determine the effective source name: prefer explicit sourceName, fallback to modName
  const effectiveSourceName = data.sourceName ?? data.modName;
  if (effectiveSourceName !== undefined) {
    safeSetItem(STORAGE_KEYS.pendingSourceName, effectiveSourceName);
    // Backward compatibility: also write the legacy mod name key
    safeSetItem(STORAGE_KEYS.pendingModName, effectiveSourceName);
  }

  // Save mod_id if provided
  if (data.modId !== undefined) {
    safeSetItem(STORAGE_KEYS.pendingModId, data.modId);
  }

  if (data.gameConfig !== undefined) {
    safeSetItem(STORAGE_KEYS.pendingGameConfig, JSON.stringify(data.gameConfig));
  }
}

/**
 * Load pending translation data from localStorage.
 * Checks new namespaced keys first, then falls back to legacy keys with migration.
 * Returns null when no data is found.
 */
export function loadPendingTranslation(): PendingTranslationData | null {
  const result: PendingTranslationData = {};
  let found = false;

  const filesRaw = readWithFallback(
    STORAGE_KEYS.pendingTranslationFiles,
    LEGACY_KEYS[STORAGE_KEYS.pendingTranslationFiles],
  );
  if (filesRaw !== null) {
    try {
      const parsed = JSON.parse(filesRaw);
      if (Array.isArray(parsed)) {
        result.files = parsed;
        found = true;
      }
    } catch {
      /* ignore parse errors */
    }
  }

  // Read sourceName from new key, fallback to pendingModName, fallback to legacy
  const sourceName = readWithFallback(
    STORAGE_KEYS.pendingSourceName,
    STORAGE_KEYS.pendingModName,
  ) ?? readWithFallback(
    STORAGE_KEYS.pendingModName,
    LEGACY_KEYS[STORAGE_KEYS.pendingModName],
  );

  if (sourceName !== null) {
    result.sourceName = sourceName;
    result.modName = sourceName; // backward compat
    found = true;
  }

  // Read mod_id from the dedicated key
  const modIdRaw = safeGetItem(STORAGE_KEYS.pendingModId);
  if (modIdRaw !== null) {
    result.modId = modIdRaw;
  }

  const gameConfigRaw = readWithFallback(
    STORAGE_KEYS.pendingGameConfig,
    LEGACY_KEYS[STORAGE_KEYS.pendingGameConfig],
  );
  if (gameConfigRaw !== null) {
    try {
      const parsed = JSON.parse(gameConfigRaw);
      if (parsed && typeof parsed === 'object') {
        result.gameConfig = parsed;
        found = true;
      }
    } catch {
      /* ignore parse errors */
    }
  }

  return found ? result : null;
}

/**
 * Clear all pending translation keys from localStorage (new + legacy).
 */
export function clearPendingTranslation(): void {
  safeRemoveItem(STORAGE_KEYS.pendingTranslationFiles);
  safeRemoveItem(STORAGE_KEYS.pendingModName);
  safeRemoveItem(STORAGE_KEYS.pendingSourceName);
  safeRemoveItem(STORAGE_KEYS.pendingModId);
  safeRemoveItem(STORAGE_KEYS.pendingGameConfig);
  // Also clean up legacy keys
  safeRemoveItem(LEGACY_KEYS[STORAGE_KEYS.pendingTranslationFiles]);
  safeRemoveItem(LEGACY_KEYS[STORAGE_KEYS.pendingModName]);
  safeRemoveItem(LEGACY_KEYS[STORAGE_KEYS.pendingGameConfig]);
}

/* ------------------------------------------------------------------ */
/*  Path normalization helper                                           */
/* ------------------------------------------------------------------ */

/**
 * Normalise a file path for consistent comparison in draft storage.
 *
 * All draft job functions use this to ensure the same file under
 * different string representations (e.g. backslash vs forward slash,
 * double slashes, trailing slashes, leading/trailing whitespace,
 * different unicode forms) still matches.
 *
 * What this does:
 *  - trims whitespace
 *  - converts `\` to `/`  (Windows compatibility)
 *  - collapses consecutive slashes (`//`  →  `/`)
 *  - removes trailing slash  (except for root `/`)
 *  - normalises unicode to NFC form
 *
 * What this deliberately does NOT do:
 *  - does NOT resolve symlinks  (impossible in browser)
 *  - does NOT collapse `..` or `.`  (context-dependent)
 *  - does NOT lower-case  (preserves case-sensitive filesystems)
 *  - does NOT make paths absolute  (preserves relative paths if any)
 *
 * Idempotent: `normalizeDraftPath(normalizeDraftPath(p)) === normalizeDraftPath(p)`
 */
export function normalizeDraftPath(path: string): string {
  let normalized = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');

  // Strip trailing slash — but keep root `/` as `/`
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  // Unicode NFC normalisation (safe to call on all strings)
  try {
    normalized = normalized.normalize('NFC');
  } catch {
    /* ignore — normalize() is standard but some environments may lack it */
  }

  return normalized;
}

/* ------------------------------------------------------------------ */
/*  Draft job file management (Part 2: Add to job UX)                  */
/* ------------------------------------------------------------------ */

/** Per-file metadata stored alongside draft file paths. */
export interface DraftFileMeta {
  modId?: string;
  modName?: string;
}

/**
 * Read the current list of draft job file paths from localStorage.
 * Returns an empty array if no draft exists.
 */
export function getDraftJobFiles(): string[] {
  const raw = safeGetItem(STORAGE_KEYS.draftJobFiles);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Read per-file metadata (modId, modName) from localStorage.
 */
export function getDraftJobFileMeta(): Record<string, DraftFileMeta> {
  const raw = safeGetItem(STORAGE_KEYS.draftJobFileMeta);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Add a file path to the draft job selection.
 * Deduplicates by path (after normalisation). Optionally stores mod context.
 */
export function addDraftJobFile(filePath: string, meta?: DraftFileMeta): void {
  const normPath = normalizeDraftPath(filePath);

  // Files
  const files = getDraftJobFiles();
  if (!files.some(f => normalizeDraftPath(f) === normPath)) {
    files.push(normPath);
    safeSetItem(STORAGE_KEYS.draftJobFiles, JSON.stringify(files));
  }

  // Metadata (keyed by normalised path)
  if (meta && (meta.modId || meta.modName)) {
    const allMeta = getDraftJobFileMeta();
    allMeta[normPath] = { ...allMeta[normPath], ...meta };
    safeSetItem(STORAGE_KEYS.draftJobFileMeta, JSON.stringify(allMeta));
  }

  dispatchDraftJobFilesChanged();
}

/**
 * Remove a file path from the draft job selection.
 * Comparison is done after normalisation so different representations
 * of the same path are treated as equal.
 */
export function removeDraftJobFile(filePath: string): void {
  const normPath = normalizeDraftPath(filePath);
  const files = getDraftJobFiles().filter(f => normalizeDraftPath(f) !== normPath);
  safeSetItem(STORAGE_KEYS.draftJobFiles, JSON.stringify(files));

  const allMeta = getDraftJobFileMeta();
  // Also clean up any meta key that normalises to the same path
  for (const key of Object.keys(allMeta)) {
    if (normalizeDraftPath(key) === normPath) {
      delete allMeta[key];
    }
  }
  safeSetItem(STORAGE_KEYS.draftJobFileMeta, JSON.stringify(allMeta));

  dispatchDraftJobFilesChanged();
}

/**
 * Check if a file path is in the current draft job selection.
 * Comparison is done after normalisation.
 */
export function isFileInDraftJob(filePath: string): boolean {
  const normPath = normalizeDraftPath(filePath);
  return getDraftJobFiles().some(f => normalizeDraftPath(f) === normPath);
}

/**
 * Clear all draft job file selections.
 */
export function clearDraftJobFiles(): void {
  safeRemoveItem(STORAGE_KEYS.draftJobFiles);
  safeRemoveItem(STORAGE_KEYS.draftJobFileMeta);
  dispatchDraftJobFilesChanged();
}

/**
 * Get the count of selected draft files.
 */
export function getDraftJobFileCount(): number {
  return getDraftJobFiles().length;
}

/**
 * Replace the entire draft file list, preserving metadata only for paths
 * that still exist in the new list.  This is the "source of truth" sync
 * function — call it whenever the form's file list changes so that
 * localStorage always reflects the current selection.
 *
 * All paths are normalised before being stored.
 */
export function syncDraftJobFiles(paths: string[]): void {
  // Deduplicate by normalized path to avoid duplicate entries
  const seen = new Set<string>();
  const normPaths: string[] = [];
  for (const p of paths) {
    const norm = normalizeDraftPath(p);
    if (!seen.has(norm)) {
      seen.add(norm);
      normPaths.push(norm);
    }
  }
  safeSetItem(STORAGE_KEYS.draftJobFiles, JSON.stringify(normPaths));

  const allMeta = getDraftJobFileMeta();
  const newMeta: Record<string, DraftFileMeta> = {};
  for (const normPath of normPaths) {
    // Find metadata by normalised key so old un-normalised keys still match
    const existingKey = Object.keys(allMeta).find(k => normalizeDraftPath(k) === normPath);
    if (existingKey && allMeta[existingKey]) {
      newMeta[normPath] = allMeta[existingKey];
    }
  }
  safeSetItem(STORAGE_KEYS.draftJobFileMeta, JSON.stringify(newMeta));

  dispatchDraftJobFilesChanged();
}

/**
 * Add multiple files with the same mod context.
 * All paths are normalised; deduplication uses normalised comparison.
 */
export function addDraftJobFiles(filePaths: string[], meta?: DraftFileMeta): void {
  const existing = getDraftJobFiles();
  const existingMeta = getDraftJobFileMeta();
  let changed = false;

  for (const fp of filePaths) {
    const normPath = normalizeDraftPath(fp);
    if (!existing.some(f => normalizeDraftPath(f) === normPath)) {
      existing.push(normPath);
      changed = true;
    }
    if (meta && (meta.modId || meta.modName)) {
      existingMeta[normPath] = { ...existingMeta[normPath], ...meta };
    }
  }

  if (changed) {
    safeSetItem(STORAGE_KEYS.draftJobFiles, JSON.stringify(existing));
  }
  safeSetItem(STORAGE_KEYS.draftJobFileMeta, JSON.stringify(existingMeta));

  dispatchDraftJobFilesChanged();
}
