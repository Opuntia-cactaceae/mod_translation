import { useState, useCallback, useEffect } from 'react';
import { usePairingStaleGuard } from './usePairingStaleGuard';
import { api, ApiError } from '../App';
import type { LearnFromPairsResponse, ProtectionProfileSchema } from '../api/types';

/* ------------------------------------------------------------------ */
/*  Result type                                                        */
/* ------------------------------------------------------------------ */

export interface UsePairingLearningResult {
  /** Whether to include manual pairs in learning. */
  includeManual: boolean;
  setIncludeManual: (v: boolean) => void;
  /** Whether to include accepted pairs in learning. */
  includeAccepted: boolean;
  setIncludeAccepted: (v: boolean) => void;
  /** Whether to use normalization alignment during learning. */
  useAlignment: boolean;
  setUseAlignment: (v: boolean) => void;
  /** True while learning is in progress. */
  learning: boolean;
  /** Result from the last learn operation, or null. */
  result: LearnFromPairsResponse | null;
  /** Error message from the last operation, or null. */
  error: string | null;
  /** Whether there are any learnable pairs available. */
  hasLearnablePairs: boolean;
  /** Available protection profiles for selection. */
  profiles: ProtectionProfileSchema[];
  /** True while profiles are being loaded. */
  profilesLoading: boolean;
  /** Currently selected protection profile ID, or null for auto-create. */
  selectedProfileId: string | null;
  /** Select a protection profile by ID, or null for auto-create. */
  setSelectedProfileId: (id: string | null) => void;
  /** Execute the learn operation. */
  learn: () => Promise<void>;
  /** Reset result and error state. */
  reset: () => void;
  /** Reload protection profiles from the backend. */
  reloadProfiles: () => void;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Manage learning from pairing pairs into a protection profile.
 *
 * Tracks checkbox options, allows explicit protection profile selection,
 * and executes the learn API call. When no profile is selected the backend
 * auto-creates a project-scoped profile.
 *
 * @param projectId  Project ID whose pairs to learn from.
 * @param hasLearnablePairs  Whether the project has accepted/manual pairs
 *                           that can be used for learning (passed in from
 *                           the pairs hook so it stays the single source
 *                           of truth).
 */
export function usePairingLearning(
  projectId: string | null,
  hasLearnablePairs: boolean,
): UsePairingLearningResult {
  const { mountedRef } = usePairingStaleGuard();

  const [includeManual, setIncludeManual] = useState(true);
  const [includeAccepted, setIncludeAccepted] = useState(true);
  const [useAlignment, setUseAlignment] = useState(false);
  const [learning, setLearning] = useState(false);
  const [result, setResult] = useState<LearnFromPairsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProtectionProfileSchema[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  // Load protection profiles when projectId is available
  const loadProfiles = useCallback(() => {
    if (!projectId) {
      setProfiles([]);
      return;
    }

    setProfilesLoading(true);

    api.getProtectionProfiles()
      .then(data => {
        if (!mountedRef.current) return;
        setProfiles(data);

        // Auto-select existing _pairs_{projectId} profile if present
        const projectProfileName = `_pairs_${projectId}`;
        const existing = data.find(p => p.name === projectProfileName);
        if (existing) {
          setSelectedProfileId(existing.id);
        }

        setProfilesLoading(false);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setProfiles([]);
        setProfilesLoading(false);
      });
  }, [projectId, mountedRef]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const learn = useCallback(async () => {
    if (!projectId || learning) return;

    setLearning(true);
    setError(null);
    setResult(null);

    try {
      const payload: Record<string, unknown> = {
        include_accepted_pairs: includeAccepted,
        include_manual_pairs: includeManual,
        use_alignment: useAlignment,
      };
      // Only include profile_id when user explicitly selected one
      if (selectedProfileId) {
        payload.profile_id = selectedProfileId;
      }
      // Omit pair_ids when empty — backend selects all accepted/manual pairs
      if (!includeAccepted || !includeManual) {
        // pass no pair_ids — backend handles selection
      }
      const res = await api.learnFromPairingPairs(
        projectId,
        payload as unknown as Parameters<typeof api.learnFromPairingPairs>[1],
      );
      if (!mountedRef.current) return;
      setResult(res);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Learning failed';
      setError(msg);
    } finally {
      if (mountedRef.current) {
        setLearning(false);
      }
    }
  }, [
    projectId,
    includeAccepted,
    includeManual,
    useAlignment,
    selectedProfileId,
    learning,
    mountedRef,
  ]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  const reloadProfiles = useCallback(() => {
    loadProfiles();
  }, [loadProfiles]);

  return {
    includeManual,
    setIncludeManual,
    includeAccepted,
    setIncludeAccepted,
    useAlignment,
    setUseAlignment,
    learning,
    result,
    error,
    hasLearnablePairs,
    profiles,
    profilesLoading,
    selectedProfileId,
    setSelectedProfileId,
    learn,
    reset,
    reloadProfiles,
  };
}
