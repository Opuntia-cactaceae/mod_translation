import { useState, useCallback, useMemo } from 'react';
import { normalizePathLines } from '../../domain/jobFormHelpers';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface UseCreateJobPathsReturn {
  /** Raw textarea value (one path per line) */
  filePaths: string;
  /** Array form for chips display */
  filePathList: string[];
  /** Set form for FileSuggestionList highlight state */
  addedPaths: Set<string>;

  /** Add a single path (dedup) to all three representations */
  addPath: (path: string) => void;
  /** Remove a single path from all three representations */
  removePath: (path: string) => void;
  /**
   * Bulk-replace all three path representations atomically.
   * Used when selecting a mod or applying pending translation data.
   */
  replacePaths: (paths: string[]) => void;
  /**
   * Synchronise path representations from textarea input.
   * Normalises the text (trims, filters empties) and updates
   * filePathList + addedPaths accordingly while keeping the
   * raw text in filePaths.
   */
  syncPathsFromText: (text: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useCreateJobPaths(): UseCreateJobPathsReturn {
  const [filePaths, setFilePaths] = useState('');
  const [filePathList, setFilePathList] = useState<string[]>([]);
  const [addedPaths, setAddedPaths] = useState<Set<string>>(new Set());

  // -----------------------------------------------------------------
  //  addPath — dedup, updates all three
  // -----------------------------------------------------------------

  const addPath = useCallback((path: string) => {
    setAddedPaths(prev => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
    setFilePathList(prev => (prev.includes(path) ? prev : [...prev, path]));
    setFilePaths(prev => {
      const lines = normalizePathLines(prev);
      if (!lines.includes(path)) {
        return [...lines, path].join('\n');
      }
      return prev;
    });
  }, []);

  // -----------------------------------------------------------------
  //  removePath — removes from all three
  // -----------------------------------------------------------------

  const removePath = useCallback((path: string) => {
    setAddedPaths(prev => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
    setFilePathList(prev => prev.filter(p => p !== path));
    setFilePaths(prev =>
      normalizePathLines(prev).filter(p => p !== path).join('\n'),
    );
  }, []);

  // -----------------------------------------------------------------
  //  replacePaths — bulk replace all three (for mod select / pending)
  // -----------------------------------------------------------------

  const replacePaths = useCallback((paths: string[]) => {
    setFilePathList(paths);
    setAddedPaths(new Set(paths));
    setFilePaths(paths.join('\n'));
  }, []);

  // -----------------------------------------------------------------
  //  syncPathsFromText — textarea onChange handler
  //  Keeps filePaths as raw text (controlled input), normalises to
  //  sync filePathList + addedPaths
  // -----------------------------------------------------------------

  const syncPathsFromText = useCallback((text: string) => {
    setFilePaths(text);
    const paths = normalizePathLines(text);
    setFilePathList(paths);
    setAddedPaths(new Set(paths));
  }, []);

  // -----------------------------------------------------------------
  //  Stable return reference
  // -----------------------------------------------------------------

  return useMemo(
    () => ({
      filePaths,
      filePathList,
      addedPaths,
      addPath,
      removePath,
      replacePaths,
      syncPathsFromText,
    }),
    [
      filePaths,
      filePathList,
      addedPaths,
      addPath,
      removePath,
      replacePaths,
      syncPathsFromText,
    ],
  );
}
