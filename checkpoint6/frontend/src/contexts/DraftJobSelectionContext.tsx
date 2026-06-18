/* ------------------------------------------------------------------ */
/*  Shared Draft Job Selection Context                                 */
/*                                                                     */
/*  Single source of truth for the draft job file selection state      */
/*  across the entire SPA.  The backend owns the state, this context   */
/*  provides a reactive read/write interface via the REST API.         */
/*                                                                     */
/*  Every mutation calls the backend API AND updates the shared        */
/*  state from the response, so all subscribers (ModListSection,       */
/*  CreateJobForm, etc.) stay in sync without independent local state. */
/* ------------------------------------------------------------------ */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { DraftSelectionGroup } from '../api/types';

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface DraftFileMeta {
  modId?: string;
  modName?: string;
}

export interface DraftJobSelectionContextType {
  /** Current list of draft file paths (from backend). */
  draftFiles: string[];
  /** Per-file metadata (modId, modName) keyed by normalized path. */
  draftMeta: Record<string, DraftFileMeta>;
  /** Grouped file tree computed by the backend. */
  grouped: DraftSelectionGroup[];
  /** Warnings / diagnostics from the backend about the draft state. */
  diagnostics: Array<{ level: string; code: string; message: string }>;
  /** Number of files in the draft. */
  fileCount: number;
  /** Loading state for initial fetch. */
  loading: boolean;
  /** Error message if fetch or mutation failed. */
  error: string | null;

  /** Add a single file (dedup by canonical path on backend). */
  addFile: (filePath: string, meta?: DraftFileMeta) => Promise<void>;
  /** Add multiple files with same mod context. */
  addFiles: (filePaths: string[], meta?: DraftFileMeta) => Promise<void>;
  /** Remove a single file. */
  removeFile: (filePath: string) => Promise<void>;
  /** Remove multiple files in one batch call. */
  removeFiles: (filePaths: string[]) => Promise<void>;
  /** Replace the entire file list (textarea sync). */
  setFiles: (files: string[], fileMeta?: Record<string, DraftFileMeta>) => Promise<void>;
  /** Clear all files and metadata. */
  clearFiles: () => Promise<void>;
  /** Check if a file path is in the current draft (uses normalised comparison). */
  isFileAdded: (filePath: string) => boolean;
  /** Navigate to the jobs page. */
  navigateToJob: () => void;
  /** Re-fetch state from backend. */
  refresh: () => Promise<void>;

