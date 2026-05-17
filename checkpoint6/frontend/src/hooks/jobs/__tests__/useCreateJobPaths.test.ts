import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCreateJobPaths } from '../useCreateJobPaths';

/* ================================================================== */
/*  useCreateJobPaths                                                   */
/* ================================================================== */

describe('useCreateJobPaths', () => {
  /* ------------------------------------------------------------------ */
  /*  Initial state                                                       */
  /* ------------------------------------------------------------------ */

  describe('initial state', () => {
    it('starts with empty filePaths string', () => {
      const { result } = renderHook(() => useCreateJobPaths());
      expect(result.current.filePaths).toBe('');
    });

    it('starts with empty filePathList array', () => {
      const { result } = renderHook(() => useCreateJobPaths());
      expect(result.current.filePathList).toEqual([]);
    });

    it('starts with empty addedPaths Set', () => {
      const { result } = renderHook(() => useCreateJobPaths());
      expect(result.current.addedPaths.size).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  addPath                                                             */
  /* ------------------------------------------------------------------ */

  describe('addPath', () => {
    it('adds a single path to all three state slices', () => {
      const { result } = renderHook(() => useCreateJobPaths());

      act(() => result.current.addPath('some/path/file.yml'));

      expect(result.current.filePaths).toBe('some/path/file.yml');
      expect(result.current.filePathList).toEqual(['some/path/file.yml']);
      expect(result.current.addedPaths.has('some/path/file.yml')).toBe(true);
    });

    it('appends a second path on separate lines', () => {
      const { result } = renderHook(() => useCreateJobPaths());

      act(() => result.current.addPath('path/a.yml'));
      act(() => result.current.addPath('path/b.yml'));

      expect(result.current.filePaths).toBe('path/a.yml\npath/b.yml');
      expect(result.current.filePathList).toEqual(['path/a.yml', 'path/b.yml']);
    });

    it('does not add the same path twice', () => {
      const { result } = renderHook(() => useCreateJobPaths());

      act(() => result.current.addPath('dup.yml'));
      act(() => result.current.addPath('dup.yml'));

      expect(result.current.filePaths).toBe('dup.yml');
      expect(result.current.filePathList).toEqual(['dup.yml']);
      expect(result.current.addedPaths.size).toBe(1);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  removePath                                                          */
  /* ------------------------------------------------------------------ */

  describe('removePath', () => {
    it('removes a path from all three state slices', () => {
      const { result } = renderHook(() => useCreateJobPaths());

      act(() => result.current.addPath('keep.yml'));
      act(() => result.current.addPath('remove.yml'));
      act(() => result.current.removePath('remove.yml'));

      expect(result.current.filePaths).toBe('keep.yml');
      expect(result.current.filePathList).toEqual(['keep.yml']);
      expect(result.current.addedPaths.has('remove.yml')).toBe(false);
    });

    it('is a no-op if the path does not exist', () => {
      const { result } = renderHook(() => useCreateJobPaths());

      act(() => result.current.addPath('only.yml'));
      act(() => result.current.removePath('nonexistent.yml'));

      expect(result.current.filePaths).toBe('only.yml');
      expect(result.current.filePathList).toEqual(['only.yml']);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  replacePaths                                                        */
  /* ------------------------------------------------------------------ */

  describe('replacePaths', () => {
    it('replaces all state with new paths', () => {
      const { result } = renderHook(() => useCreateJobPaths());

      act(() => result.current.addPath('old.yml'));
      act(() => result.current.replacePaths(['new/a.yml', 'new/b.yml']));

      expect(result.current.filePaths).toBe('new/a.yml\nnew/b.yml');
      expect(result.current.filePathList).toEqual(['new/a.yml', 'new/b.yml']);
      expect(result.current.addedPaths.has('old.yml')).toBe(false);
      expect(result.current.addedPaths.has('new/a.yml')).toBe(true);
    });

    it('replaces with an empty array', () => {
      const { result } = renderHook(() => useCreateJobPaths());

      act(() => result.current.addPath('some.yml'));
      act(() => result.current.replacePaths([]));

      expect(result.current.filePaths).toBe('');
      expect(result.current.filePathList).toEqual([]);
      expect(result.current.addedPaths.size).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  syncPathsFromText                                                   */
  /* ------------------------------------------------------------------ */

  describe('syncPathsFromText', () => {
    it('parses newline-separated text into all state slices', () => {
      const { result } = renderHook(() => useCreateJobPaths());

      act(() => result.current.syncPathsFromText('path/a\npath/b\npath/c'));

      expect(result.current.filePaths).toBe('path/a\npath/b\npath/c');
      expect(result.current.filePathList).toEqual(['path/a', 'path/b', 'path/c']);
      expect(result.current.addedPaths.size).toBe(3);
    });

    it('trims whitespace and skips empty lines', () => {
      const { result } = renderHook(() => useCreateJobPaths());

      act(() => result.current.syncPathsFromText('  path/a  \n\npath/b'));

      expect(result.current.filePaths).toBe('  path/a  \n\npath/b');
      expect(result.current.filePathList).toEqual(['path/a', 'path/b']);
      expect(result.current.addedPaths.size).toBe(2);
    });

    it('replaces existing state', () => {
      const { result } = renderHook(() => useCreateJobPaths());

      act(() => result.current.addPath('old.yml'));
      act(() => result.current.syncPathsFromText('new.yml'));

      expect(result.current.filePaths).toBe('new.yml');
      expect(result.current.filePathList).toEqual(['new.yml']);
      expect(result.current.addedPaths.size).toBe(1);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Duplicate handling across methods                                   */
  /* ------------------------------------------------------------------ */

  describe('duplicate handling', () => {
    it('addPath does not duplicate after syncPathsFromText', () => {
      const { result } = renderHook(() => useCreateJobPaths());

      act(() => result.current.syncPathsFromText('file.yml'));
      act(() => result.current.addPath('file.yml'));

      expect(result.current.filePaths).toBe('file.yml');
      expect(result.current.filePathList).toEqual(['file.yml']);
    });

    it('replacePaths with duplicates in source array stores them all (current behaviour)', () => {
      const { result } = renderHook(() => useCreateJobPaths());

      act(() => result.current.replacePaths(['dup', 'dup']));

      expect(result.current.filePathList).toEqual(['dup', 'dup']);
      // addedPaths is a Set so it deduplicates
      expect(result.current.addedPaths.size).toBe(1);
      // filePaths string preserves duplicates
      expect(result.current.filePaths).toBe('dup\ndup');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  addedPaths synchronization                                          */
  /* ------------------------------------------------------------------ */

  describe('addedPaths synchronization', () => {
    it('addedPaths reflects all paths after multiple addPath calls', () => {
      const { result } = renderHook(() => useCreateJobPaths());

      act(() => result.current.addPath('a.yml'));
      act(() => result.current.addPath('b.yml'));
      act(() => result.current.addPath('c.yml'));

      expect(result.current.addedPaths).toEqual(new Set(['a.yml', 'b.yml', 'c.yml']));
    });

    it('addedPaths updates correctly after removePath', () => {
      const { result } = renderHook(() => useCreateJobPaths());

      act(() => result.current.addPath('a.yml'));
      act(() => result.current.addPath('b.yml'));
      act(() => result.current.removePath('a.yml'));

      expect(result.current.addedPaths).toEqual(new Set(['b.yml']));
    });
  });

  /* ------------------------------------------------------------------ */
  /*  filePaths / filePathList consistency                                */
  /* ------------------------------------------------------------------ */

  describe('filePaths / filePathList consistency', () => {
    it('filePaths entries match filePathList after series of add/remove', () => {
      const { result } = renderHook(() => useCreateJobPaths());

      act(() => result.current.addPath('a.yml'));
      act(() => result.current.addPath('b.yml'));
      act(() => result.current.addPath('c.yml'));
      act(() => result.current.removePath('b.yml'));

      const list = result.current.filePathList;
      const raw = result.current.filePaths.split('\n').filter(Boolean);
      expect(list).toEqual(raw);
    });

    it('filePaths entries match filePathList after syncPathsFromText', () => {
      const { result } = renderHook(() => useCreateJobPaths());

      act(() => result.current.syncPathsFromText('x\n  y  \n\nz'));

      const list = result.current.filePathList;
      const raw = result.current.filePaths.split('\n').map(s => s.trim()).filter(Boolean);
      expect(list.sort()).toEqual(raw.sort());
    });
  });
});
