import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  savePendingTranslation,
  loadPendingTranslation,
  clearPendingTranslation,
  getDraftJobFiles,
  getDraftJobFileMeta,
  addDraftJobFile,
  addDraftJobFiles,
  removeDraftJobFile,
  isFileInDraftJob,
  clearDraftJobFiles,
  getDraftJobFileCount,
  syncDraftJobFiles,
  normalizeDraftPath,
  DRAFT_JOB_FILES_CHANGED_EVENT,
} from '../pendingTranslation';

/* ================================================================== */
/*  pendingTranslation (Part 1: modId in pending translation)          */
/* ================================================================== */

describe('pendingTranslation with modId', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and loads modId in pending translation', () => {
    savePendingTranslation({
      files: ['/path/to/file.yml'],
      sourceName: 'Test Mod',
      modName: 'Test Mod',
      modId: 'mod-123',
    });

    const loaded = loadPendingTranslation();
    expect(loaded).not.toBeNull();
    expect(loaded!.modId).toBe('mod-123');
    expect(loaded!.files).toEqual(['/path/to/file.yml']);
  });

  it('does not include modId when not provided', () => {
    savePendingTranslation({
      files: ['/path/to/file.yml'],
      sourceName: 'Test Mod',
      modName: 'Test Mod',
    });

    const loaded = loadPendingTranslation();
    expect(loaded).not.toBeNull();
    expect(loaded!.modId).toBeUndefined();
  });

  it('modId survives clear and re-save', () => {
    savePendingTranslation({
      files: ['/path/to/file.yml'],
      sourceName: 'Test Mod',
      modName: 'Test Mod',
      modId: 'mod-456',
    });

    clearPendingTranslation();
    expect(loadPendingTranslation()).toBeNull();

    savePendingTranslation({
      files: ['/other/file.yml'],
      sourceName: 'Other Mod',
      modName: 'Other Mod',
      modId: 'mod-789',
    });

    const loaded = loadPendingTranslation();
    expect(loaded!.modId).toBe('mod-789');
    expect(loaded!.files).toEqual(['/other/file.yml']);
  });
});

/* ================================================================== */
/*  Draft job file management (Part 2: Add to job UX)                  */
/* ================================================================== */

