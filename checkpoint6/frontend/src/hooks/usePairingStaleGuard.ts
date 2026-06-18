import { useRef, useCallback, useEffect } from 'react';

/* ------------------------------------------------------------------ */
/*  StaleGuard interface                                               */
/* ------------------------------------------------------------------ */

export interface StaleGuard {
  /** Increments the internal counter and returns the new request ID. Call before each fetch. */
  nextRequestId: () => number;
  /** Returns true when `reqId` matches the current (latest) counter value. */
  isLatest: (reqId: number) => boolean;
  /** Mutable ref — true while the component is mounted. */
  mountedRef: React.MutableRefObject<boolean>;
  /** Resets the counter (useful when switching projects). */
  reset: () => void;
  /** Returns the current request ID counter value (read-only). */
  currentRequestId: () => number;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Provides request-ID-based stale response guards and a mounted ref.
 *
 * Extracts the pattern used across PairingProjects, PairPreviewPanel,
 * and AlignmentPanel into a single reusable hook.
 *
 * Usage:
 * ```ts
 * const { nextRequestId, isLatest, mountedRef } = usePairingStaleGuard();
 *
 * const reqId = nextRequestId();
 * api.someCall().then(data => {
 *   if (mountedRef.current && isLatest(reqId)) {
 *     setData(data);
 *   }
 * });
 * ```
 */
export function usePairingStaleGuard(): StaleGuard {
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const nextRequestId = useCallback(() => ++requestIdRef.current, []);
  const isLatest = useCallback(
    (reqId: number) => reqId === requestIdRef.current,
    [],
  );
  const reset = useCallback(() => {
    requestIdRef.current = 0;
  }, []);
  const currentRequestId = useCallback(() => requestIdRef.current, []);

  return { nextRequestId, isLatest, mountedRef, reset, currentRequestId };
}
