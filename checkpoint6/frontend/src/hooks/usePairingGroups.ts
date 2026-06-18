import { useEffect, useState, useCallback, useRef } from 'react';
import { usePairingStaleGuard } from './usePairingStaleGuard';
import { api, ApiError } from '../App';
import type { WorkspaceFileGroup } from '../domain/pairingTypes';
import { toWorkspaceFileGroups } from '../domain/pairingAdapters';

/* ------------------------------------------------------------------ */
/*  Result type                                                        */
/* ------------------------------------------------------------------ */

export interface UsePairingGroupsResult {
  /** File groups for the current project / grouping mode. */
  groups: WorkspaceFileGroup[];
  /** True while groups are being fetched. */
  loading: boolean;
  /** Human-readable error message, or null. */
  error: string | null;
  /** Re-fetch groups from the API. */
  refresh: () => void;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Load file groups for a pairing project.
 *
 * Automatically re-fetches when `projectId` or `groupingMode` changes.
 * Uses request-ID-based stale guards so rapid project switches do not
 * render stale group data.
 *
 * @param projectId     Project ID, or null to clear state.
 * @param groupingMode  Grouping mode (e.g. 'by_directory', 'by_filename').
 */
export function usePairingGroups(
  projectId: string | null,
  groupingMode: string,
): UsePairingGroupsResult {
  const { nextRequestId, isLatest, mountedRef } = usePairingStaleGuard();
  const [groups, setGroups] = useState<WorkspaceFileGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the last-project ID to detect project switches without a
  // full re-render cycle dependency.
  const prevProjectIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setGroups([]);
      setLoading(false);
      setError(null);
      return;
    }

    const reqId = nextRequestId();
    setLoading(true);
    setError(null);

    try {
      const data = await api.getPairingGroups(projectId, groupingMode);
      if (mountedRef.current && isLatest(reqId)) {
        setGroups(toWorkspaceFileGroups(data));
        setLoading(false);
      }
    } catch (err: unknown) {
      if (!mountedRef.current || !isLatest(reqId)) return;
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Failed to load file groups';
      setError(msg);
      setLoading(false);
    }
  }, [projectId, groupingMode, nextRequestId, isLatest, mountedRef]);

  // Auto-load on dependency changes
  useEffect(() => {
    prevProjectIdRef.current = projectId;
    load();
  }, [load]);

  return { groups, loading, error, refresh: load };
}
