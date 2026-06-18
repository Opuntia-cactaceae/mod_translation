/* ------------------------------------------------------------------ */
/*  ApplyConfirmationModal — confirmation dialog for Apply to File     */
/*  Shows file selection checkboxes, line-count diff, danger warnings  */
/* ------------------------------------------------------------------ */

import { useState, useRef, useEffect } from 'react';
import type {
  AlignmentPreviewResponse,
  ApplyAlignmentResponse,
} from '../../api/types';
import { api, ApiError, useToast } from '../../App';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface ApplyConfirmationModalProps {
  projectId: string;
  pairId: string;
  previewResult: AlignmentPreviewResponse;
  onClose: () => void;
  /** Called after apply succeeds so parent can refresh preview / metadata. */
  onApplied: (result: ApplyAlignmentResponse) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ApplyConfirmationModal({
  projectId,
  pairId,
  previewResult,
  onClose,
  onApplied,
}: ApplyConfirmationModalProps) {
  const [applySource, setApplySource] = useState(true);
  const [applyTranslated, setApplyTranslated] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const { showToast } = useToast();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ---- Derived data from preview ---------------------------------- */

  const sourcePreview = previewResult.source_preview;
  const translatedPreview = previewResult.translated_preview;
  const hasSource =
    sourcePreview != null &&
    typeof sourcePreview.normalized_content === 'string';
  const hasTranslated =
    translatedPreview != null &&
    typeof translatedPreview.normalized_content === 'string';

  // Content hashes for stale protection — extracted from preview
  const sourceHash =
    sourcePreview != null &&
    typeof sourcePreview.original_content_hash === 'string'
      ? sourcePreview.original_content_hash
      : null;
  const translatedHash =
    translatedPreview != null &&
    typeof translatedPreview.original_content_hash === 'string'
      ? translatedPreview.original_content_hash
      : null;

  // Effective selection (check disabled if side has no data)
  const effectiveApplySource = applySource && hasSource;
  const effectiveApplyTranslated = applyTranslated && hasTranslated;

  // Dangerous operations that materially alter file structure
  const dangerousOps = previewResult.operations.filter(
    (op) =>
      op.type === 'collapse_blank_lines' ||
      op.type === 'normalize_indentation',
  );

  const lineCountsChanged =
    (sourcePreview != null &&
      typeof sourcePreview.original_line_count === 'number' &&
      typeof sourcePreview.normalized_line_count === 'number' &&
      sourcePreview.original_line_count !== sourcePreview.normalized_line_count) ||
    (translatedPreview != null &&
      typeof translatedPreview.original_line_count === 'number' &&
      typeof translatedPreview.normalized_line_count === 'number' &&
      translatedPreview.original_line_count !== translatedPreview.normalized_line_count);

  /* ---- Handlers --------------------------------------------------- */

  const handleApply = async () => {
    if (!effectiveApplySource && !effectiveApplyTranslated) {
      setError('Select at least one file to apply');
      return;
    }

    setApplying(true);
    setError(null);

    try {
      const result = await api.applyPairingAlignment(projectId, pairId, {
        apply_source: effectiveApplySource,
        apply_translated: effectiveApplyTranslated,
        expected_source_hash: sourceHash,
        expected_translated_hash: translatedHash,
      });

      if (!mountedRef.current) return;

      // Build a user-friendly toast message
      const parts: string[] = [];
      if (result.source_applied && result.source_result) {
        parts.push(
          `source${result.source_result.line_count_changed ? ` (${result.source_result.old_line_count} \u2192 ${result.source_result.new_line_count} lines)` : ''}`,
        );
      }
      if (result.translated_applied && result.translated_result) {
        parts.push(
          `translated${result.translated_result.line_count_changed ? ` (${result.translated_result.old_line_count} \u2192 ${result.translated_result.new_line_count} lines)` : ''}`,
        );
      }
      showToast(
        `Normalization applied to ${parts.join(' and ')}`,
        'success',
      );

      onApplied(result);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to apply normalization';
      setError(message);
      showToast(message, 'error');
    } finally {
      if (mountedRef.current) setApplying(false);
    }
  };

  /* ---- Render ----------------------------------------------------- */

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '520px' }}
      >
        <div className="modal-header">
          <span>Apply Normalization to Files</span>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="modal-body">
          <p
            style={{
              marginBottom: '0.75rem',
              color: 'var(--text-danger, #b91c1c)',
            }}
          >
            <strong>This operation will rewrite files on disk.</strong> This
            action cannot be undone.
          </p>

          {/* File selection checkboxes */}
          <div style={{ marginBottom: '1rem' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '0.5rem',
              }}
            >
              <input
                type="checkbox"
                checked={applySource}
                onChange={(e) => setApplySource(e.target.checked)}
                disabled={!hasSource}
              />
              <span>
                Source file
                {sourcePreview && (
                  <span style={{ marginLeft: '0.5rem', opacity: 0.7 }}>
                    ({String(sourcePreview.original_line_count)} &rarr;{' '}
                    {String(sourcePreview.normalized_line_count)} lines)
                  </span>
                )}
              </span>
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <input
                type="checkbox"
                checked={applyTranslated}
                onChange={(e) => setApplyTranslated(e.target.checked)}
                disabled={!hasTranslated}
              />
              <span>
                Translated file
                {translatedPreview && (
                  <span style={{ marginLeft: '0.5rem', opacity: 0.7 }}>
                    ({String(translatedPreview.original_line_count)} &rarr;{' '}
                    {String(translatedPreview.normalized_line_count)} lines)
                  </span>
                )}
              </span>
            </label>
          </div>

          {/* Line count change warning */}
          {lineCountsChanged && (
            <div
              className="alert alert-warning"
              style={{ marginBottom: '0.75rem' }}
            >
              Line counts will change for one or more files.
            </div>
          )}

          {/* Dangerous operation warning */}
          {dangerousOps.length > 0 && (
            <div
              className="alert alert-warning"
              style={{ marginBottom: '0.75rem' }}
            >
              <strong>Dangerous operations detected:</strong>
              <ul style={{ margin: '0.25rem 0 0 1.25rem' }}>
                {dangerousOps.map((op, i) => (
                  <li key={i}>
                    {op.type === 'collapse_blank_lines'
                      ? 'Collapse blank lines \u2014 may alter structural formatting'
                      : 'Normalize indentation \u2014 may break language-specific indentation'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              className="alert alert-error"
              style={{ marginBottom: '0.75rem' }}
            >
              {error}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={applying}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleApply}
            disabled={
              applying ||
              (!effectiveApplySource && !effectiveApplyTranslated)
            }
          >
            {applying ? 'Applying...' : 'Apply to File'}
          </button>
        </div>
      </div>
    </div>
  );
}
