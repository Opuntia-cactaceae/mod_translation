/* ------------------------------------------------------------------ */
/*  OutputFileStatusBadge                                              */
/*  Renders file status + freshness badge.                             */
/* ------------------------------------------------------------------ */
import FreshnessBadge from '../common/FreshnessBadge';

interface OutputFileStatusBadgeProps {
  status: string;
  stale?: boolean;
  analysisState?: string; // "current" | "outdated" | "not_analyzed" | "unknown"
}

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  ready:             { label: 'Ready',             className: 'badge badge-success' },
  missing_source:    { label: 'Missing Source',    className: 'badge badge-error' },
  missing_translated:{ label: 'Missing Translated',className: 'badge badge-warning' },
  invalid:           { label: 'Invalid',           className: 'badge badge-error' },
};

export default function OutputFileStatusBadge({ status, stale, analysisState }: OutputFileStatusBadgeProps) {
  const def = STATUS_MAP[status] ?? { label: status, className: 'badge badge-muted' };
  return (
    <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
      <span className={def.className}>{def.label}</span>
      {/* Show freshness badge when it exists and is meaningful.
          Hide "unknown" when stale is false (no information value). */}
      {analysisState && (
        analysisState !== 'unknown' || stale ? (
          <FreshnessBadge state={analysisState} />
        ) : null
      )}
    </span>
  );
}
