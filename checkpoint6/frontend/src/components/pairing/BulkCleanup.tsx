import { useState, useCallback, useRef } from 'react';
import { api, ApiError } from '../../App';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { pairDraftStore } from '../../utils/pairDraftStore';
import type {
  PreviewFilenameResponse,
  PreviewFilenameItem,
  FindIdenticalResponse,
  IdenticalPairInfo,
  ExactLineMatchPreviewResponse,
  ExactLineMatchItem,
} from '../../api/types';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface BulkCleanupProps {
  projectId: string;
  /** Called after pairs are deleted, so the parent can refresh. */
  onDeleted: (count: number) => void;
  /** When true, bulk delete actions show a confirmation dialog first. */
  dirty?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function BulkCleanup({ projectId, onDeleted, dirty }: BulkCleanupProps) {
  const [open, setOpen] = useState(false);

  /* ---- Dirty-guard dialog state ---- */
  const [dirtyConfirmOpen, setDirtyConfirmOpen] = useState(false);
  const pendingDeleteAction = useRef<(() => Promise<void>) | null>(null);

  /* ---- "Delete by filename" state ---- */
  const [filenameSubstring, setFilenameSubstring] = useState('');
  const [filenamePreview, setFilenamePreview] = useState<PreviewFilenameResponse | null>(null);
  const [filenameLoading, setFilenameLoading] = useState(false);
  const [filenameError, setFilenameError] = useState<string | null>(null);

  /* ---- "Identical pairs" state ---- */
  const [identicalMode, setIdenticalMode] = useState<'chars' | 'lines'>('chars');
  const [identicalResult, setIdenticalResult] = useState<FindIdenticalResponse | null>(null);
  const [identicalLoading, setIdenticalLoading] = useState(false);
  const [identicalError, setIdenticalError] = useState<string | null>(null);

  /* ---- "Exact line match" state ---- */
  const [thresholdPercent, setThresholdPercent] = useState(100);
  const [exactLinePreview, setExactLinePreview] = useState<ExactLineMatchPreviewResponse | null>(null);
  const [exactLineLoading, setExactLineLoading] = useState(false);
  const [exactLineError, setExactLineError] = useState<string | null>(null);

  /* ---- Shared delete state ---- */
  const [deleting, setDeleting] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);

  /* ---- Preview by filename ---- */
  const handlePreviewFilename = useCallback(async () => {
    const trimmed = filenameSubstring.trim();
    if (!trimmed) return;
    setFilenameLoading(true);
    setFilenameError(null);
    setFilenamePreview(null);
    try {
      const resp = await api.previewFilenamePairs(projectId, { substring: trimmed });
      setFilenamePreview(resp);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Failed to preview';
      setFilenameError(msg);
    } finally {
      setFilenameLoading(false);
    }
  }, [filenameSubstring, projectId]);

  /* ---- Find identical pairs ---- */
  const handleFindIdentical = useCallback(async () => {
    setIdenticalLoading(true);
    setIdenticalError(null);
    setIdenticalResult(null);
    try {
      const resp = await api.findIdenticalPairs(projectId, { mode: identicalMode });
      setIdenticalResult(resp);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Failed to find identical pairs';
      setIdenticalError(msg);
    } finally {
      setIdenticalLoading(false);
    }
  }, [projectId, identicalMode]);

  /* ---- Exact line match preview ---- */
  const handleExactLinePreview = useCallback(async () => {
    setExactLineLoading(true);
    setExactLineError(null);
    setExactLinePreview(null);
    try {
      const resp = await api.exactLineMatchPreview(projectId, { threshold_percent: thresholdPercent });
      setExactLinePreview(resp);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Failed to preview';
      setExactLineError(msg);
    } finally {
      setExactLineLoading(false);
    }
  }, [projectId, thresholdPercent]);

  /* ================================================================ */
  /*  Inner delete logic (extracted for dirty guard)                    */
  /* ================================================================ */

  const executeDeleteInner = useCallback(async (pairIds: string[]) => {
    if (pairIds.length === 0) return;
    setDeleting(true);
    try {
      const resp = await api.bulkDeletePairs(projectId, { pair_ids: pairIds });
      onDeleted(resp.deleted_count);
      // Clean up drafts for deleted pairs
      pairIds.forEach((id) => pairDraftStore.clearPair(id));
      setFilenamePreview(null);
      setIdenticalResult(null);
      setExactLinePreview(null);
      setPendingDeleteIds([]);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Failed to delete';
      window.alert(msg);
    } finally {
      setDeleting(false);
    }
  }, [projectId, onDeleted]);

  const exactLineDeleteInner = useCallback(async () => {
    setDeleting(true);
    try {
      const resp = await api.exactLineMatchDelete(projectId, { threshold_percent: thresholdPercent });
      onDeleted(resp.deleted_count);
      // Exact-line delete doesn't return deleted IDs — clear all drafts
      pairDraftStore.clearAll();
      setExactLinePreview(null);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : 'Failed to delete';
      window.alert(msg);
    } finally {
      setDeleting(false);
    }
  }, [projectId, thresholdPercent, onDeleted]);

  /* ---- Exact line match delete (guarded) ---- */
  const handleExactLineDelete = useCallback(async () => {
    if (dirty) {
      pendingDeleteAction.current = exactLineDeleteInner;
      setDirtyConfirmOpen(true);
      return;
    }
    await exactLineDeleteInner();
  }, [dirty, exactLineDeleteInner]);

  /* ---- Execute delete (guarded) ---- */
  const handleExecuteDelete = useCallback(async (pairIds: string[]) => {
    if (dirty) {
      pendingDeleteAction.current = () => executeDeleteInner(pairIds);
      setDirtyConfirmOpen(true);
      return;
    }
    await executeDeleteInner(pairIds);
  }, [dirty, executeDeleteInner]);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div className="bulk-cleanup" style={{ borderTop: '1px solid var(--color-border)', marginTop: '0.5rem', paddingTop: '0.5rem' }}>
      <button
        className="btn btn-sm"
        onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', textAlign: 'left', fontWeight: 600, fontSize: '0.75rem' }}
      >
        {open ? '▾' : '▸'} Bulk Cleanup
      </button>

      {open && (
        <div style={{ padding: '0.5rem 0.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* ========================================================== */}
          {/*  Section 1: Delete by filename                              */}
          {/* ========================================================== */}
          <div>
            <div className="subsection-title">
              Delete pairs by filename
            </div>
            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
              <input
                type="text"
                className="form-control"
                placeholder="Enter word/substring..."
                value={filenameSubstring}
                onChange={(e) => setFilenameSubstring(e.target.value)}
                style={{ flex: 1, fontSize: '0.72rem', padding: '0.2rem 0.4rem' }}
              />
              <button
                className="btn btn-sm"
                onClick={handlePreviewFilename}
                disabled={!filenameSubstring.trim() || filenameLoading}
              >
                {filenameLoading ? 'Loading...' : 'Preview'}
              </button>
            </div>

            {filenameError && (
              <div style={{ color: 'var(--color-error)', fontSize: '0.68rem', marginTop: '0.3rem' }}>
                {filenameError}
              </div>
            )}

            {filenamePreview && (
              <FilenamePreviewResult
                preview={filenamePreview}
                deleting={deleting}
                onDelete={() => handleExecuteDelete(filenamePreview.pair_ids)}
                onCancelPreview={() => setFilenamePreview(null)}
              />
            )}
          </div>

          {/* ========================================================== */}
          {/*  Section 2: Delete identical pairs                          */}
          {/* ========================================================== */}
          <div>
            <div className="subsection-title">
              Delete identical pairs
            </div>
            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
              <select
                className="form-control"
                value={identicalMode}
                onChange={(e) => setIdenticalMode(e.target.value as 'chars' | 'lines')}
                style={{ width: 'auto', fontSize: '0.72rem', padding: '0.2rem 0.3rem' }}
              >
                <option value="chars">By characters (exact)</option>
                <option value="lines">By lines</option>
              </select>
              <button
                className="btn btn-sm"
                onClick={handleFindIdentical}
                disabled={identicalLoading}
              >
                {identicalLoading ? 'Scanning...' : 'Find identical'}
              </button>
            </div>

            {identicalError && (
              <div style={{ color: 'var(--color-error)', fontSize: '0.68rem', marginTop: '0.3rem' }}>
                {identicalError}
              </div>
            )}

            {identicalResult && (
              <IdenticalResultSection
                result={identicalResult}
                mode={identicalMode}
                deleting={deleting}
                onDelete={() => handleExecuteDelete(identicalResult.pair_ids)}
                onCancelPreview={() => setIdenticalResult(null)}
              />
            )}
          </div>

          {/* ========================================================== */}
          {/*  Section 3: Exact line match threshold                      */}
          {/* ========================================================== */}
          <div>
            <div className="subsection-title">
              Exact line match threshold
            </div>
            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
              <input
                type="number"
                className="form-control"
                min={0}
                max={100}
                step={1}
                value={thresholdPercent}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) setThresholdPercent(Math.max(0, Math.min(100, v)));
                }}
                style={{ width: '70px', fontSize: '0.72rem', padding: '0.2rem 0.3rem' }}
                aria-label="Exact line match threshold (%)"
              />
              <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>%</span>
              <button
                className="btn btn-sm"
                onClick={handleExactLinePreview}
                disabled={exactLineLoading}
              >
                {exactLineLoading ? 'Scanning...' : 'Preview'}
              </button>
            </div>

            {exactLineError && (
              <div style={{ color: 'var(--color-error)', fontSize: '0.68rem', marginTop: '0.3rem' }}>
                {exactLineError}
              </div>
            )}

            {exactLinePreview && (
              <ExactLineMatchResultSection
                preview={exactLinePreview}
                deleting={deleting}
                onDelete={handleExactLineDelete}
                onCancelPreview={() => setExactLinePreview(null)}
              />
            )}
          </div>
        </div>
      )}

      {/* Unsaved changes confirmation dialog */}
      <ConfirmDialog
        open={dirtyConfirmOpen}
        title="Unsaved changes"
        message="You have unsaved changes in the editor. Bulk cleanup may delete the currently open pair and its edits will be lost. Discard changes and continue?"
        confirmLabel="Discard changes"
        confirmClass="btn btn-danger"
        onConfirm={() => {
          setDirtyConfirmOpen(false);
          const action = pendingDeleteAction.current;
          pendingDeleteAction.current = null;
          action?.();
        }}
        onCancel={() => {
          setDirtyConfirmOpen(false);
          pendingDeleteAction.current = null;
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-component: filename preview result                              */
/* ------------------------------------------------------------------ */

function FilenamePreviewResult({
  preview,
  deleting,
  onDelete,
  onCancelPreview,
}: {
  preview: PreviewFilenameResponse;
  deleting: boolean;
  onDelete: () => void;
  onCancelPreview: () => void;
}) {
  if (preview.count === 0) {
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.68rem', marginTop: '0.3rem' }}>
        No pairs match the given word/substring.
      </div>
    );
  }

  return (
    <div style={{ marginTop: '0.3rem', fontSize: '0.68rem' }}>
      <div className="subsection-title">
        Found {preview.count} pair{preview.count !== 1 ? 's' : ''}
      </div>
      {preview.count > 0 && (
        <ul style={{ margin: '0.15rem 0', paddingLeft: '1rem', maxHeight: '120px', overflowY: 'auto' }}>
          {preview.examples.slice(0, 10).map((ex: PreviewFilenameItem) => (
            <li key={ex.pair_id} style={{ lineHeight: 1.4 }}>
              {ex.source_file ?? '—'} ↔ {ex.translated_file ?? '—'}
            </li>
          ))}
          {preview.count > 10 && (
            <li style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              ...and {preview.count - 10} more
            </li>
          )}
        </ul>
      )}
      <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.3rem' }}>
        <button
          className="btn btn-sm btn-danger"
          onClick={onDelete}
          disabled={deleting}
        >
          {deleting ? 'Deleting...' : 'Delete found pairs'}
        </button>
        <button
          className="btn btn-sm"
          onClick={onCancelPreview}
          disabled={deleting}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-component: identical pairs result                               */
/* ------------------------------------------------------------------ */

function IdenticalResultSection({
  result,
  mode,
  deleting,
  onDelete,
  onCancelPreview,
}: {
  result: FindIdenticalResponse;
  mode: 'chars' | 'lines';
  deleting: boolean;
  onDelete: () => void;
  onCancelPreview: () => void;
}) {
  if (result.count === 0 && result.errors === 0) {
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.68rem', marginTop: '0.3rem' }}>
        No identical pairs found (mode: {mode === 'chars' ? 'by characters' : 'by lines'}).
      </div>
    );
  }

  return (
    <div style={{ marginTop: '0.3rem', fontSize: '0.68rem' }}>
      <div className="subsection-title">
        Found {result.count} identical pair{result.count !== 1 ? 's' : ''}
        {result.errors > 0 && (
          <span style={{ color: 'var(--color-warning)', marginLeft: '0.5rem' }}>
            ({result.errors} read error{result.errors !== 1 ? 's' : ''})
          </span>
        )}
      </div>
      <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.2rem' }}>
        Mode: {mode === 'chars' ? 'exact character comparison' : 'line-by-line comparison'}
      </div>

      {result.count > 0 && (
        <ul style={{ margin: '0.15rem 0', paddingLeft: '1rem', maxHeight: '100px', overflowY: 'auto' }}>
          {result.examples.slice(0, 5).map((ex: IdenticalPairInfo) => (
            <li key={ex.pair_id} style={{ lineHeight: 1.4 }}>
              {ex.source_file} ↔ {ex.translated_file}
            </li>
          ))}
          {result.count > 5 && (
            <li style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              ...and {result.count - 5} more
            </li>
          )}
        </ul>
      )}

      {result.errors > 0 && result.error_details.length > 0 && (
        <details style={{ marginTop: '0.2rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--color-warning)' }}>
            Read errors ({result.errors})
          </summary>
          <ul style={{ paddingLeft: '1rem', margin: '0.1rem 0', maxHeight: '80px', overflowY: 'auto' }}>
            {result.error_details.slice(0, 10).map((detail, i) => (
              <li key={i} style={{ lineHeight: 1.3 }}>{detail}</li>
            ))}
          </ul>
        </details>
      )}

      {result.count > 0 && (
        <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.3rem' }}>
          <button
            className="btn btn-sm btn-danger"
            onClick={onDelete}
            disabled={deleting}
          >
            {deleting ? 'Deleting...' : 'Delete found pairs'}
          </button>
          <button
            className="btn btn-sm"
            onClick={onCancelPreview}
            disabled={deleting}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-component: exact line match result                              */
/* ------------------------------------------------------------------ */

/** CSS class for the match-percent badge. */
function lineMatchBadgeClass(percent: number): string {
  if (percent >= 70) return 'badge badge-error';
  if (percent >= 20) return 'badge badge-warning';
  return 'badge';
}

function ExactLineMatchResultSection({
  preview,
  deleting,
  onDelete,
  onCancelPreview,
}: {
  preview: ExactLineMatchPreviewResponse;
  deleting: boolean;
  onDelete: () => void;
  onCancelPreview: () => void;
}) {
  const count = preview.matches.length;

  if (count === 0) {
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.68rem', marginTop: '0.3rem' }}>
        No pairs match the threshold ({preview.threshold_percent}%).
      </div>
    );
  }

  return (
    <div style={{ marginTop: '0.3rem', fontSize: '0.68rem' }}>
      <div className="subsection-title">
        Found {count} pair{count !== 1 ? 's' : ''} at or above {preview.threshold_percent}% threshold
      </div>
      {count > 0 && (
        <ul style={{ margin: '0.15rem 0', paddingLeft: '1rem', maxHeight: '120px', overflowY: 'auto' }}>
          {preview.matches.slice(0, 10).map((m: ExactLineMatchItem) => (
            <li key={m.pair_id} style={{ lineHeight: 1.5 }}>
              <span className={lineMatchBadgeClass(m.exact_line_match_percent)} style={{ marginRight: '0.3rem' }}>
                {Math.round(m.exact_line_match_percent)}%
              </span>
              {m.source_file} ↔ {m.translated_file}
            </li>
          ))}
          {count > 10 && (
            <li style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              ...and {count - 10} more
            </li>
          )}
        </ul>
      )}
      <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.3rem' }}>
        <button
          className="btn btn-sm btn-danger"
          onClick={onDelete}
          disabled={deleting}
        >
          {deleting ? 'Deleting...' : 'Delete found pairs'}
        </button>
        <button
          className="btn btn-sm"
          onClick={onCancelPreview}
          disabled={deleting}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
