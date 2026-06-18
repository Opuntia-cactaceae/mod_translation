import { useEffect, useState, useCallback } from 'react';
import { usePairingStaleGuard } from './usePairingStaleGuard';
import { api, ApiError } from '../App';
import type { WorkspacePair } from '../domain/pairingTypes';
import type { SuggestPairsRequest, BulkDeleteRequest, BulkUpdateRequest, BulkUpdateResponse } from '../api/types';
import { toWorkspacePairs } from '../domain/pairingAdapters';

/* ------------------------------------------------------------------ */
/*  Result type                                                        */

export interface UsePairingPairsResult {
  /** All pairs for the current project. */
  pairs: WorkspacePair[];
  /** True while pairs are being fetched. */
  loading: boolean;
  /** Human-readable error message, or null. */
  error: string | null;
  /** Re-fetch pairs from the API. */
  refresh: () => void;
  /** Create a new manual pair and return the new pair's ID. */
  createPair: (
    sourceFileId: string | null,
    translatedFileId: string | null,
  ) => Promise<string | undefined>;
  /** Update a pair's status (accept / reject). */
  updatePairStatus: (pairId: string, status: string) => Promise<void>;
  /** Delete a pair entirely. */
  deletePair: (pairId: string) => Promise<void>;
  /** Trigger pair suggestion generation on the backend. */
  suggestPairs: (body?: SuggestPairsRequest) => Promise<void>;
  /** Delete all pairs in the current project. */
  clearPairs: () => Promise<void>;
  /** Bulk delete specific pairs by IDs. */
  bulkDeletePairs: (data: BulkDeleteRequest) => Promise<void>;
  /** Bulk accept specific pairs by IDs (only suggested/manual affected). */
  bulkAcceptPairs: (data: BulkUpdateRequest) => Promise<BulkUpdateResponse>;
  /** Bulk reject specific pairs by IDs (only suggested/manual affected). */
  bulkRejectPairs: (data: BulkUpdateRequest) => Promise<BulkUpdateResponse>;
  /** Update pair slot files (source and/or translated). */
  updatePairFiles: (
    pairId: string,
    data: { source_file_id?: string | null; translated_file_id?: string | null },
  ) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Load and manage pairs for a pairing project.
 *
 * Provides stale-async protection. The page component is responsible
 * for cleaning up selectedPairId when a pair is deleted (via a ref
 * + effect pattern).
 *
 * @param projectId  Project ID, or null to clear state.
 */
export function usePairingPairs(
  projectId: string | null,
): UsePairingPairsResult {
  const { nextRequestId, isLatest, mountedRef } = usePairingStaleGuard();
  const [pairs, setPairs] = useState<WorkspacePair[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setPairs([]);
      setLoading(false);
      setError(null);
      return;
    }

    const reqId = nextRequestId();
    setLoading(true);
    setError(null);

    try {
      const data = await api.listPairingPairs(projectId);
      if (mountedRef.current && isLatest(reqId)) {
        setPairs(toWorkspacePairs(data));
        setLoading(false);
      }
    } catch (err: unknown) {
      if (!mountedRef.current || !isLatest(reqId)) return;
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Failed to load pairs';
      setError(msg);
      setLoading(false);
    }
  }, [projectId, nextRequestId, isLatest, mountedRef]);

  const createPair = useCallback(
    async (
      sourceFileId: string | null,
      translatedFileId: string | null,
    ): Promise<string | undefined> => {
      if (!projectId) return;
      const created = await api.createPairingPair(projectId, {
        source_file_id: sourceFileId,
        translated_file_id: translatedFileId,
        notes: null,
      });
      if (mountedRef.current) {
        await load();
      }
      return created?.id;
    },
    [projectId, mountedRef, load],
  );

  const updatePairStatus = useCallback(
    async (pairId: string, status: string) => {
      if (!projectId) return;
      await api.updatePairingPair(projectId, pairId, { status });
      if (mountedRef.current) {
        await load();
      }
    },
    [projectId, mountedRef, load],
  );

  const deletePair = useCallback(
    async (pairId: string) => {
      if (!projectId) return;
      await api.deletePairingPair(projectId, pairId);
      if (mountedRef.current) {
        await load();
      }
    },
    [projectId, mountedRef, load],
  );

  const updatePairFiles = useCallback(
    async (
      pairId: string,
      data: { source_file_id?: string | null; translated_file_id?: string | null },
    ) => {
      if (!projectId) return;
      await api.updatePairingPair(projectId, pairId, data);
      if (mountedRef.current) {
        await load();
      }
    },
    [projectId, mountedRef, load],
  );

  const suggestPairs = useCallback(async (body?: SuggestPairsRequest) => {
    if (!projectId) return;
    await api.suggestPairingPairs(projectId, body);
    if (mountedRef.current) {
      await load();
    }
  }, [projectId, mountedRef, load]);

  const clearPairs = useCallback(async () => {
    if (!projectId) return;
    await api.clearPairingPairs(projectId);
    if (mountedRef.current) {
      await load();
    }
  }, [projectId, mountedRef, load]);

  const bulkDeletePairs = useCallback(async (data: BulkDeleteRequest) => {
    if (!projectId) return;
    await api.bulkDeletePairs(projectId, data);
    if (mountedRef.current) {
      await load();
    }
  }, [projectId, mountedRef, load]);

  const bulkAcceptPairs = useCallback(async (data: BulkUpdateRequest): Promise<BulkUpdateResponse> => {
    if (!projectId) return { requested: 0, updated: 0, skipped: 0, errors: ['No project'] };
    const result = await api.bulkAcceptPairs(projectId, data);
    if (mountedRef.current) {
      await load();
    }
    return result;
  }, [projectId, mountedRef, load]);

  const bulkRejectPairs = useCallback(async (data: BulkUpdateRequest): Promise<BulkUpdateResponse> => {
    if (!projectId) return { requested: 0, updated: 0, skipped: 0, errors: ['No project'] };
    const result = await api.bulkRejectPairs(projectId, data);
    if (mountedRef.current) {
      await load();
    }
    return result;
  }, [projectId, mountedRef, load]);

  // Auto-load on mount / project ID change
  useEffect(() => {
    load();
  }, [load]);

  return {
    pairs,
    loading,
    error,
    refresh: load,
    createPair,
    updatePairStatus,
    deletePair,
    updatePairFiles,
    suggestPairs,
    clearPairs,
    bulkDeletePairs,
    bulkAcceptPairs,
    bulkRejectPairs,
  };
}
