/* ------------------------------------------------------------------ */
/*  OutputFileStatusBadge                                              */
/* ------------------------------------------------------------------ */

interface OutputFileStatusBadgeProps {
  status: string;
  stale?: boolean;
  analysisState?: string; // "valid" | "outdated" | "missing"
}

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  ready:             { label: 'Ready',             className: 'badge badge-success' },
  missing_source:    { label: 'Missing Source',    className: 'badge badge-error' },
  missing_translated:{ label: 'Missing Translated',className: 'badge badge-warning' },
  invalid:           { label: 'Invalid',           className: 'badge badge-error' },
};

function getAnalysisBadge(state: string | undefined, stale: boolean | undefined): { label: string; className: string; show: boolean } {
  // Use analysisState if available (new API)
  if (state) {
    switch (state) {
      case 'valid':
        return { label: 'Valid', className: 'badge badge-success', show: true };
      case 'outdated':
        return { label: 'Outdated', className: 'badge badge-warning', show: true };
      case 'missing':
        return { label: 'No Analysis', className: 'badge badge-muted', show: true };
      default:
        return { label: 'Stale', className: 'badge badge-warning', show: stale ?? false };
    }
  }
  // Fall back to stale boolean (legacy)
  return {
    label: 'Stale',
    className: 'badge badge-warning',
    show: stale ?? false,
  };
}

export default function OutputFileStatusBadge({ status, stale, analysisState }: OutputFileStatusBadgeProps) {
  const def = STATUS_MAP[status] ?? { label: status, className: 'badge badge-muted' };
  const analysisBadge = getAnalysisBadge(analysisState, stale);
  return (
    <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
      <span className={def.className}>{def.label}</span>
      {analysisBadge.show && (
        <span
          className={analysisBadge.className}
          title={
            analysisState === 'outdated'
              ? 'File content changed since last analysis'
              : analysisState === 'valid'
                ? 'Analysis matches current file content'
                : analysisState === 'missing'
                  ? 'No analysis has been run'
                  : 'File changed after last analysis'
          }
        >
          {analysisBadge.label}
        </span>
      )}
    </span>
  );
}
