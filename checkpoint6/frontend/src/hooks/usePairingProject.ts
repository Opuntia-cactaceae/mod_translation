import { useState, useCallback, useEffect } from 'react';
import { usePairingStaleGuard } from './usePairingStaleGuard';
import { api, ApiError } from '../App';
import type { WorkspaceProject } from '../domain/pairingTypes';
import { toWorkspaceProject } from '../domain/pairingAdapters';

/* ------------------------------------------------------------------ */
/*  Result type                                                        */
/* ------------------------------------------------------------------ */

export interface UsePairingProjectResult {
  /** The loaded project, or null when projectId is null / not yet loaded. */
  project: WorkspaceProject | null;
  /** True while the project is being fetched. */
  loading: boolean;
  /** Human-readable error message, or null. */
  error: string | null;
  /** Re-fetch the project from the API. */
  refresh: () => void;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Load and manage a single pairing project by ID.
 *
 * Provides stale-async protection: if the component unmounts or the
 * projectId changes before the API response arrives, the response is
 * discarded.
 *
 * @param projectId  The project ID to load, or null to clear state.
 */
export function usePairingProject(
  projectId: string | null,
): UsePairingProjectResult {
  const { mountedRef, nextRequestId, isLatest } = usePairingStaleGuard();

  const [project, setProject] = useState<WorkspaceProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setLoading(false);
      setError(null);
      return;
    }

    const reqId = nextRequestId();
    setLoading(true);
    setError(null);

    try {
      const data = await api.getPairingProject(projectId);
      if (mountedRef.current && isLatest(reqId)) {
        setProject(toWorkspaceProject(data));
        setLoading(false);
      }
    } catch (err: unknown) {
      if (!mountedRef.current || !isLatest(reqId)) return;
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Failed to load project';
      setError(msg);
      setLoading(false);
    }
  }, [projectId, nextRequestId, isLatest, mountedRef]);

  // Load on mount / projectId change
  useEffect(() => {
    load();
  }, [load]);

  return { project, loading, error, refresh: load };
}
