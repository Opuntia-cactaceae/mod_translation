import { useState, useCallback } from 'react';
import { api, ApiError } from '../../App';
import type { FoundFile } from '../../components';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface UseCreateJobFileSearchDeps {
  /** Callback to add a single path to form state */
  addPath: (path: string) => void;
  /** Set of already-added paths (for skip-during-addAll) */
  addedPaths: Set<string>;
}

export interface UseCreateJobFileSearchReturn {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  foundFiles: FoundFile[];
  setFoundFiles: (files: FoundFile[]) => void;
  searching: boolean;
  searchError: string | null;
  pickFilePath: string;
  setPickFilePath: (p: string) => void;
  pickSearchPath: string;
  setPickSearchPath: (p: string) => void;
  handleSearch: () => Promise<void>;
  handleAddAll: () => void;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useCreateJobFileSearch(
  deps: UseCreateJobFileSearchDeps,
): UseCreateJobFileSearchReturn {
  const { addPath, addedPaths } = deps;

  const [searchQuery, setSearchQuery] = useState('');
  const [foundFiles, setFoundFiles] = useState<FoundFile[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pickFilePath, setPickFilePath] = useState('');
  const [pickSearchPath, setPickSearchPath] = useState('');

  const handleSearch = useCallback(async () => {
    const roots = searchQuery.split('\n').map(s => s.trim()).filter(Boolean);
    if (roots.length === 0) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await api.findLocalisationFiles({ root_paths: roots });
      setFoundFiles(res.files);
      if (res.diagnostics.length > 0) {
        setSearchError(res.diagnostics.join('; '));
      }
    } catch (err) {
      if (err instanceof ApiError) setSearchError(err.message);
      else setSearchError('Search failed');
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const handleAddAll = useCallback(() => {
    for (const f of foundFiles) {
      if (!addedPaths.has(f.path)) {
        addPath(f.path);
      }
    }
  }, [foundFiles, addedPaths, addPath]);

  return {
    searchQuery,
    setSearchQuery,
    foundFiles,
    setFoundFiles,
    searching,
    searchError,
    pickFilePath,
    setPickFilePath,
    pickSearchPath,
    setPickSearchPath,
    handleSearch,
    handleAddAll,
  };
}
