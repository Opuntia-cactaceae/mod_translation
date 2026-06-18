import {
  getTraceUnitBadgeClass,
  getTraceUnitStatusLabel,
  type TraceUnitModel,
} from '../../domain';

interface TranslationUnitsTableProps {
  units: TraceUnitModel[];
  emptyMessage?: string;
  maxHeight?: string;
  showFilePath?: boolean;
  showError?: boolean;
}

/** Shared component for displaying a scrollable table of translation units.
 *
 * Used by both the Live Translations section and the Batch Units modal.
 * Optionally shows file_path and error columns when ``showFilePath`` /
 * ``showError`` are set.
 */
export default function TranslationUnitsTable({
  units,
  emptyMessage = 'No translation units yet.',
  maxHeight = '400px',
  showFilePath = false,
  showError = false,
}: TranslationUnitsTableProps) {
  if (units.length === 0) {
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', padding: '0.5rem' }}>
        {emptyMessage}
      </div>
    );
  }

  const translatedCount = units.filter(u => u.status === 'translated').length;
  const failedCount = units.filter(u => u.status === 'failed').length;
  const cachedCount = units.filter(u => u.status === 'cached').length;
  const pendingCount = units.filter(u => u.status === 'pending').length;

  const extraColCount = (showFilePath ? 1 : 0) + (showError ? 1 : 0);
  const srcColWidth = `${Math.max(20, 35 - extraColCount * 5)}%`;

  return (
    <div>
      {(translatedCount > 0 || failedCount > 0 || cachedCount > 0 || pendingCount > 0) && (
        <div style={{ fontSize: '0.7rem', marginBottom: '0.25rem', color: 'var(--color-text-muted)' }}>
          {translatedCount > 0 && <span style={{ color: 'var(--color-success)', marginRight: '0.5rem' }}>{translatedCount} ok</span>}
          {failedCount > 0 && <span style={{ color: 'var(--color-error)', marginRight: '0.5rem' }}>{failedCount} failed</span>}
          {cachedCount > 0 && <span style={{ color: 'var(--color-info)', marginRight: '0.5rem' }}>{cachedCount} cached</span>}
          {pendingCount > 0 && <span style={{ marginRight: '0.5rem' }}>{pendingCount} pending</span>}
        </div>
      )}
      <div style={{ maxHeight, overflowY: 'auto', fontSize: '0.75rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ padding: '0.25rem 0.5rem', textAlign: 'left', width: srcColWidth }}>Source</th>
              <th style={{ padding: '0.25rem 0.5rem', textAlign: 'left', width: srcColWidth }}>Translation</th>
              <th style={{ padding: '0.25rem 0.5rem', textAlign: 'center', width: '80px' }}>Status</th>
              <th style={{ padding: '0.25rem 0.5rem', textAlign: 'left', width: '100px' }}>Key</th>
              {showFilePath && (
                <th style={{ padding: '0.25rem 0.5rem', textAlign: 'left', width: '120px' }}>File</th>
              )}
              {showError && (
                <th style={{ padding: '0.25rem 0.5rem', textAlign: 'left', width: '100px' }}>Error</th>
              )}
            </tr>
          </thead>
          <tbody>
            {units.map((u, i) => (
              <tr key={u.unitId || i} style={{ borderBottom: '1px solid var(--color-border)', verticalAlign: 'top' }}>
                <td style={{ padding: '0.25rem 0.5rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  <code style={{ fontSize: '0.7rem' }}>{u.sourceText || '\u2014'}</code>
                </td>
                <td style={{ padding: '0.25rem 0.5rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {u.status === 'translated' || u.status === 'cached' ? (
                    <code style={{ fontSize: '0.7rem', color: 'var(--color-success)' }}>{u.translatedText || '\u2014'}</code>
                  ) : u.status === 'failed' ? (
                    <span style={{ color: 'var(--color-error)' }}>{u.errorMessage || 'Failed'}</span>
                  ) : u.status === 'sent' ? (
                    <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Waiting for response...</span>
                  ) : (
                    <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Pending</span>
                  )}
                </td>
                <td style={{ padding: '0.25rem 0.5rem', textAlign: 'center' }}>
                  <span className={`badge ${getTraceUnitBadgeClass(u.status)}`} style={{ fontSize: '0.6rem' }}>
                    {getTraceUnitStatusLabel(u.status)}
                  </span>
                </td>
                <td style={{ padding: '0.25rem 0.5rem', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
                  {u.key || u.filePath?.split('/').pop() || '\u2014'}
                </td>
                {showFilePath && (
                  <td style={{ padding: '0.25rem 0.5rem', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
                    {u.filePath ? (
                      <span title={u.filePath}>{u.filePath.split('/').pop()}</span>
                    ) : '\u2014'}
                  </td>
                )}
                {showError && (
                  <td style={{ padding: '0.25rem 0.5rem', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.65rem' }}>
                    {u.errorMessage ? (
                      <span style={{ color: 'var(--color-error)' }} title={u.errorMessage}>{u.errorMessage}</span>
                    ) : '\u2014'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
