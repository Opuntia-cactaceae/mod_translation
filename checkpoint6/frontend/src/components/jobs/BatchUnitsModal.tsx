import { type TraceUnitModel } from '../../domain';
import TranslationUnitsTable from './TranslationUnitsTable';

interface BatchUnitsModalProps {
  jobId: string;
  batchNo: number;
  units: TraceUnitModel[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}

/** Modal that shows translation units for a specific batch.
 *  Triggered by clicking a BATCH_COMPLETED event in the Events block. */
export default function BatchUnitsModal({
  batchNo,
  units,
  loading,
  error,
  onClose,
  onRetry,
}: BatchUnitsModalProps) {
  const translatedCount = units.filter(u => u.status === 'translated').length;
  const failedCount = units.filter(u => u.status === 'failed').length;
  const cachedCount = units.filter(u => u.status === 'cached').length;
  const sentCount = units.filter(u => u.status === 'sent').length;
  const pendingCount = units.filter(u => u.status === 'pending').length;

  const countStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
    marginTop: '0.25rem',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ width: '750px' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span style={{ fontWeight: 600 }}>Batch #{batchNo} details</span>
            {!loading && !error && units.length > 0 && (
              <div style={countStyle}>
                <span>Total: <strong>{units.length}</strong></span>
                {translatedCount > 0 && (
                  <span style={{ color: 'var(--color-success)' }}>Completed: <strong>{translatedCount}</strong></span>
                )}
                {failedCount > 0 && (
                  <span style={{ color: 'var(--color-error)' }}>Failed: <strong>{failedCount}</strong></span>
                )}
                {cachedCount > 0 && (
                  <span style={{ color: 'var(--color-info)' }}>Cached: <strong>{cachedCount}</strong></span>
                )}
                {pendingCount > 0 && (
                  <span style={{ color: 'var(--color-text-muted)' }}>Pending: <strong>{pendingCount}</strong></span>
                )}
                {sentCount > 0 && (
                  <span style={{ color: 'var(--color-warning)' }}>In progress: <strong>{sentCount}</strong></span>
                )}
              </div>
            )}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-body" style={{ minHeight: '100px', fontSize: '0.85rem' }}>
          {loading && (
            <div className="loading">
              <span className="spinner" /> Loading batch units...
            </div>
          )}

          {!loading && error && (
            <div
              className="alert alert-error"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>{error}</span>
              <button className="btn btn-sm" onClick={onRetry}>
                Retry
              </button>
            </div>
          )}

          {!loading && !error && units.length === 0 && (
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', padding: '0.5rem' }}>
              No units found for this batch.
            </div>
          )}

          {!loading && !error && units.length > 0 && (
            <TranslationUnitsTable
              units={units}
              emptyMessage="No units found for this batch."
              maxHeight="400px"
              showFilePath
              showError
            />
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
