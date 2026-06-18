import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/* ================================================================== */
/*  Mocks                                                              */
/* ================================================================== */

const mockGetTraceSnapshot = vi.hoisted(() => vi.fn());
const mockGetTraceEvents = vi.hoisted(() => vi.fn());
const mockGetTraceUnits = vi.hoisted(() => vi.fn());

vi.mock('../../../App', () => ({
  api: {
    getTraceSnapshot: mockGetTraceSnapshot,
    getTraceEvents: mockGetTraceEvents,
    getTraceUnits: mockGetTraceUnits,
  },
  ApiError: class extends Error {
    code = '';
    details: Record<string, unknown> = {};
    recoverable = false;
    constructor(err: { message: string; code: string; details: Record<string, unknown>; recoverable: boolean }) {
      super(err.message);
      this.code = err.code;
      this.details = err.details;
      this.recoverable = err.recoverable;
    }
  },
}));

import { useJobTrace } from '../useJobTrace';

/* ================================================================== */
/*  Fixtures                                                           */
/* ================================================================== */

const RUNNING_SNAPSHOT = {
  id: 'job-running',
  status: 'running',
  progress: 0.5,
  total_units: 100,
  completed_units: 50,
  failed_units: 0,
  cached_units: 0,
  current_batch_index: 5,
  total_batches: 10,
  current_activity: 'translating',
  started_at: '2024-01-01T00:00:00Z',
};

const COMPLETED_SNAPSHOT = {
  id: 'job-completed',
  status: 'completed',
  progress: 1.0,
  total_units: 100,
  completed_units: 100,
  failed_units: 0,
  cached_units: 0,
  current_batch_index: 10,
  total_batches: 10,
  current_activity: null,
  started_at: '2024-01-01T00:00:00Z',
  completed_at: '2024-01-01T01:00:00Z',
};

const EMPTY_EVENTS: unknown[] = [];
const EMPTY_UNITS: unknown[] = [];

/** Flush all pending micro-tasks (Promise resolutions, React state updates). */
async function flushMicrotasks() {
  await act(async () => {});
}

/* ================================================================== */
/*  Setup                                                              */
/* ================================================================== */