describe('draft job file management', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getDraftJobFiles', () => {
    it('returns empty array when no draft exists', () => {
      expect(getDraftJobFiles()).toEqual([]);
    });
  });

  describe('addDraftJobFile', () => {
    it('adds a single file to the draft', () => {
      addDraftJobFile('/path/to/file.yml', { modId: 'mod-1', modName: 'Mod 1' });

      const files = getDraftJobFiles();
      expect(files).toEqual(['/path/to/file.yml']);
    });

    it('deduplicates the same file', () => {
      addDraftJobFile('/path/to/file.yml');
      addDraftJobFile('/path/to/file.yml');

      expect(getDraftJobFiles()).toEqual(['/path/to/file.yml']);
    });

    it('stores mod metadata', () => {
      addDraftJobFile('/path/to/file.yml', { modId: 'mod-1', modName: 'Mod 1' });

      const meta = getDraftJobFileMeta();
      expect(meta['/path/to/file.yml']).toEqual({ modId: 'mod-1', modName: 'Mod 1' });
    });

    it('works without metadata', () => {
      addDraftJobFile('/path/to/file.yml');

      expect(getDraftJobFiles()).toEqual(['/path/to/file.yml']);
      expect(getDraftJobFileMeta()).toEqual({});
    });
  });

  describe('addDraftJobFiles (bulk)', () => {
    it('adds multiple files at once', () => {
      addDraftJobFiles(['/a.yml', '/b.yml', '/c.yml'], { modId: 'mod-1', modName: 'Mod 1' });

      expect(getDraftJobFiles()).toEqual(['/a.yml', '/b.yml', '/c.yml']);
    });

    it('deduplicates in bulk add', () => {
      addDraftJobFiles(['/a.yml', '/b.yml']);
      addDraftJobFiles(['/a.yml', '/c.yml']);

      expect(getDraftJobFiles()).toEqual(['/a.yml', '/b.yml', '/c.yml']);
    });

    it('stores metadata for all files in bulk add', () => {
      addDraftJobFiles(['/a.yml', '/b.yml'], { modId: 'mod-1', modName: 'Mod 1' });

      const meta = getDraftJobFileMeta();
      expect(meta['/a.yml']).toEqual({ modId: 'mod-1', modName: 'Mod 1' });
      expect(meta['/b.yml']).toEqual({ modId: 'mod-1', modName: 'Mod 1' });
    });

    it('supports distinct metadata per file in sequential adds', () => {
      // Add two files from DIFFERENT mods — each gets its own metadata
      addDraftJobFile('/mod_a/a.yml', { modId: 'mod-a', modName: 'Mod A' });
      addDraftJobFile('/mod_b/b.yml', { modId: 'mod-b', modName: 'Mod B' });

      const meta = getDraftJobFileMeta();
      expect(meta['/mod_a/a.yml']).toEqual({ modId: 'mod-a', modName: 'Mod A' });
      expect(meta['/mod_b/b.yml']).toEqual({ modId: 'mod-b', modName: 'Mod B' });
      // Verify values are different, not flattened
      expect(meta['/mod_a/a.yml'].modId).not.toBe(meta['/mod_b/b.yml'].modId);
      expect(meta['/mod_a/a.yml'].modName).not.toBe(meta['/mod_b/b.yml'].modName);
    });

    it('bulk add does not overwrite existing distinct metadata for other files', () => {
      // File A already has mod metadata
      addDraftJobFile('/mod_a/a.yml', { modId: 'mod-a', modName: 'Mod A' });
      // Bulk add file B and C with different metadata
      addDraftJobFiles(['/mod_b/b.yml', '/mod_b/c.yml'], { modId: 'mod-b', modName: 'Mod B' });

      const meta = getDraftJobFileMeta();
      // File A should retain its original metadata
      expect(meta['/mod_a/a.yml']).toEqual({ modId: 'mod-a', modName: 'Mod A' });
      // Files B and C should have the new metadata
      expect(meta['/mod_b/b.yml']).toEqual({ modId: 'mod-b', modName: 'Mod B' });
      expect(meta['/mod_b/c.yml']).toEqual({ modId: 'mod-b', modName: 'Mod B' });
    });
  });

  describe('removeDraftJobFile', () => {
    it('removes a file from the draft', () => {
      addDraftJobFile('/path/to/file.yml', { modId: 'mod-1' });
      addDraftJobFile('/other/file.yml', { modId: 'mod-1' });

      removeDraftJobFile('/path/to/file.yml');

      expect(getDraftJobFiles()).toEqual(['/other/file.yml']);
    });

    it('removes associated metadata', () => {
      addDraftJobFile('/path/to/file.yml', { modId: 'mod-1', modName: 'Mod 1' });
      removeDraftJobFile('/path/to/file.yml');

      expect(getDraftJobFileMeta()).toEqual({});
    });

    it('does nothing for non-existent file', () => {
      addDraftJobFile('/a.yml');

      removeDraftJobFile('/non-existent.yml');

      expect(getDraftJobFiles()).toEqual(['/a.yml']);
    });

    it('removes metadata only for the removed file, not other files', () => {
      // Two files from DIFFERENT mods
      addDraftJobFile('/mod_a/a.yml', { modId: 'mod-a', modName: 'Mod A' });
      addDraftJobFile('/mod_b/b.yml', { modId: 'mod-b', modName: 'Mod B' });

      removeDraftJobFile('/mod_a/a.yml');

      // File A should be gone from both files and metadata
      expect(getDraftJobFiles()).toEqual(['/mod_b/b.yml']);
      const meta = getDraftJobFileMeta();
      expect(meta['/mod_a/a.yml']).toBeUndefined();
      // File B's metadata must survive
      expect(meta['/mod_b/b.yml']).toEqual({ modId: 'mod-b', modName: 'Mod B' });
    });
  });

  describe('isFileInDraftJob', () => {
    it('returns true for added file', () => {
      addDraftJobFile('/path/to/file.yml');
      expect(isFileInDraftJob('/path/to/file.yml')).toBe(true);
    });

    it('returns false for non-added file', () => {
      expect(isFileInDraftJob('/path/to/file.yml')).toBe(false);
    });

    it('returns false after file is removed', () => {
      addDraftJobFile('/path/to/file.yml');
      removeDraftJobFile('/path/to/file.yml');
      expect(isFileInDraftJob('/path/to/file.yml')).toBe(false);
    });
  });

  describe('clearDraftJobFiles', () => {
    it('clears all files and metadata', () => {
      addDraftJobFile('/a.yml', { modId: 'mod-1' });
      addDraftJobFile('/b.yml', { modId: 'mod-1' });

      clearDraftJobFiles();

      expect(getDraftJobFiles()).toEqual([]);
      expect(getDraftJobFileMeta()).toEqual({});
    });
  });

  describe('getDraftJobFileCount', () => {
    it('returns 0 when empty', () => {
      expect(getDraftJobFileCount()).toBe(0);
    });

    it('returns correct count', () => {
      addDraftJobFile('/a.yml');
      addDraftJobFile('/b.yml');
      expect(getDraftJobFileCount()).toBe(2);
    });
  });

  describe('syncDraftJobFiles', () => {
    it('replaces the entire draft file list', () => {
      addDraftJobFile('/old/file.yml');
      addDraftJobFile('/another/old.yml');

      syncDraftJobFiles(['/new/file.yml', '/new2/file.yml']);

      expect(getDraftJobFiles()).toEqual(['/new/file.yml', '/new2/file.yml']);
    });

    it('preserves metadata for paths that still exist in the new list', () => {
      addDraftJobFile('/a.yml', { modId: 'mod-a', modName: 'Mod A' });
      addDraftJobFile('/b.yml', { modId: 'mod-b', modName: 'Mod B' });

      syncDraftJobFiles(['/a.yml', '/c.yml']);

      // Metadata for /a.yml must survive
      const meta = getDraftJobFileMeta();
      expect(meta['/a.yml']).toEqual({ modId: 'mod-a', modName: 'Mod A' });
      // Metadata for /b.yml must be removed
      expect(meta['/b.yml']).toBeUndefined();
    });

    it('removes metadata for paths no longer in the list', () => {
      addDraftJobFile('/a.yml', { modId: 'mod-a' });
      addDraftJobFile('/b.yml', { modId: 'mod-b' });

      syncDraftJobFiles(['/a.yml']);

      const meta = getDraftJobFileMeta();
      expect(meta['/a.yml']).toEqual({ modId: 'mod-a' });
      expect(meta['/b.yml']).toBeUndefined();
      // Draft files list must also be correct
      expect(getDraftJobFiles()).toEqual(['/a.yml']);
    });

    it('clears all files and metadata when given an empty array', () => {
      addDraftJobFile('/a.yml', { modId: 'mod-a' });
      addDraftJobFile('/b.yml', { modId: 'mod-b' });

      syncDraftJobFiles([]);

      expect(getDraftJobFiles()).toEqual([]);
      expect(getDraftJobFileMeta()).toEqual({});
      expect(getDraftJobFileCount()).toBe(0);
    });

    it('handles empty initial state gracefully', () => {
      syncDraftJobFiles(['/new.yml']);

      expect(getDraftJobFiles()).toEqual(['/new.yml']);
      expect(getDraftJobFileMeta()).toEqual({});
    });

    it('syncs a single file removal correctly (simulates X button)', () => {
      addDraftJobFile('/preselected.yml', { modId: 'mod-1', modName: 'Mod 1' });
      addDraftJobFile('/other.yml', { modId: 'mod-1', modName: 'Mod 1' });

      // Simulate removing only /preselected.yml
      syncDraftJobFiles(['/other.yml']);

      expect(getDraftJobFiles()).toEqual(['/other.yml']);
      const meta = getDraftJobFileMeta();
      expect(meta['/preselected.yml']).toBeUndefined();
      expect(meta['/other.yml']).toEqual({ modId: 'mod-1', modName: 'Mod 1' });
    });

    it('does not drop metadata for remaining files when called multiple times', () => {
      addDraftJobFile('/a.yml', { modId: 'mod-a', modName: 'Mod A' });
      addDraftJobFile('/b.yml', { modId: 'mod-b', modName: 'Mod B' });
      addDraftJobFile('/c.yml', { modId: 'mod-c', modName: 'Mod C' });

      // Remove /b.yml
      syncDraftJobFiles(['/a.yml', '/c.yml']);
      // Remove /a.yml
      syncDraftJobFiles(['/c.yml']);

      expect(getDraftJobFiles()).toEqual(['/c.yml']);
      const meta = getDraftJobFileMeta();
      expect(meta['/c.yml']).toEqual({ modId: 'mod-c', modName: 'Mod C' });
      expect(meta['/a.yml']).toBeUndefined();
      expect(meta['/b.yml']).toBeUndefined();
    });
  });

  describe('toggle behavior (Add to job ↔ Added)', () => {
    it('clicking Add to job changes button to Added (isFileInDraftJob returns true)', () => {
      addDraftJobFile('/path/to/file.yml', { modId: 'mod-1', modName: 'Mod 1' });
      expect(isFileInDraftJob('/path/to/file.yml')).toBe(true);
    });

    it('clicking Added removes file from draft', () => {
      addDraftJobFile('/path/to/file.yml', { modId: 'mod-1', modName: 'Mod 1' });
      removeDraftJobFile('/path/to/file.yml');
      expect(getDraftJobFiles()).not.toContain('/path/to/file.yml');
    });

    it('clicking Added removes metadata for that file', () => {
      addDraftJobFile('/path/to/file.yml', { modId: 'mod-1', modName: 'Mod 1' });
      removeDraftJobFile('/path/to/file.yml');
      const meta = getDraftJobFileMeta();
      expect(meta['/path/to/file.yml']).toBeUndefined();
    });

    it('after removal isFileInDraftJob(path) returns false', () => {
      addDraftJobFile('/path/to/file.yml', { modId: 'mod-1', modName: 'Mod 1' });
      removeDraftJobFile('/path/to/file.yml');
      expect(isFileInDraftJob('/path/to/file.yml')).toBe(false);
    });

    it('removing one file does not remove metadata for another', () => {
      addDraftJobFile('/file_a.yml', { modId: 'mod-a', modName: 'Mod A' });
      addDraftJobFile('/file_b.yml', { modId: 'mod-b', modName: 'Mod B' });
      removeDraftJobFile('/file_a.yml');
      const meta = getDraftJobFileMeta();
      expect(meta['/file_a.yml']).toBeUndefined();
      expect(meta['/file_b.yml']).toEqual({ modId: 'mod-b', modName: 'Mod B' });
    });

    it('draft count updates after toggle off', () => {
      addDraftJobFile('/file_a.yml', { modId: 'mod-1' });
      addDraftJobFile('/file_b.yml', { modId: 'mod-1' });
      expect(getDraftJobFileCount()).toBe(2);
      removeDraftJobFile('/file_a.yml');
      expect(getDraftJobFileCount()).toBe(1);
      removeDraftJobFile('/file_b.yml');
      expect(getDraftJobFileCount()).toBe(0);
    });

    it('supports full toggle lifecycle (add → remove → re-add)', () => {
      addDraftJobFile('/path/to/file.yml', { modId: 'mod-1', modName: 'Mod 1' });
      expect(isFileInDraftJob('/path/to/file.yml')).toBe(true);
      expect(getDraftJobFileCount()).toBe(1);

      removeDraftJobFile('/path/to/file.yml');
      expect(isFileInDraftJob('/path/to/file.yml')).toBe(false);
      expect(getDraftJobFileCount()).toBe(0);

      addDraftJobFile('/path/to/file.yml', { modId: 'mod-1', modName: 'Mod 1' });
      expect(isFileInDraftJob('/path/to/file.yml')).toBe(true);
      expect(getDraftJobFileCount()).toBe(1);
    });

    it('re-adds metadata after toggle off → on', () => {
      addDraftJobFile('/file.yml', { modId: 'mod-1', modName: 'Mod 1' });
      removeDraftJobFile('/file.yml');
      addDraftJobFile('/file.yml', { modId: 'mod-1', modName: 'Mod 1' });
      expect(getDraftJobFileMeta()['/file.yml']).toEqual({ modId: 'mod-1', modName: 'Mod 1' });
    });
  });

  /* ================================================================ */
  /*  Integration: Create Job form ↔ localStorage sync                  */
  /* ================================================================ */

  describe('Create Job form ↔ localStorage sync', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('simulates: add file on mods page → remove via form X → file does NOT reappear on remount', () => {
      // Step 1: User clicks "Add to job" on mods page
      addDraftJobFile('/mod/file.yml', { modId: 'mod-1', modName: 'Mod 1' });

      // Step 2: User navigates to Create Job form — useCreateJobFlow reads draft_job_files
      expect(getDraftJobFiles()).toEqual(['/mod/file.yml']);

      // Step 3: User clicks X to remove the file — handleRemovePath calls removeDraftJobFile
      removeDraftJobFile('/mod/file.yml');

      // Step 4: Verify localStorage is clean
      expect(getDraftJobFiles()).toEqual([]);
      expect(getDraftJobFileMeta()).toEqual({});
      expect(getDraftJobFileCount()).toBe(0);

      // Step 5: Simulate page remount — no files in draft_job_files → form loads empty
      const filesOnRemount = getDraftJobFiles();
      expect(filesOnRemount).toEqual([]);
    });

    it('simulates: remove one of two preselected files → metadata for the other is preserved', () => {
      addDraftJobFile('/file_a.yml', { modId: 'mod-a', modName: 'Mod A' });
      addDraftJobFile('/file_b.yml', { modId: 'mod-b', modName: 'Mod B' });

      // User removes file_a — simulate via syncDraftJobFiles
      syncDraftJobFiles(['/file_b.yml']);

      expect(getDraftJobFiles()).toEqual(['/file_b.yml']);
      const meta = getDraftJobFileMeta();
      expect(meta['/file_a.yml']).toBeUndefined();
      expect(meta['/file_b.yml']).toEqual({ modId: 'mod-b', modName: 'Mod B' });
    });

    it('simulates: manual textarea edit removes paths → syncDraftJobFiles cleans up stale metadata', () => {
      addDraftJobFile('/keep.yml', { modId: 'mod-1', modName: 'Mod 1' });
      addDraftJobFile('/remove.yml', { modId: 'mod-1', modName: 'Mod 1' });

      // User edits textarea — only /keep.yml remains
      syncDraftJobFiles(['/keep.yml']);

      expect(getDraftJobFiles()).toEqual(['/keep.yml']);
      const meta = getDraftJobFileMeta();
      expect(meta['/keep.yml']).toEqual({ modId: 'mod-1', modName: 'Mod 1' });
      expect(meta['/remove.yml']).toBeUndefined();
    });

    it('simulates: add path via form search → syncDraftJobFiles includes it', () => {
      addDraftJobFile('/existing.yml', { modId: 'mod-1', modName: 'Mod 1' });

      // User adds a new file via file search → addDraftJobFile called
      addDraftJobFile('/newly_added.yml', { modId: 'mod-1', modName: 'Mod 1' });

      expect(getDraftJobFiles()).toEqual(['/existing.yml', '/newly_added.yml']);
      expect(getDraftJobFileCount()).toBe(2);
    });

    it('simulates: clear all files via form reset → clears draft count and storage', () => {
      addDraftJobFile('/a.yml', { modId: 'mod-1' });
      addDraftJobFile('/b.yml', { modId: 'mod-1' });

      // User clicks "Reset to defaults" or "Clear selection"
      clearDraftJobFiles();

      expect(getDraftJobFiles()).toEqual([]);
      expect(getDraftJobFileMeta()).toEqual({});
      expect(getDraftJobFileCount()).toBe(0);
    });

    it('simulates: successful job creation → draft_job_files are cleared', () => {
      addDraftJobFile('/file.yml', { modId: 'mod-1', modName: 'Mod 1' });

      // User creates job — handleCreateJob calls clearDraftJobFiles
      clearDraftJobFiles();

      expect(getDraftJobFiles()).toEqual([]);
      expect(getDraftJobFileMeta()).toEqual({});
      expect(getDraftJobFileCount()).toBe(0);
    });

    it('simulates: add → remove → add same path preserves metadata', () => {
      addDraftJobFile('/file.yml', { modId: 'mod-1', modName: 'Mod 1' });
      removeDraftJobFile('/file.yml');
      addDraftJobFile('/file.yml', { modId: 'mod-1', modName: 'Mod 1' });

      expect(getDraftJobFiles()).toEqual(['/file.yml']);
      expect(getDraftJobFileMeta()['/file.yml']).toEqual({ modId: 'mod-1', modName: 'Mod 1' });
    });
  });
});

