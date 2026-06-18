/* ------------------------------------------------------------------ */
/*  OutputFilesSummaryCards                                            */
/* ------------------------------------------------------------------ */
import type { OutputFilesSummaryResponse } from '../../api/types';

interface SummaryCard {
  label: string;
  value: number;
  className?: string;
}

interface Props {
  summary: OutputFilesSummaryResponse | null | undefined;
  loading?: boolean;
}

export default function OutputFilesSummaryCards({ summary, loading }: Props) {
  if (loading) {
    return <div className="loading"><span className="spinner" /> Loading summary...</div>;
  }

  if (!summary) {
    return null;
  }

  const cards: SummaryCard[] = [
    { label: 'Files',    value: summary.files_count },
    { label: 'Mods',    value: summary.mods_count },
    { label: 'Groups',  value: summary.groups_count },
    { label: 'Analyzed',value: summary.analyzed_count, className: 'badge badge-info' },
    { label: 'Passed',  value: summary.passed_count,   className: 'badge badge-success' },
    { label: 'Warnings',value: summary.warning_count,  className: 'badge badge-warning' },
    { label: 'Failed',  value: summary.failed_count,   className: 'badge badge-error' },
    { label: 'Errors',  value: summary.error_count,    className: 'badge badge-error' },
    { label: 'Missing', value: summary.missing_count,  className: 'badge badge-warning' },
    { label: 'Stale',   value: summary.stale_count,    className: 'badge badge-warning' },
  ];

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
      {cards.map(c => (
        <div
          key={c.label}
          className="card"
          style={{
            flex: '0 0 auto',
            minWidth: 80,
            textAlign: 'center',
            padding: '0.5rem 0.75rem',
          }}
        >
          <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{c.value}</div>
          {c.className ? (
            <span className={c.className} style={{ fontSize: '0.6rem', marginTop: '0.2rem' }}>{c.label}</span>
          ) : (
            <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{c.label}</div>
          )}
        </div>
      ))}
    </div>
  );
}
