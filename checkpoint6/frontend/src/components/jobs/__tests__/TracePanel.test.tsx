import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';

/* ================================================================== */
/*  Mocks                                                              */
/* ================================================================== */

const mockGetRuntimeRawLog = vi.hoisted(() => vi.fn());
const mockGetTraceSnapshot = vi.hoisted(() => vi.fn());
const mockGetTraceEvents = vi.hoisted(() => vi.fn());
const mockGetTraceUnits = vi.hoisted(() => vi.fn());
const mockGetTraceBatchUnits = vi.hoisted(() => vi.fn());

vi.mock('../../../App', () => ({
  api: {
    getRuntimeRawLog: mockGetRuntimeRawLog,
    getTraceSnapshot: mockGetTraceSnapshot,
    getTraceEvents: mockGetTraceEvents,
    getTraceUnits: mockGetTraceUnits,
    getTraceBatchUnits: mockGetTraceBatchUnits,
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

import TracePanel from '../TracePanel';

/* ================================================================== */
/*  Fixtures                                                           */
/* ================================================================== */

const EMPTY_EVENTS: unknown[] = [];
const EMPTY_UNITS: unknown[] = [];

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

function mockRunningTrace() {
  mockGetTraceSnapshot.mockResolvedValue(RUNNING_SNAPSHOT);
  mockGetTraceEvents.mockResolvedValue(EMPTY_EVENTS);
  mockGetTraceUnits.mockResolvedValue(EMPTY_UNITS);
}

function mockCompletedTrace() {
  mockGetTraceSnapshot.mockResolvedValue(COMPLETED_SNAPSHOT);
  mockGetTraceEvents.mockResolvedValue(EMPTY_EVENTS);
  mockGetTraceUnits.mockResolvedValue(EMPTY_UNITS);
}

function mockEmptyRawLog() {
  mockGetRuntimeRawLog.mockResolvedValue({ job_id: 'test', lines: [], count: 0 });
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('TracePanel raw-log polling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockRunningTrace();
    mockEmptyRawLog();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('starts runtime-raw-log polling when panel opens with running job', async () => {
    render(React.createElement(TracePanel, { jobId: 'job-1' }));

    // Wait for initial trace fetch to complete and trace to be set
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    // Trace has been fetched, raw-log effect should now start
    expect(mockGetRuntimeRawLog).toHaveBeenCalledWith('job-1');

    // Advance by raw-log poll interval
    mockGetRuntimeRawLog.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

    expect(mockGetRuntimeRawLog).toHaveBeenCalledWith('job-1');
  });

  it('does NOT start runtime-raw-log polling for a completed job', async () => {
    mockCompletedTrace();

    render(React.createElement(TracePanel, { jobId: 'job-completed' }));

    // Wait for the initial useJobTrace fetch to resolve
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    // Now useJobTrace has set trace to 'completed', so the raw-log effect
    // should see it and abort before starting any polling.
    expect(mockGetRuntimeRawLog).not.toHaveBeenCalled();
  });

  it('stops runtime-raw-log polling when the job becomes terminal mid-lifecycle', async () => {
    // First render: job is running
    render(React.createElement(TracePanel, { jobId: 'job-1' }));

    // Wait for initial trace + raw log fetches
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(mockGetRuntimeRawLog).toHaveBeenCalledTimes(1);

    // Now trace becomes completed (simulating job finishing)
    mockGetTraceSnapshot.mockResolvedValue(COMPLETED_SNAPSHOT);
    mockGetRuntimeRawLog.mockClear();

    // Advance time to trigger the next useJobTrace poll tick
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    // The useJobTrace poll returns 'completed'. The raw-log effect re-runs
    // because trace changed, and should NOT start a new interval for a
    // terminal job. The already-running interval may fire one more time
    // for this cycle, but should not continue after.

    // Advance another full raw-log interval
    mockGetRuntimeRawLog.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(mockGetRuntimeRawLog).not.toHaveBeenCalled();
  });

  it('stops runtime-raw-log polling on unmount', async () => {
    const { unmount } = render(React.createElement(TracePanel, { jobId: 'job-1' }));

    // Wait for initial fetch
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    mockGetRuntimeRawLog.mockClear();

    unmount();

    // Advance timer — no raw-log fetch should fire
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(mockGetRuntimeRawLog).not.toHaveBeenCalled();
  });

  it('does not render panel when jobId is null', () => {
    const { container } = render(React.createElement(TracePanel, { jobId: null }));
    expect(container.innerHTML).toBe('');
  });
});
