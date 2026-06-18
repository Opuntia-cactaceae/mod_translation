import { useEffect, useState, useCallback } from 'react';
import { usePairingStaleGuard } from './usePairingStaleGuard';
import { api, ApiError } from '../App';
import type { WorkspacePairPreview } from '../domain/pairingTypes';
import { toWorkspacePairPreview } from '../domain/pairingAdapters';

/* ------------------------------------------------------------------ */
/*  Result type                                                        */
/* ------------------------------------------------------------------ */

export interface UsePairingPreviewResult {
  /** The loaded preview, or null when no pair selected / not yet loaded. */
  preview: WorkspacePairPreview | null;
  /** True while the preview is being fetched. */
  loading: boolean;
  /** Human-readable error message, or null. */
  error: string | null;
  /** Clear the current preview (e.g. when deselecting a pair). */
  clearPreview: () => void;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Load the side-by-side file preview for a selected pair.
 *
 * Automatically clears on pairId becoming null, uses request-ID stale
 * guards to discard responses from earlier pair selections.
 *
 * Mirrors the logic from PairPreviewPanel.tsx.
 *
 * @param projectId  Project ID.
 * @param pairId     Selected pair ID, or null to clear.
 */
export function usePairingPreview(
  projectId: string | null,
  pairId: string | null,
): UsePairingPreviewResult {
  const { nextRequestId, isLatest, mountedRef } = usePairingStaleGuard();
  const [preview, setPreview] = useState<WorkspacePairPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearPreview = useCallback(() => {
    setPreview(null);
    setError(null);
    setLoading(false);
  }, []);

  // Fetch preview whenever pairId changes
  useEffect(() => {
    if (!pairId || !projectId) {
      clearPreview();
      return;
    }

    // Clear stale data before starting a new fetch
    clearPreview();
    setLoading(true);

    const myReqId = nextRequestId();

    api
      .getPairingPairPreview(projectId, pairId)
      .then((data) => {
        if (mountedRef.current && isLatest(myReqId)) {
          setPreview(toWorkspacePairPreview(data));
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!mountedRef.current || !isLatest(myReqId)) return;
        const msg =
          err instanceof ApiError
            ? err.message
            : 'Failed to load preview';
        setError(msg);
        setLoading(false);
      });
  }, [projectId, pairId, nextRequestId, isLatest, mountedRef, clearPreview]);

  return { preview, loading, error, clearPreview };
}
