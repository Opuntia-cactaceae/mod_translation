/* ------------------------------------------------------------------ */
/*  FreshnessBadge — shared freshness state display                    */
/*  Used by table, tree, details modal, and editor.                    */
/* ------------------------------------------------------------------ */

export const FRESHNESS_LABELS: Record<string, string> = {
  current: 'Current',
  outdated: 'Outdated',
  not_analyzed: 'No Analysis',
};

export const FRESHNESS_CLASSES: Record<string, string> = {
  current: 'badge badge-success',
  outdated: 'badge badge-warning',
  not_analyzed: 'badge badge-muted',
};

export const FRESHNESS_TITLES: Record<string, string> = {
  current: 'Analysis matches current file content',
  outdated: 'File content changed since last analysis',
  not_analyzed: 'No analysis has been run',
};

interface FreshnessBadgeProps {
  state: string | undefined | null;
}

export default function FreshnessBadge({ state }: FreshnessBadgeProps) {
  if (!state) return null;
  const label = FRESHNESS_LABELS[state];
  if (!label) return null;
  const cls = FRESHNESS_CLASSES[state] ?? 'badge badge-muted';
  const title = FRESHNESS_TITLES[state] ?? '';
  return (
    <span className={cls} title={title}>
      {label}
    </span>
  );
}