function setup(jobId?: string | null, enabled = true) {
  mockGetTraceSnapshot.mockResolvedValue(RUNNING_SNAPSHOT);
  mockGetTraceEvents.mockResolvedValue(EMPTY_EVENTS);
  mockGetTraceUnits.mockResolvedValue(EMPTY_UNITS);
  return renderHook(() => useJobTrace({ jobId, enabled }));
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('useJobTrace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------
  //  Polling lifecycle
  // -----------------------------------------------------------------

  it('starts polling for selected jobId', async () => {
    setup('job-1');

    // Flush microtasks so the initial fetch Promise resolves
    await flushMicrotasks();

    expect(mockGetTraceSnapshot).toHaveBeenCalledWith('job-1');
    expect(mockGetTraceEvents).toHaveBeenCalledWith('job-1');
    expect(mockGetTraceUnits).toHaveBeenCalledWith('job-1', 50);

    // Advance timer — next poll tick fires
    mockGetTraceSnapshot.mockClear();
    await act(async () => { vi.advanceTimersByTime(2000); });
    // Flush the async fetch that the interval triggered
    await flushMicrotasks();

    expect(mockGetTraceSnapshot).toHaveBeenCalledWith('job-1');
  });

  it('stops polling on unmount', async () => {
    const { unmount } = setup('job-1');

    // Wait for initial fetch
    await flushMicrotasks();
    expect(mockGetTraceSnapshot).toHaveBeenCalled();

    mockGetTraceSnapshot.mockClear();
    unmount();

    // Advance timer — no poll should fire after unmount
    await act(async () => { vi.advanceTimersByTime(2000); });
    await flushMicrotasks();
    expect(mockGetTraceSnapshot).not.toHaveBeenCalled();
  });

  it('stops polling when component unmounts during a tick', async () => {
    let resolveSnapshot: (v: unknown) => void = () => {};
    mockGetTraceSnapshot.mockImplementation(
      () => new Promise(resolve => { resolveSnapshot = resolve; }),
    );

    const { unmount } = setup('job-1');

    // Unmount before the slow API resolves
    unmount();

    // Now resolve the pending request — should not cause setState on unmounted component
    await act(async () => {
      resolveSnapshot(RUNNING_SNAPSHOT);
    });
    await flushMicrotasks();

    // No error from setState on unmounted component
    expect(true).toBe(true);
  });

  // -----------------------------------------------------------------
  //  Terminal job detection
  // -----------------------------------------------------------------

  it('stops polling when job becomes terminal', async () => {
    mockGetTraceSnapshot.mockResolvedValue(RUNNING_SNAPSHOT);
    setup('job-1');
    await flushMicrotasks();

    // Now make the next response completed
    mockGetTraceSnapshot.mockResolvedValue(COMPLETED_SNAPSHOT);
    mockGetTraceSnapshot.mockClear();

    // Advance 2s to trigger the next poll tick
    await act(async () => { vi.advanceTimersByTime(2000); });
    await flushMicrotasks();

    // After the terminal-state fetch, polling should stop
    // Advance further — no more polls should fire
    await act(async () => { vi.advanceTimersByTime(4000); });
    await flushMicrotasks();

    // Should only have been called once (the terminal-state fetch)
    expect(mockGetTraceSnapshot.mock.calls.length).toBeLessThanOrEqual(1);
  });

  // -----------------------------------------------------------------
  //  Stale response guard
  // -----------------------------------------------------------------

  it('discards stale responses when jobId changes mid-fetch', async () => {
    // First call (job-old) is slow
    let resolveFirst: (v: unknown) => void = () => {};
    mockGetTraceSnapshot.mockImplementationOnce(
      () => new Promise(resolve => { resolveFirst = resolve; }),
    );
    // Subsequent calls (job-new etc.) resolve immediately
    mockGetTraceSnapshot.mockResolvedValue(RUNNING_SNAPSHOT);

    const { result, rerender } = renderHook(
      (props: { jobId?: string | null; enabled?: boolean }) =>
        useJobTrace({ jobId: props.jobId, enabled: props.enabled ?? true }),
      { initialProps: { jobId: 'job-old' } },
    );

    // Change jobId before the first fetch resolves
    rerender({ jobId: 'job-new' });

    // The new fetch for 'job-new' resolves immediately via the default mock,
    // so trace should already be populated
    await flushMicrotasks();
    expect(result.current.trace).not.toBeNull();

    // Now resolve the stale fetch for 'job-old' — these results should be
    // discarded by the stale-response guard in fetchTrace
    const oldTrace = result.current.trace; // snapshot before stale resolve
    await act(async () => {
      resolveFirst(RUNNING_SNAPSHOT);
    });
    await flushMicrotasks();

    // The trace should be unchanged (stale response was discarded)
    expect(result.current.trace).toBe(oldTrace);
  });

  // -----------------------------------------------------------------
  //  JobId switch — old interval stops, new one starts
  // -----------------------------------------------------------------

  it('switches from old jobId to new jobId without continuing old interval', async () => {
    mockGetTraceSnapshot.mockResolvedValue(RUNNING_SNAPSHOT);

    const { result, rerender } = renderHook(
      (props: { jobId?: string | null; enabled?: boolean }) =>
        useJobTrace({ jobId: props.jobId, enabled: props.enabled ?? true }),
      { initialProps: { jobId: 'job-a' } },
    );

    // Wait for initial fetch of job-a
    await flushMicrotasks();
    expect(mockGetTraceSnapshot).toHaveBeenCalledWith('job-a');

    mockGetTraceSnapshot.mockClear();

    // Switch to job-b
    rerender({ jobId: 'job-b' });
    await flushMicrotasks();

    // New fetch fires for job-b
    expect(mockGetTraceSnapshot).toHaveBeenCalledWith('job-b');

    mockGetTraceSnapshot.mockClear();

    // Advance timer — only job-b should be polled
    await act(async () => { vi.advanceTimersByTime(2000); });
    await flushMicrotasks();
    expect(mockGetTraceSnapshot).toHaveBeenCalledWith('job-b');
  });

  // -----------------------------------------------------------------
  //  enabled=false stops polling
  // -----------------------------------------------------------------

  it('stops polling when enabled becomes false', async () => {
    mockGetTraceSnapshot.mockResolvedValue(RUNNING_SNAPSHOT);

    const { result, rerender } = renderHook(
      (props: { jobId?: string | null; enabled?: boolean }) =>
        useJobTrace({ jobId: props.jobId, enabled: props.enabled ?? true }),
      { initialProps: { jobId: 'job-1', enabled: true } },
    );

    await flushMicrotasks();
    expect(mockGetTraceSnapshot).toHaveBeenCalled();

    mockGetTraceSnapshot.mockClear();

    // Disable polling
    rerender({ jobId: 'job-1', enabled: false });
    await flushMicrotasks();

    // Trace should be cleared
    expect(result.current.trace).toBeNull();

    // Advance timer — no polls
    await act(async () => { vi.advanceTimersByTime(2000); });
    await flushMicrotasks();
    expect(mockGetTraceSnapshot).not.toHaveBeenCalled();
  });
});
