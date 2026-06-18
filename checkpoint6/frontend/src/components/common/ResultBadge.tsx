/* ------------------------------------------------------------------ */
/*  ResultBadge — shared analysis result status display                */
/*  Used by table, tree, details modal, and editor.                    */
/* ------------------------------------------------------------------ */
import React from 'react';
import FreshnessBadge from './FreshnessBadge';

const RESULT_LABELS: Record<string, string> = {
  passed: 'Valid',
  warning: 'Warning',
  failed: 'Failed',
  error: 'Error',
};

const RESULT_CLASSES: Record<string, string> = {
  passed: 'badge badge-success',
  warning: 'badge badge-warning',
  failed: 'badge badge-error',
  error: 'badge badge-error',
};

interface ResultBadgeProps {
  status: string | undefined | null;
  errorsCount?: number;
  warningsCount?: number;
  /** Optional freshness state shown as a separate badge alongside the result. */
  freshnessState?: string | undefined | null;
}

export default function ResultBadge({
  status,
  errorsCount = 0,
  warningsCount = 0,
  freshnessState,
}: ResultBadgeProps) {
  if (!status) {
    // No analysis result — show only freshness if available
    if (freshnessState) {
      return <FreshnessBadge state={freshnessState} />;
    }
    return <span className="badge badge-muted">Not analyzed</span>;
  }

  const label = RESULT_LABELS[status] ?? status;
  const cls = RESULT_CLASSES[status] ?? 'badge badge-muted';
  const counts =
    (errorsCount > 0 ? ` E:${errorsCount}` : '') +
    (warningsCount > 0 ? ` W:${warningsCount}` : '');

  return (
    <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
      <span className={cls}>
        {label}
        {counts}
      </span>
      {freshnessState && <FreshnessBadge state={freshnessState} />}
    </span>
  );
}