/* ================================================================== */
/*  Custom event dispatch tests                                         */
/* ================================================================== */

describe('DRAFT_JOB_FILES_CHANGED_EVENT dispatch', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('addDraftJobFile dispatches event', () => {
    const handler = vi.fn();
    window.addEventListener(DRAFT_JOB_FILES_CHANGED_EVENT, handler);
    addDraftJobFile('/a.yml');
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(DRAFT_JOB_FILES_CHANGED_EVENT, handler);
  });

  it('removeDraftJobFile dispatches event', () => {
    addDraftJobFile('/a.yml');
    const handler = vi.fn();
    window.addEventListener(DRAFT_JOB_FILES_CHANGED_EVENT, handler);
    removeDraftJobFile('/a.yml');
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(DRAFT_JOB_FILES_CHANGED_EVENT, handler);
  });

  it('clearDraftJobFiles dispatches event', () => {
    addDraftJobFile('/a.yml');
    const handler = vi.fn();
    window.addEventListener(DRAFT_JOB_FILES_CHANGED_EVENT, handler);
    clearDraftJobFiles();
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(DRAFT_JOB_FILES_CHANGED_EVENT, handler);
  });

  it('syncDraftJobFiles dispatches event', () => {
    const handler = vi.fn();
    window.addEventListener(DRAFT_JOB_FILES_CHANGED_EVENT, handler);
    syncDraftJobFiles(['/a.yml', '/b.yml']);
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(DRAFT_JOB_FILES_CHANGED_EVENT, handler);
  });

  it('addDraftJobFiles dispatches event when new files added', () => {
    const handler = vi.fn();
    window.addEventListener(DRAFT_JOB_FILES_CHANGED_EVENT, handler);
    addDraftJobFiles(['/a.yml', '/b.yml']);
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(DRAFT_JOB_FILES_CHANGED_EVENT, handler);
  });

  it('addDraftJobFiles dispatches event even when only metadata changes (no new files)', () => {
    addDraftJobFile('/a.yml');
    const handler = vi.fn();
    window.addEventListener(DRAFT_JOB_FILES_CHANGED_EVENT, handler);
    addDraftJobFiles(['/a.yml'], { modId: 'mod-1', modName: 'Mod 1' });
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(DRAFT_JOB_FILES_CHANGED_EVENT, handler);
  });

  it('read-only functions do NOT dispatch event', () => {
    addDraftJobFile('/a.yml');
    const handler = vi.fn();
    window.addEventListener(DRAFT_JOB_FILES_CHANGED_EVENT, handler);
    getDraftJobFiles();
    getDraftJobFileMeta();
    getDraftJobFileCount();
    isFileInDraftJob('/a.yml');
    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener(DRAFT_JOB_FILES_CHANGED_EVENT, handler);
  });

  it('event is a CustomEvent with the expected name', () => {
    let capturedEvent: Event | null = null;
    const handler = (e: Event) => { capturedEvent = e; };
    window.addEventListener(DRAFT_JOB_FILES_CHANGED_EVENT, handler);
    addDraftJobFile('/test.yml');
    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent!.type).toBe(DRAFT_JOB_FILES_CHANGED_EVENT);
    window.removeEventListener(DRAFT_JOB_FILES_CHANGED_EVENT, handler);
  });
});

