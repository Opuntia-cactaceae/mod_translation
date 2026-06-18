import { useState } from 'react';
import type { TranslationPreviewModel } from '../../domain';
import { hasBlockingDiagnostics, canStartTranslation } from '../../domain';
import { useDragSafeClose } from '../../hooks/useDragSafeClose';

interface PreviewState {
  show: boolean;
  name: string;
  filePaths: string[];
  config: Record<string, unknown>;
}

interface TranslationPreviewModalProps {
  previewState: PreviewState;
  previewData: TranslationPreviewModel | null;
  previewLoading: boolean;
  previewError: string | null;
  confirmLoading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/* ------------------------------------------------------------------ */
/*  Collapsible list helper                                            */
/* ------------------------------------------------------------------ */

const MAX_VISIBLE = 10;

function CollapsibleList({
  title,
  items,
  defaultOpen,
  danger,
}: {
  title: string;
  items: string[];
  defaultOpen?: boolean;
  danger?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [showAll, setShowAll] = useState(false);
  const truncated = !showAll && items.length > MAX_VISIBLE;
  const visible = truncated ? items.slice(0, MAX_VISIBLE) : items;

  if (items.length === 0) return null;

  return (
    <div style={{ marginTop: '0.4rem' }}>
      <button
        className="btn btn-sm"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          textAlign: 'left',
          fontSize: '0.75rem',
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
          padding: '0.3rem 0.5rem',
          cursor: 'pointer',
        }}
      >
        {open ? '▼' : '▶'} {title} ({items.length})
      </button>
      {open && (
        <div
          style={{
            marginTop: '0.25rem',
            maxHeight: '200px',
            overflowY: 'auto',
            fontSize: '0.7rem',
            padding: '0.25rem 0.5rem',
            background: danger ? 'rgba(220, 38, 38, 0.08)' : 'var(--color-surface-1)',
            borderRadius: 'var(--radius)',
            border: danger ? '1px solid rgba(220, 38, 38, 0.3)' : '1px solid var(--color-border)',
          }}
        >
          {visible.map((item, i) => (
            <div key={i} style={{ padding: '0.15rem 0', wordBreak: 'break-all', fontFamily: 'monospace' }}>
              {item}
            </div>
          ))}
          {truncated && (
            <button
              className="btn btn-sm"
              onClick={() => setShowAll(true)}
              style={{ marginTop: '0.25rem', fontSize: '0.7rem' }}
            >
              Show all ({items.length} total)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function TranslationPreviewModal({
  previewState,
  previewData,
  previewLoading,
  previewError,
  confirmLoading,
  onClose,
  onConfirm,
}: TranslationPreviewModalProps) {
  const { handleOverlayPointerDown, handleOverlayClick } = useDragSafeClose(onClose);

  if (!previewState.show) return null;

  const blocking = previewData ? hasBlockingDiagnostics(previewData) : false;
  const warnings = previewData?.warnings ?? [];
  const errors = previewData?.errors ?? [];
  const unsupportedFiles = previewData?.unsupportedFiles ?? [];
  const duplicateFiles = previewData?.duplicateFiles ?? [];
  const emptyFiles = previewData?.emptyFiles ?? [];
  const zeroUnitFiles = previewData?.zeroUnitFiles ?? [];

  return (
    <div className="modal-overlay" onPointerDown={handleOverlayPointerDown} onClick={handleOverlayClick}>
      <div className="modal-content preview-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>Translation preview: {previewState.name}</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-body">
          {previewLoading && (
            <div className="loading">
              <span className="spinner" />
              Loading preview...
            </div>
          )}
          {previewError && (
            <div className="alert alert-error">{previewError}</div>
          )}
          {previewData && (
            <div>
              {/* Summary stats */}
              <div className="preview-row">
                <span className="preview-label">Files</span>
                <span className="preview-value">{previewState.filePaths.length}</span>
              </div>
              <div className="preview-row">
                <span className="preview-label">Units</span>
                <span className="preview-value">{previewData.totalUnits}</span>
              </div>
              <div className="preview-row">
                <span className="preview-label">Batches</span>
                <span className="preview-value">{previewData.totalTasks}</span>
              </div>
              <div className="preview-row">
                <span className="preview-label">Batch size</span>
                <span className="preview-value">{previewData.batchSize}</span>
              </div>
              <div className="preview-row">
                <span className="preview-label">Cache hits</span>
                <span className="preview-value">{previewData.cacheHits}</span>
              </div>
              <div className="preview-row">
                <span className="preview-label">Cache misses</span>
                <span className="preview-value">{previewData.cacheMisses}</span>
              </div>

              {/* --- Diagnostics section --- */}
              {(blocking || warnings.length > 0 || errors.length > 0 ||
                unsupportedFiles.length > 0 || duplicateFiles.length > 0 ||
                emptyFiles.length > 0 || zeroUnitFiles.length > 0) && (
                <div style={{ marginTop: '0.75rem' }}>
                  <strong style={{ fontSize: '0.8rem' }}>Diagnostics</strong>

                  {/* Blocking errors */}
                  {blocking && (
                    <div
                      className="alert alert-error"
                      style={{ marginTop: '0.4rem', padding: '0.5rem' }}
                    >
                      <strong>Some files cannot be processed.</strong>
                      <br />
                      Translation cannot be started.
                    </div>
                  )}

                  {/* Warnings */}
                  {warnings.length > 0 && (
                    <div style={{ marginTop: '0.4rem' }}>
                      {warnings.map((w, i) => (
                        <div
                          key={i}
                          className="alert alert-warning"
                          style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', marginBottom: '0.25rem' }}
                        >
                          {w}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Parse errors */}
                  <CollapsibleList
                    title="Parse errors"
                    items={errors}
                    danger
                    defaultOpen
                  />

                  {/* Unsupported files */}
                  <CollapsibleList
                    title="Unsupported files"
                    items={unsupportedFiles}
                    danger
                  />

                  {/* Duplicate files */}
                  <CollapsibleList
                    title="Duplicate files"
                    items={duplicateFiles}
                  />

                  {/* Empty files */}
                  <CollapsibleList
                    title="Empty files"
                    items={emptyFiles}
                  />

                  {/* Zero-unit files */}
                  <CollapsibleList
                    title="Files with no translation units"
                    items={zeroUnitFiles}
                  />
                </div>
              )}

              {previewData.totalUnits === 0 && !blocking && (
                <div className="alert alert-warning" style={{ marginTop: '0.5rem' }}>
                  No translation units found. Check file format or language header.
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={confirmLoading}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={
              previewLoading ||
              confirmLoading ||
              !canStartTranslation(previewData!)
            }
          >
            {confirmLoading ? 'Creating and starting...' : 'Confirm and start'}
          </button>
        </div>
      </div>
    </div>
  );
}
