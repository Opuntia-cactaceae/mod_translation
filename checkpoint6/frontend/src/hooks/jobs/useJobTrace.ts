import { useEffect, useState, useRef, useCallback } from 'react';
import { api, ApiError } from '../../App';
import {
  mapTraceSnapshot,
  mapTraceEvent,
  mapTraceUnitResponse,
  type TraceModel,
  type TraceEventModel,
  type TraceUnitModel,
} from '../../domain';
import { isJobTerminal } from '../../domain/jobs';

export interface UseJobTraceOptions {
  jobId?: string | null;
  enabled?: boolean;
}

export interface UseJobTraceResult {
  loading: boolean;
  error: string | null;
  trace: TraceModel | null;
  events: TraceEventModel[];
  units: TraceUnitModel[];
  refresh: () => Promise<void>;
}

const POLL_INTERVAL_MS = 2000;

export function useJobTrace(options: UseJobTraceOptions): UseJobTraceResult {
  const { jobId, enabled = true } = options;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceModel | null>(null);
  const [events, setEvents] = useState<TraceEventModel[]>([]);
  const [units, setUnits] = useState<TraceUnitModel[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobIdRef = useRef<string | null>(null);

  // Helper to stop the current polling interval
  const stopPolling = useCallback(() => {
    if (pollingRef.current !== null) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const fetchTrace = useCallback(async (id: string) => {
    setError(null);
    try {
      const [snap, evts, traceUnits] = await Promise.all([
        api.getTraceSnapshot(id),
        api.getTraceEvents(id),
        api.getTraceUnits(id, 50),
      ]);

      // Ignore stale responses for a previous jobId (e.g. during rapid
      // job switching before the effect cleanup has run).
      if (id !== jobIdRef.current) return;

      const mappedTrace = mapTraceSnapshot(snap);
      setTrace(mappedTrace);
      setEvents(evts.map(mapTraceEvent));
      setUnits(traceUnits.map(mapTraceUnitResponse));

      // Stop polling if the job has reached a terminal state
      if (isJobTerminal(mappedTrace)) {
        stopPolling();
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        // ignore polling errors silently (original behavior)
      }
    } finally {
      setLoading(false);
    }
  }, [stopPolling]);

  const refresh = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    await fetchTrace(jobId);
  }, [jobId, fetchTrace]);

  useEffect(() => {
    jobIdRef.current = jobId ?? null;

    if (!jobId || !enabled) {
      stopPolling();
      setTrace(null);
      setEvents([]);
      setUnits([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchTrace(jobId);
    pollingRef.current = setInterval(() => fetchTrace(jobId), POLL_INTERVAL_MS);

    return () => {
      stopPolling();
    };
  }, [jobId, enabled, fetchTrace, stopPolling]);

  return { loading, error, trace, events, units, refresh };
}
