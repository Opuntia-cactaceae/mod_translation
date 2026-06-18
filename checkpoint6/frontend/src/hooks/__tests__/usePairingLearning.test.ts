import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePairingLearning } from '../usePairingLearning';

/* ------------------------------------------------------------------ */
/*  Mock api                                                           */
/* ------------------------------------------------------------------ */

const mockLearnFromPairingPairs = vi.hoisted(() => vi.fn());
const mockGetProtectionProfiles = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('../../App', () => ({
  api: {
    learnFromPairingPairs: mockLearnFromPairingPairs,
    getProtectionProfiles: mockGetProtectionProfiles,
  },
  ApiError: class extends Error {
    code = '';
    details: Record<string, unknown> = {};
    recoverable = false;
    constructor(err: {
      message: string;
      code: string;
      details: Record<string, unknown>;
      recoverable: boolean;
    }) {
      super(err.message);
      this.code = err.code;
      this.details = err.details;
      this.recoverable = err.recoverable;
    }
  },
}));

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

const LEARN_RESULT = {
  profile_id: 'auto-prof-1',
  samples_collected: 42,
  samples_added: 40,
  candidates_new: 10,
  candidates_updated: 3,
  total_candidates: 13,
  files_processed: 8,
  normalized_pairs_used: 0,
  raw_pairs_used: 5,
  error: null,
};

const PROFILES = [
  { id: 'prof-1', name: 'My Profile', description: '', game_id: null, mod_id: null, created_at: '', updated_at: '' },
  { id: 'prof-2', name: 'Other Profile', description: '', game_id: null, mod_id: null, created_at: '', updated_at: '' },
];

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('usePairingLearning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns defaults when projectId is null', () => {
    const { result } = renderHook(() =>
      usePairingLearning(null, true),
    );

    expect(result.current.includeManual).toBe(true);
    expect(result.current.includeAccepted).toBe(true);
    expect(result.current.useAlignment).toBe(false);
    expect(result.current.learning).toBe(false);
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.hasLearnablePairs).toBe(true);
    expect(result.current.selectedProfileId).toBeNull();
    expect(result.current.profiles).toEqual([]);
  });

  it('learn calls api.learnFromPairingPairs with correct payload (no profile_id)', async () => {
    mockLearnFromPairingPairs.mockResolvedValue(LEARN_RESULT);

    const { result } = renderHook(() =>
      usePairingLearning('proj-1', true),
    );

    // Set options (different from defaults to verify)
    await act(async () => {
      result.current.setIncludeManual(false);
      result.current.setUseAlignment(true);
    });

    // Execute learn
    await act(async () => {
      await result.current.learn();
    });

    // Verify the API was called without profile_id
    expect(mockLearnFromPairingPairs).toHaveBeenCalledWith('proj-1', {
      include_accepted_pairs: true,
      include_manual_pairs: false,
      use_alignment: true,
    });
    expect(result.current.result).not.toBeNull();
    expect(result.current.result?.samples_collected).toBe(42);
    expect(result.current.error).toBeNull();
    expect(result.current.learning).toBe(false);
  });

  it('learn sends profile_id when selectedProfileId is set', async () => {
    mockLearnFromPairingPairs.mockResolvedValue(LEARN_RESULT);
    mockGetProtectionProfiles.mockResolvedValue(PROFILES);

    const { result } = renderHook(() =>
      usePairingLearning('proj-1', true),
    );

    // Select a profile
    await act(async () => {
      result.current.setSelectedProfileId('prof-1');
    });

    // Execute learn
    await act(async () => {
      await result.current.learn();
    });

    // Verify profile_id was sent
    expect(mockLearnFromPairingPairs).toHaveBeenCalledWith('proj-1', {
      profile_id: 'prof-1',
      include_accepted_pairs: true,
      include_manual_pairs: true,
      use_alignment: false,
    });
  });

  it('learn does nothing when projectId is null', async () => {
    const { result } = renderHook(() =>
      usePairingLearning(null, true),
    );

    await act(async () => {
      await result.current.learn();
    });

    expect(mockLearnFromPairingPairs).not.toHaveBeenCalled();
  });

  it('sets error on learn failure', async () => {
    mockLearnFromPairingPairs.mockRejectedValue(new Error('API error'));

    const { result } = renderHook(() =>
      usePairingLearning('proj-1', true),
    );

    await act(async () => {
      await result.current.learn();
    });

    expect(result.current.error).toContain('Learning failed');
    expect(result.current.result).toBeNull();
  });

  it('reset clears result and error', async () => {
    mockLearnFromPairingPairs.mockResolvedValue(LEARN_RESULT);

    const { result } = renderHook(() =>
      usePairingLearning('proj-1', true),
    );

    await act(async () => {
      await result.current.learn();
    });

    expect(result.current.result).not.toBeNull();

    await act(async () => {
      result.current.reset();
    });

    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('passes through hasLearnablePairs', () => {
    const { result: r1 } = renderHook(() =>
      usePairingLearning('proj-1', false),
    );
    expect(r1.current.hasLearnablePairs).toBe(false);

    const { result: r2 } = renderHook(() =>
      usePairingLearning('proj-1', true),
    );
    expect(r2.current.hasLearnablePairs).toBe(true);
  });

  it('omits pair_ids from payload when no pairIds are explicitly selected', async () => {
    mockLearnFromPairingPairs.mockResolvedValue(LEARN_RESULT);

    const { result } = renderHook(() =>
      usePairingLearning('proj-1', true),
    );

    await act(async () => {
      await result.current.learn();
    });

    const payload = mockLearnFromPairingPairs.mock.calls[0][1] as Record<string, unknown>;
    // pair_ids should be absent (undefined) — backend selects all pairs
    expect(payload).not.toHaveProperty('pair_ids');
  });

  it('loads profiles when projectId is set', async () => {
    mockGetProtectionProfiles.mockResolvedValue(PROFILES);

    const { result } = renderHook(() =>
      usePairingLearning('proj-1', true),
    );

    // Wait for the async effect to complete
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(mockGetProtectionProfiles).toHaveBeenCalled();
    expect(result.current.profiles).toEqual(PROFILES);
  });

  it('setSelectedProfileId updates selectedProfileId', async () => {
    const { result } = renderHook(() =>
      usePairingLearning('proj-1', true),
    );

    expect(result.current.selectedProfileId).toBeNull();

    await act(async () => {
      result.current.setSelectedProfileId('prof-1');
    });

    expect(result.current.selectedProfileId).toBe('prof-1');

    // Clear selection
    await act(async () => {
      result.current.setSelectedProfileId(null);
    });

    expect(result.current.selectedProfileId).toBeNull();
  });
});