/* ================================================================== */
/*  normalizeDraftPath — unit tests                                     */
/* ================================================================== */

describe('normalizeDraftPath', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('trims whitespace', () => {
    expect(normalizeDraftPath('  /path/to/file.yml  ')).toBe('/path/to/file.yml');
  });

  it('converts backslashes to forward slashes', () => {
    expect(normalizeDraftPath('path\\to\\file.yml')).toBe('path/to/file.yml');
  });

  it('collapses multiple consecutive slashes', () => {
    expect(normalizeDraftPath('/path//to///file.yml')).toBe('/path/to/file.yml');
  });

  it('removes trailing slash from non-root paths', () => {
    expect(normalizeDraftPath('/path/to/dir/')).toBe('/path/to/dir');
  });

  it('preserves root slash', () => {
    expect(normalizeDraftPath('/')).toBe('/');
  });

  it('handles mixed backslashes and forward slashes', () => {
    expect(normalizeDraftPath('path\\to/mixed/file.yml')).toBe('path/to/mixed/file.yml');
  });

  it('normalizes trailing-slashed Windows paths', () => {
    expect(normalizeDraftPath('C:\\Users\\test\\')).toBe('C:/Users/test');
  });

  it('is idempotent — double normalization returns same result', () => {
    const inputs = [
      '/path/to/file.yml',
      '  /path/to/file.yml  ',
      'path\\to\\file.yml',
      '/path//to///file.yml',
      '/path/to/dir/',
      'C:\\Users\\test\\',
    ];
    for (const input of inputs) {
      const once = normalizeDraftPath(input);
      const twice = normalizeDraftPath(once);
      expect(twice).toBe(once);
    }
  });

  it('handles empty or whitespace-only string', () => {
    expect(normalizeDraftPath('')).toBe('');
    expect(normalizeDraftPath('   ')).toBe('');
  });

  it('normalizes unicode NFC form', () => {
    // 'é' (NFD: e + combining acute) vs 'é' (NFC: composed)
    const nfd = 'path/to/fil\u0065\u0301.yml';  // e + combining accent
    const nfc = 'path/to/fil\u00E9.yml';         // composed é
    const result = normalizeDraftPath(nfd);
    expect(result).toBe(nfc);
    // Double normalization should be stable
    expect(normalizeDraftPath(result)).toBe(result);
  });
});

