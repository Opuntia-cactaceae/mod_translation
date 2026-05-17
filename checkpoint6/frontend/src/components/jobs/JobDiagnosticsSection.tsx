import { useState } from 'react';
import type { JobModel } from '../../domain';

/* ------------------------------------------------------------------ */
/*  Internal/debug diagnostic codes — hidden from user-facing display  */
/* ------------------------------------------------------------------ */

const INTERNAL_DIAGNOSTIC_CODES = new Set([
  'COUNTERS_SATURATED',
  'DATA_INVARIANT_VIOLATION',
  'INVALID_STATUS_TRANSITION',
  'ALL_UNITS_CACHED',
  'UNITS_SKIPPED',
  'FILE_SKIPPED',
  'CACHE_ERROR',
  'BATCH_BUILD_FAILED',
  'LARGE_BATCH',
  'JOB_COMPLETED',
]);

function isInternal(d: { code?: string }): boolean {
  return d.code ? INTERNAL_DIAGNOSTIC_CODES.has(d.code) : false;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface JobDiagnosticsSectionProps {
  job: JobModel;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function JobDiagnosticsSection({ job }: JobDiagnosticsSectionProps) {
  const [showInternal, setShowInternal] = useState(false);

  if (!job.diagnostics || job.diagnostics.length === 0) return null;

  const userDiagnostics = job.diagnostics.filter(d => !isInternal(d));
  const internalDiagnostics = job.diagnostics.filter(d => isInternal(d));
  const hasUserDiags = userDiagnostics.length > 0;
  const hasInternalDiags = internalDiagnostics.length > 0;

  if (!hasUserDiags && !hasInternalDiags) return null;

  /* Helper to render a single diagnostic badge */
  const renderBadge = (d: { level: string; message: string }, i: number) => {
    const diagClass =
      d.level === 'error' || d.level === 'critical'
        ? 'badge-error'
        : d.level === 'warning'
        ? 'badge-warning'
        : 'badge-info';
    return (
      <div key={i} className={`badge ${diagClass}`} style={{ marginRight: '0.3rem', marginBottom: '0.2rem' }}>
        {d.message}
      </div>
    );
  };

  return (
    <>
      {/* User-facing diagnostics */}
      {hasUserDiags && (
        <div className="job-detail-section">
          <div className="job-detail-section-title">Diagnostics</div>
          <div style={{ fontSize: '0.75rem' }}>
            {userDiagnostics.map((d, i) => renderBadge(d, i))}
          </div>
        </div>
      )}

      {/* Internal/developer diagnostics (collapsible) */}
      {hasInternalDiags && (
        <div className="job-detail-section">
          <div
            className="job-detail-section-title"
            style={{ cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setShowInternal(prev => !prev)}
          >
            {showInternal ? '▾' : '▸'} Developer diagnostics ({internalDiagnostics.length})
          </div>
          {showInternal && (
            <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
              {internalDiagnostics.map((d, i) => renderBadge(d, i))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
