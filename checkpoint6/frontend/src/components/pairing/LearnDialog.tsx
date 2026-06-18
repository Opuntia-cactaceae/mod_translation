import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../App';
import { usePairingLearning } from '../../hooks/usePairingLearning';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface LearnDialogProps {
  open: boolean;
  projectId: string;
  hasLearnablePairs: boolean;
  /** Number of manual-status pairs in the current project. */
  manualPairCount?: number;
  /** Number of accepted-status pairs in the current project. */
  acceptedPairCount?: number;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Inline style helpers                                               */
/* ------------------------------------------------------------------ */

const styles = {
  intro: {
    color: 'var(--color-text-muted)',
    fontSize: 13,
    lineHeight: 1.5,
    marginBottom: 16,
  },
  sectionTitle: {
    fontWeight: 600,
    fontSize: 13,
    marginBottom: 8,
    color: '#ccc',
  },
  optionGrid: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    marginBottom: 16,
  },
  option: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    borderRadius: 'var(--radius)',
    background: 'var(--color-surface-2)',
    cursor: 'pointer',
    fontSize: 13,
  },
  optionLabel: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  summaryCard: {
    padding: '10px 12px',
    background: 'var(--color-surface-2)',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--color-border)',
    fontSize: 13,
    marginBottom: 16,
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between' as const,
    padding: '3px 0',
  },
  resultCard: {
    marginTop: 12,
    padding: '10px 12px',
    background: 'var(--color-surface-2)',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--color-border)',
  },
  btnRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  disabledHint: { color: 'var(--color-text-muted)', fontSize: 12, marginTop: 6 },
  emptyBlock: {
    padding: '12px',
    borderRadius: 'var(--radius)',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-muted)',
    fontSize: 13,
    textAlign: 'center' as const,
    marginBottom: 16,
  },
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function LearnDialog({
  open,
  projectId,
  hasLearnablePairs,
  manualPairCount = 0,
  acceptedPairCount = 0,
  onClose,
}: LearnDialogProps) {
  const { showToast } = useToast();
  const navigate = useNavigate();

  /* ---- shared hook ---- */
  const {
    includeManual,
    setIncludeManual,
    includeAccepted,
    setIncludeAccepted,
    useAlignment,
    setUseAlignment,
    learning,
    result,
    error,
    profiles,
    selectedProfileId,
    setSelectedProfileId,
    learn,
    reloadProfiles,
  } = usePairingLearning(open ? projectId : null, hasLearnablePairs);

  /* ---- toast on successful learning result, reload profiles ---- */
  useEffect(() => {
    if (result && !result.error) {
      showToast('Learning completed successfully');
      reloadProfiles();
    }
  }, [result, showToast]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- handlers ---- */
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  /* ---- Profile name lookup for post-learning result ---- */
  const targetProfileInfo = useMemo(() => {
    if (!result) return null;
    const targetProfile = profiles.find((p) => p.id === result.profile_id);
    return {
      id: result.profile_id,
      name: targetProfile?.name || result.profile_id,
      isPairingConvention: targetProfile ? targetProfile.name.startsWith('_pairs_') : false,
    };
  }, [result, profiles]);

  /* ---- determine why Learn is disabled ---- */
  const disableReason = useMemo(() => {
    if (!hasLearnablePairs) {
      if (manualPairCount === 0 && acceptedPairCount === 0) {
        return 'No manual or accepted pairs available. Create pairs and accept them to enable learning.';
      }
      return 'No learnable pairs available.';
    }
    if (!includeManual && !includeAccepted) {
      return 'At least one pair type must be selected.';
    }
    if (includeManual && manualPairCount === 0) {
      return 'Manual pairs selected but none are available.';
    }
    if (includeAccepted && acceptedPairCount === 0) {
      return 'Accepted pairs selected but none are available.';
    }
    return null;
  }, [hasLearnablePairs, manualPairCount, acceptedPairCount, includeManual, includeAccepted]);

  const canLearn = (includeManual && manualPairCount > 0) || (includeAccepted && acceptedPairCount > 0);

  /* ---- render ---- */
  if (!open) return null;

  return (
    <div className="modal-overlay" onPointerDown={handleOverlayClick}>
      <div className="modal-content" style={{ maxWidth: 520 }}>
        {/* ---- header ---- */}
        <div className="modal-header">
          <h2>Learn from Pairs</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        {/* ---- body ---- */}
        <div className="modal-body">
          {/* Intro text */}
          <p style={styles.intro}>
            Extract protection patterns from your paired source and translated files.
            Selected file pairs are analysed to automatically generate protection
            candidates, which can be reviewed and promoted to active rules.
          </p>

          {/* Error alert */}
          {error && (
            <div className="alert alert-error" style={{ marginBottom: 12 }}>
              {error}
            </div>
          )}

          {/* ======================================================== */}
          {/*  Pre-learning state                                       */}
          {/* ======================================================== */}
          {!result && (
            <>
              {/* Empty state when no pairs at all */}
              {!hasLearnablePairs && (
                <div style={styles.emptyBlock}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>No learnable pairs</div>
                  <div>
                    {manualPairCount === 0 && acceptedPairCount === 0
                      ? 'This project has no manual or accepted pairs. Create manual pairs in the Pairing Workspace or accept suggested pairs to enable learning.'
                      : 'No pairs are available with the current status. Create new pairs or change pair statuses to proceed.'}
                  </div>
                </div>
              )}

              {/* Options section */}
              <div style={styles.sectionTitle}>Options</div>
              <div style={styles.optionGrid}>
                {/* Manual pairs */}
                <label style={styles.option}>
                  <span style={styles.optionLabel}>
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={includeManual}
                      onChange={(e) => setIncludeManual(e.target.checked)}
                    />
                    <span>Include manual pairs</span>
                  </span>
                  <span
                    className={`badge ${manualPairCount > 0 ? 'badge-success' : 'badge-muted'}`}
                    style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                  >
                    {manualPairCount} available
                  </span>
                </label>

                {/* Accepted pairs */}
                <label style={styles.option}>
                  <span style={styles.optionLabel}>
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={includeAccepted}
                      onChange={(e) => setIncludeAccepted(e.target.checked)}
                    />
                    <span>Include accepted pairs</span>
                  </span>
                  <span
                    className={`badge ${acceptedPairCount > 0 ? 'badge-success' : 'badge-muted'}`}
                    style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                  >
                    {acceptedPairCount} available
                  </span>
                </label>

                {/* Alignment */}
                <label style={styles.option}>
                  <span style={styles.optionLabel}>
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={useAlignment}
                      onChange={(e) => setUseAlignment(e.target.checked)}
                    />
                    <span>
                      Use saved normalisation settings when building learning samples
                    </span>
                  </span>
                  <span
                    className="badge badge-info"
                    style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                  >
                    {useAlignment ? 'ON' : 'OFF'}
                  </span>
                </label>
              </div>

              {/* Summary card */}
              <div style={styles.sectionTitle}>Summary</div>
              <div style={styles.summaryCard}>
                <div style={styles.summaryRow}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Manual pairs</span>
                  <span style={{ fontWeight: 600 }}>
                    {includeManual
                      ? `${manualPairCount} included`
                      : 'Excluded'}
                  </span>
                </div>
                <div style={styles.summaryRow}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Accepted pairs</span>
                  <span style={{ fontWeight: 600 }}>
                    {includeAccepted
                      ? `${acceptedPairCount} included`
                      : 'Excluded'}
                  </span>
                </div>
                <div style={styles.summaryRow}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Normalization</span>
                  <span style={{ fontWeight: 600 }}>
                    {useAlignment ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div style={{ ...styles.summaryRow, borderTop: '1px solid var(--color-border)', paddingTop: 6, marginTop: 2 }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Protection profile</span>
                  <span style={{ fontWeight: 600 }}>
                    {selectedProfileId
                      ? (profiles.find((p) => p.id === selectedProfileId)?.name ?? 'Selected')
                      : 'Auto-create new'}
                  </span>
                </div>
              </div>

              {/* Profile selector */}
              {profiles.length > 0 && (
                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label
                    style={{ fontSize: 12, display: 'block', marginBottom: 4, color: '#ccc' }}
                  >
                    Protection Profile
                  </label>
                  <select
                    className="form-control"
                    value={selectedProfileId || ''}
                    onChange={(e) => setSelectedProfileId(e.target.value || null)}
                    style={{ fontSize: 13 }}
                  >
                    <option value="">Auto-create new</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Learn button */}
              <div>
                <button
                  className="btn btn-primary"
                  disabled={learning || !canLearn}
                  onClick={learn}
                  style={{ fontSize: 14, padding: '8px 24px' }}
                >
                  {learning ? 'Learning...' : 'Learn'}
                </button>
                {disableReason && !learning && (
                  <div style={styles.disabledHint}>{disableReason}</div>
                )}
              </div>

              {/* Loading spinner */}
              {learning && (
                <div
                  style={{
                    marginTop: 12,
                    color: 'var(--color-text-muted)',
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                  Learning from pairs...
                </div>
              )}
            </>
          )}

          {/* ======================================================== */}
          {/*  Post-learning result                                     */}
          {/* ======================================================== */}
          {result && (
            <div>
              {result.error && (
                <div className="alert alert-warning" style={{ marginBottom: 12 }}>
                  {result.error}
                </div>
              )}

              {/* Target profile */}
              {targetProfileInfo && (
                <div style={styles.resultCard}>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Target profile: </span>
                    <strong>{targetProfileInfo.name}</strong>
                    {targetProfileInfo.isPairingConvention && (
                      <span
                        className="badge badge-info"
                        style={{ marginLeft: 6, fontSize: 10 }}
                      >
                        Pairing project profile
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Result table */}
              <table
                className="summary-table"
                style={{ width: '100%', marginTop: 12, fontSize: 13 }}
              >
                <tbody>
                  <tr>
                    <td style={{ color: 'var(--color-text-muted)', padding: '4px 8px' }}>
                      Samples collected
                    </td>
                    <td style={{ fontWeight: 600, textAlign: 'right', padding: '4px 8px' }}>
                      {result.samples_collected}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--color-text-muted)', padding: '4px 8px' }}>
                      Samples analysed
                    </td>
                    <td style={{ fontWeight: 600, textAlign: 'right', padding: '4px 8px' }}>
                      {result.samples_used}
                    </td>
                  </tr>
                  {result.samples_truncated > 0 && (
                    <tr>
                      <td style={{ color: 'var(--color-text-muted)', padding: '4px 8px' }}>
                        Samples truncated
                      </td>
                      <td style={{ fontWeight: 600, textAlign: 'right', padding: '4px 8px', color: 'var(--color-warning, #f59e0b)' }}>
                        {result.samples_truncated}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td style={{ color: 'var(--color-text-muted)', padding: '4px 8px' }}>
                      Samples added
                    </td>
                    <td style={{ fontWeight: 600, textAlign: 'right', padding: '4px 8px' }}>
                      {result.samples_added}
                    </td>
                  </tr>
                  {result.samples_duplicate_skipped > 0 && (
                    <tr>
                      <td style={{ color: 'var(--color-text-muted)', padding: '4px 8px' }}>
                        Samples duplicate skipped
                      </td>
                      <td style={{ fontWeight: 600, textAlign: 'right', padding: '4px 8px', color: 'var(--color-warning, #f59e0b)' }}>
                        {result.samples_duplicate_skipped}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td style={{ color: 'var(--color-text-muted)', padding: '4px 8px' }}>
                      New candidates
                    </td>
                    <td style={{ fontWeight: 600, textAlign: 'right', padding: '4px 8px' }}>
                      {result.candidates_new}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--color-text-muted)', padding: '4px 8px' }}>
                      Candidates updated
                    </td>
                    <td style={{ fontWeight: 600, textAlign: 'right', padding: '4px 8px' }}>
                      {result.candidates_updated}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--color-text-muted)', padding: '4px 8px' }}>
                      Total candidates
                    </td>
                    <td style={{ fontWeight: 600, textAlign: 'right', padding: '4px 8px' }}>
                      {result.total_candidates}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--color-text-muted)', padding: '4px 8px' }}>
                      Files processed
                    </td>
                    <td style={{ fontWeight: 600, textAlign: 'right', padding: '4px 8px' }}>
                      {result.files_processed}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--color-text-muted)', padding: '4px 8px' }}>
                      Normalised pairs used
                    </td>
                    <td style={{ fontWeight: 600, textAlign: 'right', padding: '4px 8px' }}>
                      {result.normalized_pairs_used}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ color: 'var(--color-text-muted)', padding: '4px 8px' }}>
                      Raw pairs used
                    </td>
                    <td style={{ fontWeight: 600, textAlign: 'right', padding: '4px 8px' }}>
                      {result.raw_pairs_used}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Review Candidates button */}
              <div style={styles.btnRow}>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    navigate(`/protection-rules?profile=${result.profile_id}`);
                    onClose();
                  }}
                >
                  Review Candidates
                </button>
                <button className="btn btn-sm" onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ---- footer (only shown in pre-learning state) ---- */}
        {!result && (
          <div className="modal-footer">
            <button className="btn btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