/* ================================================================== */
/*  Draft path normalization — integration tests                        */
/* ================================================================== */

describe('draft path normalization — integration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /* ---------------------------------------------------------------- */
  /*  Same file with different slash styles                            */
  /* ---------------------------------------------------------------- */

  it('addDraftJobFile with backslashes matches forward-slash lookup', () => {
    addDraftJobFile('path\\to\\file.yml', { modId: 'mod-1' });
    expect(getDraftJobFiles()).toEqual(['path/to/file.yml']);
    expect(isFileInDraftJob('path/to/file.yml')).toBe(true);
    expect(isFileInDraftJob('path\\to\\file.yml')).toBe(true);
  });

  it('addDraftJobFiles normalises all paths', () => {
    addDraftJobFiles(['path\\a.yml', 'path//b.yml', 'path/c.yml/']);
    const files = getDraftJobFiles();
    expect(files).toContain('path/a.yml');
    expect(files).toContain('path/b.yml');
    expect(files).toContain('path/c.yml');
  });

  /* ---------------------------------------------------------------- */
  /*  Dedup with different representations                             */
  /* ---------------------------------------------------------------- */

  it('deduplicates when same file added with different slash styles', () => {
    addDraftJobFile('path/to/file.yml');
    addDraftJobFile('path\\to\\file.yml');
    expect(getDraftJobFiles()).toEqual(['path/to/file.yml']);
  });

  it('addDraftJobFiles deduplicates across representations', () => {
    addDraftJobFiles(['/a.yml', '/b.yml']);
    addDraftJobFiles(['/a.yml', '\\c.yml']);
    expect(getDraftJobFiles()).toEqual(['/a.yml', '/b.yml', '/c.yml']);
  });

  /* ---------------------------------------------------------------- */
  /*  remove still works with normalized comparison                    */
  /* ---------------------------------------------------------------- */

  it('removeDraftJobFile with different slash style still removes', () => {
    addDraftJobFile('path/to/file.yml', { modId: 'mod-1' });
    removeDraftJobFile('path\\to\\file.yml');
    expect(getDraftJobFiles()).toEqual([]);
    expect(getDraftJobFileMeta()).toEqual({});
  });

  it('removeDraftJobFile removes metadata key regardless of key format', () => {
    addDraftJobFile('path/to/file.yml', { modId: 'mod-1' });
    removeDraftJobFile('path\\to\\file.yml');
    expect(getDraftJobFileMeta()).toEqual({});
  });

  /* ---------------------------------------------------------------- */
  /*  syncDraftJobFiles normalises                                     */
  /* ---------------------------------------------------------------- */

  it('syncDraftJobFiles normalises all paths and preserves matching meta', () => {
    // Add with mixed format
    addDraftJobFile('path/to/a.yml', { modId: 'mod-a' });
    addDraftJobFile('other\\b.yml', { modId: 'mod-b' });

    // Sync with normalised paths — should match on normalised key
    syncDraftJobFiles(['path/to/a.yml']);

    expect(getDraftJobFiles()).toEqual(['path/to/a.yml']);
    const meta = getDraftJobFileMeta();
    expect(meta['path/to/a.yml']).toEqual({ modId: 'mod-a' });
    // b.yml should be gone
    expect(Object.keys(meta)).not.toContain('other/b.yml');
  });

  it('syncDraftJobFiles re-keys metadata to normalised form', () => {
    // Manually inject legacy-style data with backslash in meta key
    localStorage.setItem(
      'stellaris_translator.draft_job_files',
      JSON.stringify(['path\\to\\file.yml']),
    );
    localStorage.setItem(
      'stellaris_translator.draft_job_file_meta',
      JSON.stringify({ 'path\\to\\file.yml': { modId: 'mod-1' } }),
    );

    // Sync with a forward-slash version — should match via normalised key
    syncDraftJobFiles(['path/to/file.yml']);

    // After sync, both files and meta should use normalised key
    expect(getDraftJobFiles()).toEqual(['path/to/file.yml']);
    const meta = getDraftJobFileMeta();
    expect(meta['path/to/file.yml']).toEqual({ modId: 'mod-1' });
    // Legacy key should be gone
    expect(meta['path\\to\\file.yml']).toBeUndefined();
  });

  /* ---------------------------------------------------------------- */
  /*  isFileInDraftJob with normalised comparison                      */
  /* ---------------------------------------------------------------- */

  it('isFileInDraftJob returns true for normalized equivalent', () => {
    addDraftJobFile('/path/to/file.yml');
    expect(isFileInDraftJob('/path/to/file.yml')).toBe(true);
    expect(isFileInDraftJob('/path\\to\\file.yml')).toBe(true);
    expect(isFileInDraftJob('/path//to/file.yml')).toBe(true);
  });

  it('isFileInDraftJob returns false after normalized remove', () => {
    addDraftJobFile('/path/to/file.yml');
    removeDraftJobFile('/path\\to\\file.yml');
    expect(isFileInDraftJob('/path/to/file.yml')).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /*  No duplicate entries after normalization                         */
  /* ---------------------------------------------------------------- */

  it('no duplicate draft entries when adding same file with different formats', () => {
    addDraftJobFile('/mod/file.yml');
    addDraftJobFile('/mod\\file.yml');
    addDraftJobFile('/mod//file.yml');
    addDraftJobFile(' /mod/file.yml ');
    expect(getDraftJobFiles()).toEqual(['/mod/file.yml']);
    expect(getDraftJobFileCount()).toBe(1);
  });

  it('addDraftJobFiles produces no duplicates with mixed formats in one call', () => {
    addDraftJobFiles([
      '/a.yml',
      '\\a.yml',
      '/a.yml',
      '/a.yml ',
    ]);
    expect(getDraftJobFiles()).toEqual(['/a.yml']);
    expect(getDraftJobFileCount()).toBe(1);
  });

  /* ---------------------------------------------------------------- */
  /*  Metadata integrity with normalized paths                         */
  /* ---------------------------------------------------------------- */

  it('metadata for same file does not duplicate after round-trip', () => {
    addDraftJobFile('/path/file.yml', { modId: 'mod-1' });
    addDraftJobFile('\\path\\file.yml', { modId: 'mod-1' });

    const meta = getDraftJobFileMeta();
    // Only one meta key for the single file
    expect(Object.keys(meta).length).toBe(1);
    expect(meta['/path/file.yml']).toEqual({ modId: 'mod-1' });
  });

  /* ---------------------------------------------------------------- */
  /*  Trailing slash normalization                                     */
  /* ---------------------------------------------------------------- */

  it('trailing slash on path is normalized on add', () => {
    addDraftJobFile('/path/to/dir/');
    expect(getDraftJobFiles()).toEqual(['/path/to/dir']);
  });

  it('isFileInDraftJob matches despite trailing slash', () => {
    addDraftJobFile('/path/to/dir');
    expect(isFileInDraftJob('/path/to/dir/')).toBe(true);
  });
});