  // --- New mutation methods (backend-driven) ---
  /** Add localisation files from one or more mods.
   *
   * Pass mods by ``modPaths`` (filesystem path) to avoid aliasing when
   * two mods share the same ``mod_id``.  ``legacyModIds`` is only used
   * as a fallback when ``modPaths`` is empty / undefined. */
  addFilesFromMods: (legacyModIds: string[], handler?: string, language?: string, modPaths?: string[]) => Promise<void>;
  /** Search for localisation files, optionally adding to draft. */
  searchAndAddFiles: (roots: string[], handler?: string, language?: string, add?: boolean) => Promise<void>;
  /** Replace draft from raw textarea content. */
  setFilesFromRaw: (pathsText: string, source?: string) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Context                                                             */
/* ------------------------------------------------------------------ */

const DraftJobSelectionContext = createContext<DraftJobSelectionContextType | null>(null);

/* ------------------------------------------------------------------ */
/*  Hook for consuming the context                                     */
/* ------------------------------------------------------------------ */

export function useDraftJobSelection(): DraftJobSelectionContextType {
  const ctx = useContext(DraftJobSelectionContext);
  if (!ctx) {
    throw new Error(
      'useDraftJobSelection must be used within a <DraftJobSelectionProvider>',
    );
  }
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Normalisation helper (mirrors backend's canonicalize_path logic    */
/*  for client-side comparisons like isFileAdded).                     */
/* ------------------------------------------------------------------ */

function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function DraftJobSelectionProvider({ children }: { children: ReactNode }) {
  const [draftFiles, setDraftFiles] = useState<string[]>([]);
  const [draftMeta, setDraftMeta] = useState<Record<string, DraftFileMeta>>({});
  const [grouped, setGrouped] = useState<DraftSelectionGroup[]>([]);
  const [diagnostics, setDiagnostics] = useState<Array<{ level: string; code: string; message: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();
  const mountedRef = useRef(true);

  // ----------------------------------------------------------------
  //  Fetch draft state from backend
  // ----------------------------------------------------------------
  const refresh = useCallback(async () => {
    try {
      setError(null);
      const state = await api.getDraftJobSelection();
      if (mountedRef.current) {
        setDraftFiles(state.files);
        setGrouped(state.grouped ?? []);
        setDiagnostics(state.diagnostics ?? []);
        // Convert backend metadata (keys are strings, values are dicts with
        // mod_id/mod_name) to frontend DraftFileMeta format.
        const meta: Record<string, DraftFileMeta> = {};
        for (const [path, m] of Object.entries(state.file_metadata)) {
          const record = m as Record<string, unknown>;
          meta[path] = {
            modId: record.mod_id as string | undefined,
            modName: record.mod_name as string | undefined,
          };
        }
        setDraftMeta(meta);
      }
    } catch (err) {
      if (mountedRef.current) {
        const msg = err instanceof ApiError ? err.message : 'Failed to load draft state';
        setError(msg);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Load on mount
  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  // ----------------------------------------------------------------
  //  Mutations (all re-fetch state afterwards so the shared state
  //  is always an accurate reflection of the backend)
  // ----------------------------------------------------------------
  const addFile = useCallback(
    async (filePath: string, meta?: DraftFileMeta) => {
      try {
        setError(null);
        const requestMeta =
          meta && (meta.modId || meta.modName)
            ? { mod_id: meta.modId, mod_name: meta.modName }
            : undefined;
        const state = await api.addDraftFiles({
          file_paths: [filePath],
          metadata: requestMeta,
        });
        if (mountedRef.current) {
          setDraftFiles(state.files);
          await refresh();
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof ApiError ? err.message : 'Failed to add file');
        }
      }
    },
    [refresh],
  );

  const addFiles = useCallback(
    async (filePaths: string[], meta?: DraftFileMeta) => {
      try {
        setError(null);
        const requestMeta =
          meta && (meta.modId || meta.modName)
            ? { mod_id: meta.modId, mod_name: meta.modName }
            : undefined;
        const state = await api.addDraftFiles({
          file_paths: filePaths,
          metadata: requestMeta,
        });
        if (mountedRef.current) {
          setDraftFiles(state.files);
          await refresh();
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof ApiError ? err.message : 'Failed to add files');
        }
      }
    },
    [refresh],
  );

  const removeFile = useCallback(
    async (filePath: string) => {
      try {
        setError(null);
        const state = await api.removeDraftFiles({ file_paths: [filePath] });
        if (mountedRef.current) {
          setDraftFiles(state.files);
          await refresh();
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof ApiError ? err.message : 'Failed to remove file');
        }
      }
    },
    [refresh],
  );

  const removeFiles = useCallback(
    async (filePaths: string[]) => {
      if (filePaths.length === 0) return;
      try {
        setError(null);
        const state = await api.removeDraftFiles({ file_paths: filePaths });
        if (mountedRef.current) {
          setDraftFiles(state.files);
          await refresh();
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof ApiError ? err.message : 'Failed to remove files');
        }
      }
    },
    [refresh],
  );

  const setFiles = useCallback(
    async (files: string[], fileMeta?: Record<string, DraftFileMeta>) => {
      try {
        setError(null);
        const backendMeta = fileMeta
          ? Object.fromEntries(
              Object.entries(fileMeta).map(([path, m]) => [
                path,
                { mod_id: m.modId, mod_name: m.modName },
              ]),
            )
          : undefined;
        const state = await api.setDraftJobSelection({
          files,
          file_metadata: backendMeta,
        });
        if (mountedRef.current) {
          setDraftFiles(state.files);
          await refresh();
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof ApiError ? err.message : 'Failed to set files');
        }
      }
    },
    [refresh],
  );

  const clearFiles = useCallback(async () => {
    try {
      setError(null);
      await api.clearDraftJobSelection();
      if (mountedRef.current) {
        setDraftFiles([]);
        setDraftMeta({});
        setGrouped([]);
        setDiagnostics([]);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof ApiError ? err.message : 'Failed to clear draft');
      }
    }
  }, []);

  // ----------------------------------------------------------------
  //  New mutation methods (backend-driven)
  // ----------------------------------------------------------------

  const addFilesFromMods = useCallback(
    async (legacyModIds: string[], handler = 'stellaris_localisation', language = 'english', modPaths?: string[]) => {
      try {
        setError(null);
        const payload: any = { handler, language };
        if (modPaths && modPaths.length > 0) {
          payload.mod_paths = modPaths;
        } else {
          payload.mod_ids = legacyModIds;
        }
        await api.addDraftFilesFromMods(payload);
        await refresh();
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof ApiError ? err.message : 'Failed to add mod files');
        }
      }
    },
    [refresh],
  );

  const searchAndAddFiles = useCallback(
    async (roots: string[], handler = 'stellaris_localisation', language = 'english', add = false) => {
      try {
        setError(null);
        await api.searchAndAddDraftFiles({ roots, handler, language, add });
        await refresh();
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof ApiError ? err.message : 'Failed to search files');
        }
      }
    },
    [refresh],
  );

  const setFilesFromRaw = useCallback(
    async (pathsText: string, source = 'raw') => {
      try {
        setError(null);
        await api.setDraftFilesFromRaw({ paths_text: pathsText, source });
        await refresh();
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof ApiError ? err.message : 'Failed to set files from raw text');
        }
      }
    },
    [refresh],
  );

  // ----------------------------------------------------------------
  //  Derived queries
  // ----------------------------------------------------------------
  const isFileAdded = useCallback(
    (filePath: string): boolean => {
      const normPath = normalizePath(filePath);
      return draftFiles.some(f => normalizePath(f) === normPath);
    },
    [draftFiles],
  );

  const navigateToJob = useCallback(() => {
    navigate('/jobs');
  }, [navigate]);

  // ----------------------------------------------------------------
  //  Memoised context value
  // ----------------------------------------------------------------
  const value = useMemo<DraftJobSelectionContextType>(
    () => ({
      draftFiles,
      draftMeta,
      grouped,
      diagnostics,
      fileCount: draftFiles.length,
      loading,
      error,
      addFile,
      addFiles,
      removeFile,
      removeFiles,
      setFiles,
      clearFiles,
      addFilesFromMods,
      searchAndAddFiles,
      setFilesFromRaw,
      isFileAdded,
      navigateToJob,
      refresh,
    }),
    [
      draftFiles,
      draftMeta,
      grouped,
      diagnostics,
      loading,
      error,
      addFile,
      addFiles,
      removeFile,
      removeFiles,
      setFiles,
      clearFiles,
      addFilesFromMods,
      searchAndAddFiles,
      setFilesFromRaw,
      isFileAdded,
      navigateToJob,
      refresh,
    ],
  );

  return (
    <DraftJobSelectionContext.Provider value={value}>
      {children}
    </DraftJobSelectionContext.Provider>
  );
}
