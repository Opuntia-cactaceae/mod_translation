import { useState, useEffect, useRef } from 'react';
import { useJobTrace } from '../../hooks/jobs/useJobTrace';
import { api, ApiError } from '../../App';
import type { RuntimeRawLogLine } from '../../api/types';
import {
  getTraceEventLabel,
  getTraceEventBadgeClass,
  getTraceCurrentActivity,
  isTraceActive,
  getJobStatusPresentation,
  getSeverityBadgeClass,
  getSeverityLabel,
  getHttpStatusFromEvent,
  extractBatchNo,
  mapTraceEvent,
  mapTraceUnitResponse,
  isJobTerminal,
  type TraceModel,
  type TraceEventModel,
  type TraceUnitModel,
} from '../../domain';
import TranslationUnitsTable from './TranslationUnitsTable';
import BatchUnitsModal from './BatchUnitsModal';

interface TracePanelProps {
  jobId?: string | null;
  jobName?: string;
  onClose?: () => void;
}

const RUNTIME_POLL_INTERVAL_MS = 3000;

export default function TracePanel({ jobId, jobName, onClose }: TracePanelProps) {
  const { loading, error, trace, events, units, refresh } = useJobTrace({
    jobId,
    enabled: Boolean(jobId),
  });

  // ---- Raw runtime log (live in-memory, no DB persistence) ----
  const [rawLogLines, setRawLogLines] = useState<RuntimeRawLogLine[]>([]);

  // ---- Batch modal state ----
  const [selectedBatchNo, setSelectedBatchNo] = useState<number | null>(null);
  const [batchUnits, setBatchUnits] = useState<TraceUnitModel[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  // ---- Raw runtime log polling (live in-memory, no DB persistence) ----
  // Poll only while the job is active (not terminal).  For terminal jobs
  // the raw log is already final — further polling serves no purpose.
  const jobIdRef = useRef<string | null>(null);
  jobIdRef.current = jobId ?? null;

  useEffect(() => {
    if (!jobId) return;
    // Wait until we know the job's status via useJobTrace trace.
    // On the initial render trace is null (not yet fetched) — do not
    // start raw-log polling until we know whether the job is terminal.
    if (!trace) return;
    // Do not start raw-log polling for terminal jobs — the log is final.
    if (isJobTerminal(trace)) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval>;

    const fetchRawLog = async () => {
      try {
        const resp = await api.getRuntimeRawLog(jobId);
        if (!cancelled) {
          // Guard against stale responses for a previous jobId
          if (jobIdRef.current !== jobId) return;
          setRawLogLines(resp.lines);
        }
      } catch (err) {
        // ignore silently during polling (raw log may be empty/unavailable)
        if (!cancelled && err instanceof ApiError) {
          if (jobIdRef.current !== jobId) return;
          setRawLogLines([]);
        }
      }
    };

    fetchRawLog();
    intervalId = setInterval(fetchRawLog, RUNTIME_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [jobId, trace]);

  // ---- Batch modal handlers ----
  const openBatchModal = async (batchNo: number) => {
    if (!jobId) return;
    setSelectedBatchNo(batchNo);
    setBatchLoading(true);
    setBatchError(null);
    setBatchUnits([]);
    try {
      const units = await api.getTraceBatchUnits(jobId, batchNo);
      setBatchUnits(units.map(mapTraceUnitResponse));
    } catch (err) {
      if (err instanceof ApiError) {
        setBatchError(err.message);
      } else {
        setBatchError('Failed to load batch units');
      }
    } finally {
      setBatchLoading(false);
    }
  };

  const closeBatchModal = () => {
    setSelectedBatchNo(null);
    setBatchUnits([]);
    setBatchError(null);
  };

  // ---- Render ----
  if (!jobId) {
    return null;
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="trace-header-info">
          <span>Trace for job: </span>
          <span className="mono" style={{ fontSize: '0.8rem' }}>
            {jobName || jobId.slice(0, 8)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button className="btn btn-sm" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          {onClose && (
            <button className="btn btn-sm" onClick={onClose}>Close</button>
          )}
        </div>
      </div>

      {loading && !trace && (
        <div className="loading"><span className="spinner" /> Loading trace...</div>
      )}

      {error && (
        <div className="alert alert-error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button className="btn btn-sm" onClick={refresh}>Retry</button>
        </div>
      )}

      {!loading && !error && !trace && (
        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>No trace data yet</div>
      )}

      {trace && (
        <>
          <TraceContent
            trace={trace}
            events={events}
            units={units}
            rawLogLines={rawLogLines}
            onBatchClick={openBatchModal}
          />
          {selectedBatchNo != null && (
            <BatchUnitsModal
              jobId={jobId}
              batchNo={selectedBatchNo}
              units={batchUnits}
              loading={batchLoading}
              error={batchError}
              onClose={closeBatchModal}
              onRetry={() => openBatchModal(selectedBatchNo)}
            />
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ //
//  TraceContent — main content area                                   //
// ------------------------------------------------------------------ //

function TraceContent({
  trace,
  events,
  units,
  rawLogLines,
  onBatchClick,
}: {
  trace: TraceModel;
  events: TraceEventModel[];
  units: TraceUnitModel[];
  rawLogLines: RuntimeRawLogLine[];
  onBatchClick: (batchNo: number) => void;
}) {
  const active = isTraceActive(trace);
  const completed = trace.status === 'completed';
  const statusPres = getJobStatusPresentation(trace.status);
  const [liveOpen, setLiveOpen] = useState(true);
  const [runtimeLogOpen, setRuntimeLogOpen] = useState(true);
  const [eventsOpen, setEventsOpen] = useState(true);

  // ---- Counts ----
  const translatedCount = units.filter(u => u.status === 'translated').length;
  const failedCount = units.filter(u => u.status === 'failed').length;
  const cachedCount = units.filter(u => u.status === 'cached').length;

  return (
    <>
      {/* Progress summary */}
      <div style={{ marginBottom: '0.75rem', fontSize: '0.8rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        <span>
          Status: <strong className={`badge ${statusPres.badgeClass}`}>{statusPres.label}</strong>
        </span>
        {trace.totalBatches > 0 && (
          <span>Batch: <strong>{trace.currentBatchIndex}/{trace.totalBatches}</strong></span>
        )}
        {trace.totalUnits > 0 && (
          <span>Units: <strong>{trace.processedUnits}/{trace.totalUnits}</strong></span>
        )}
        {trace.stats?.failedUnits != null && trace.stats.failedUnits > 0 && (
          <span style={{ color: 'var(--color-error)' }}>
            Errors: <strong>{trace.stats.failedUnits}</strong>
          </span>
        )}
        {trace.stats?.cacheHits != null && trace.stats.cacheHits > 0 && (
          <span style={{ color: 'var(--color-success)' }}>
            Cached: <strong>{trace.stats.cacheHits}</strong>
          </span>
        )}
      </div>

      {/* Current activity */}
      {active && (
        <div style={{ marginBottom: '0.75rem', fontSize: '0.8rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>
            {getTraceCurrentActivity(trace)}
          </span>
        </div>
      )}

      {/* Completion block */}
      {completed && (
        <div style={{
          marginBottom: '0.75rem',
          padding: '0.75rem',
          background: 'var(--color-surface-2)',
          borderRadius: 'var(--radius)',
          border: '1px solid ' + ((trace.stats?.failedUnits ?? 0) > 0 ? 'var(--color-warning)' : 'var(--color-success)'),
        }}>
          <div style={{ fontWeight: 600, color: (trace.stats?.failedUnits ?? 0) > 0 ? 'var(--color-warning)' : 'var(--color-success)', marginBottom: '0.5rem' }}>
            {(trace.stats?.failedUnits ?? 0) > 0 ? 'Translation completed with errors' : 'Translation completed'}
          </div>
          <div style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>
            {(() => {
              const translated = units.filter(u => u.status === 'translated').length;
              const cached = units.filter(u => u.status === 'cached').length;
              const failed = units.filter(u => u.status === 'failed').length;
              if (cached > 0 && translated === 0 && failed === 0) {
                return <>{cached} units from cache (no runtime translation needed)</>;
              }
              return <>{trace.processedUnits} units processed
                {translated > 0 && <span style={{ color: 'var(--color-success)' }}> &middot; {translated} translated</span>}
                {(trace.stats?.cacheHits ?? 0) > 0 && <span> &middot; {(trace.stats?.cacheHits ?? 0)} cached</span>}
                {(trace.stats?.failedUnits ?? 0) > 0 && <span style={{ color: 'var(--color-error)' }}> &middot; {(trace.stats?.failedUnits ?? 0)} failed</span>}
              </>;
            })()}
          </div>
        </div>
      )}

      {/* Live translations */}
      <div style={{ marginBottom: '0.5rem' }}>
        <button
          className="btn btn-sm"
          onClick={() => setLiveOpen(!liveOpen)}
          style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>
            Live translations ({units.length} shown)
          </span>
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
            {translatedCount > 0 && <span style={{ color: 'var(--color-success)', marginRight: '0.5rem' }}>{translatedCount} ok</span>}
            {failedCount > 0 && <span style={{ color: 'var(--color-error)', marginRight: '0.5rem' }}>{failedCount} failed</span>}
            {cachedCount > 0 && <span style={{ color: 'var(--color-info)' }}>{cachedCount} cached</span>}
            {liveOpen ? ' \u25BC' : ' \u25B6'}
          </span>
        </button>
      </div>

      {liveOpen && (
        <div style={{ marginBottom: '1rem' }}>
          <TranslationUnitsTable
            units={units}
            emptyMessage="No translation units yet. Waiting for batches to start..."
          />
        </div>
      )}

      {/* Runtime status log (Live raw log) — EPHEMERAL, from /runtime-raw-log */}
      <div style={{ marginBottom: '0.5rem' }}>
        <button
          className="btn btn-sm"
          onClick={() => setRuntimeLogOpen(!runtimeLogOpen)}
          style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>
            Runtime status log ({rawLogLines.length} events)
          </span>
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
            {runtimeLogOpen ? ' \u25BC' : ' \u25B6'}
          </span>
        </button>
      </div>

      {runtimeLogOpen && (
        <div style={{ marginBottom: '1rem' }}>
          <RuntimeLog lines={rawLogLines} />
        </div>
      )}

      {/* Events — PERSISTED job lifecycle trace (from /events) */}
      <div style={{ marginBottom: '0.5rem' }}>
        <button
          className="btn btn-sm"
          onClick={() => setEventsOpen(!eventsOpen)}
          style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>
            Events ({events.length} events)
          </span>
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
            {events.some(e => e.severity === 'error') && (
              <span style={{ color: 'var(--color-error)', marginRight: '0.5rem' }}>
                {events.filter(e => e.severity === 'error').length} errors
              </span>
            )}
            {events.some(e => e.severity === 'warn') && (
              <span style={{ color: 'var(--color-warning)', marginRight: '0.5rem' }}>
                {events.filter(e => e.severity === 'warn').length} warnings
              </span>
            )}
            {eventsOpen ? ' \u25BC' : ' \u25B6'}
          </span>
        </button>
      </div>

      {eventsOpen && (
        <div style={{ marginBottom: '1rem' }}>
          {events.length === 0 ? (
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', padding: '0.5rem' }}>
              No events yet.
            </div>
          ) : (
            <EventsLog events={events} onBatchClick={onBatchClick} />
          )}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ //
//  EventsLog — persistent job lifecycle event history                 //
//  Uses getTraceEventBadgeClass for event type badges.                //
//  Renders BATCH_COMPLETED events as clickable rows.                  //
// ------------------------------------------------------------------ //

function EventsLog({
  events,
  onBatchClick,
}: {
  events: TraceEventModel[];
  onBatchClick?: (batchNo: number) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(events.length);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (events.length > prevLengthRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    prevLengthRef.current = events.length;
  }, [events.length]);

  // Display events in chronological order (oldest first, newest at bottom)
  const displayEvents = [...events].reverse();

  return (
    <div
      ref={containerRef}
      className="trace-panel"
      style={{ maxHeight: '300px', overflowY: 'auto' }}
    >
      <div className="trace-body">
        {displayEvents.slice(-100).map(ev => {
          const severityClass = getSeverityBadgeClass(ev.severity);
          const isExpanded = expandedId === ev.id;
          const httpStatus = getHttpStatusFromEvent(ev);
          const is429 = httpStatus === 429;
          const isError = ev.severity === 'error';
          const clickableBatchNo = onBatchClick ? extractBatchNo(ev) : null;

          const rowStyle: React.CSSProperties = {
            borderLeft: '3px solid transparent',
            ...(is429 || isError ? { borderLeftColor: 'var(--color-warning)', background: 'var(--color-surface-2)' } : {}),
            ...(clickableBatchNo != null ? { cursor: 'pointer' } : {}),
          };

          return (
            <div
              key={ev.id}
              className="trace-event"
              style={rowStyle}
              onClick={clickableBatchNo != null ? () => onBatchClick!(clickableBatchNo) : undefined}
              onMouseEnter={clickableBatchNo != null ? (e) => {
                (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-3)';
              } : undefined}
              onMouseLeave={clickableBatchNo != null ? (e) => {
                if (!is429 && !isError) {
                  (e.currentTarget as HTMLElement).style.background = '';
                } else {
                  (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-2)';
                }
              } : undefined}
            >
              <div className="trace-event-time">{new Date(ev.timestamp).toLocaleTimeString()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap' }}>
                  <span className={`badge ${severityClass}`} style={{ fontSize: '0.6rem' }}>
                    {getSeverityLabel(ev.severity)}
                  </span>
                  <span className={`badge ${getTraceEventBadgeClass(ev.eventType)}`} style={{ fontSize: '0.6rem' }}>
                    {getTraceEventLabel(ev.eventType)}
                  </span>
                  {clickableBatchNo != null && (
                    <button
                      className="btn-unstyled"
                      style={{ fontSize: '0.65rem', color: 'var(--color-info)', cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onBatchClick!(clickableBatchNo);
                      }}
                    >
                      Show details &rarr;
                    </button>
                  )}
                </div>
                {ev.message && (
                  <div style={{ marginTop: '0.15rem', fontSize: '0.75rem', color: 'var(--color-text)' }}>
                    {ev.message}
                  </div>
                )}
                {ev.data != null && clickableBatchNo == null && (
                  <div style={{ marginTop: '0.15rem' }}>
                    <button
                      className="btn-unstyled"
                      style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedId(isExpanded ? null : ev.id);
                      }}
                    >
                      {isExpanded ? 'Hide details' : 'Show details'}
                    </button>
                    {isExpanded && (
                      <pre style={{
                        marginTop: '0.25rem',
                        fontSize: '0.65rem',
                        color: 'var(--color-text-muted)',
                        background: 'var(--color-surface-2)',
                        padding: '0.25rem',
                        borderRadius: 'var(--radius)',
                        maxHeight: '200px',
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}>
                        {JSON.stringify(ev.data, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ //
//  RuntimeLog — raw runtime log stream (from /runtime-raw-log)        //
//  Shows raw log lines as they arrive from the backend process.       //
//  No domain classification, no badges — just raw text.               //
// ------------------------------------------------------------------ //

export function RuntimeLog({ lines }: { lines: RuntimeRawLogLine[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(lines.length);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (lines.length > prevLengthRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    prevLengthRef.current = lines.length;
  }, [lines.length]);

  if (lines.length === 0) {
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', padding: '0.5rem' }}>
        No live runtime events yet.
      </div>
    );
  }

  // Display lines oldest-first (chronological)
  const displayLines = lines.slice(-200);

  return (
    <div
      ref={containerRef}
      className="trace-panel"
      style={{ maxHeight: '250px', overflowY: 'auto', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.7rem' }}
    >
      <div className="trace-body">
        {displayLines.map((line, idx) => (
          <div
            key={idx}
            style={{
              padding: '0.2rem 0.4rem',
              borderBottom: '1px solid var(--color-surface-2)',
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'flex-start',
            }}
          >
            <span style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {(() => {
                try { return new Date(line.ts).toLocaleTimeString(); } catch { return ''; }
              })()}
            </span>
            <span
              style={{
                color: line.level === 'ERROR' ? 'var(--color-error)'
                     : line.level === 'WARNING' ? 'var(--color-warning)'
                     : 'var(--color-text)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                flex: 1,
              }}
            >
              {line.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
