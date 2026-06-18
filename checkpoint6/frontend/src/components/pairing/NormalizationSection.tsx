/* ------------------------------------------------------------------ */
/*  NormalizationSection — embedded normalization controls for File    */
/*  View.  Extracted from AlignmentPanel (the old separate Normalize   */
/*  tab).  Self-contained: fetches alignment, edits operations JSON,   */
/*  previews, saves settings, and applies normalization to files.      */
/*                                                                      */
/*  Renders inside PairFileViewPanel, below the source/translated       */
/*  file textareas.                                                     */
/* ------------------------------------------------------------------ */

import { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';
import type {
  AlignmentResponse,
  NormalizationOperation,
  AlignmentPreviewResponse,
  ApplyAlignmentResponse,
} from '../../api/types';
import { api, ApiError, useToast } from '../../App';
import ApplyConfirmationModal from './ApplyConfirmationModal';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface NormalizationSectionProps {
  projectId: string;
  pairId: string | null;
  /** When non-null and different from previous render, auto-expand + scroll into view. */
  autoExpandKey?: number;
  /** True when the parent file view has unsaved edits — blocks Apply to File. */
  hasUnsavedEdits?: boolean;
  /** Called after normalization settings are successfully saved. */
  onNormalizationSaved?: () => void;
  /** Called after normalization is successfully applied to file(s). */
  onNormalizationApplied?: (result: ApplyAlignmentResponse) => void;
  /** Called when the expanded/collapsed state changes. Reports body height when expanded. */
  onExpandedChange?: (expanded: boolean, bodyHeight?: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Pretty-print the current operations array as JSON. */
function formatOperationsJson(ops: NormalizationOperation[]): string {
  return JSON.stringify(ops, null, 2);
}

/** Parse operations JSON string, returning the array or null on error. */
function parseOperationsJson(raw: string): NormalizationOperation[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as NormalizationOperation[];
  } catch {
    return null;
  }
}

/** Render one side of a normalized preview (original -> normalized). */
function PreviewSide({
  label,
  data,
}: {
  label: string;
  data: Record<string, unknown> | null | undefined;
}) {
  if (!data) return null;
  if (data.error) {
    return (
      <div className="source-side">
        <div className="file-header">{label}</div>
        <div className="file-content alert alert-error">
          {String(data.error)}
        </div>
      </div>
    );
  }
  const normContent =
    typeof data.normalized_content === 'string'
      ? data.normalized_content
      : null;
  const origLines = data.original_line_count ?? '?';
  const normLines = data.normalized_line_count ?? '?';
  return (
    <div className="source-side">
      <div className="file-header">
        {label} ({String(origLines)}&nbsp;→&nbsp;{String(normLines)}&nbsp;lines)
      </div>
      <div className="file-content">
        <pre className="pre">{normContent ?? JSON.stringify(data, null, 2)}</pre>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function NormalizationSection({
  projectId,
  pairId,
  autoExpandKey,
  hasUnsavedEdits = false,
  onNormalizationSaved,
  onNormalizationApplied,
  onExpandedChange,
}: NormalizationSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [operationsJson, setOperationsJson] = useState('[]');
  const [saving, setSaving] = useState(false);
  const [previewResult, setPreviewResult] =
    useState<AlignmentPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [lastAppliedAt, setLastAppliedAt] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const alignmentReqId = useRef(0);
  const sectionRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();
  const onExpandedChangeRef = useRef(onExpandedChange);
  onExpandedChangeRef.current = onExpandedChange;

  /* Toggle expand/collapse — scrolls into view on expand ------------ */
  const handleToggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      if (next) {
        requestAnimationFrame(() => {
          sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
      return next;
    });
  }, []);

  /* Measure body height after expand/collapse and report upward ----
     so the parent can grow the bottom editor to fit the content. */
  useLayoutEffect(() => {
    if (expanded && bodyRef.current) {
      const bodyHeight = bodyRef.current.scrollHeight;
      onExpandedChangeRef.current?.(true, bodyHeight);
    } else if (!expanded) {
      onExpandedChangeRef.current?.(false);
    }
  }, [expanded]);

  /* Mounted guard --------------------------------------------------- */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* Auto-expand when autoExpandKey changes -------------------------- */
  useEffect(() => {
    if (autoExpandKey && autoExpandKey > 0) {
      setExpanded(true);
      // Scroll into view after a frame for layout settle
      requestAnimationFrame(() => {
        sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }, [autoExpandKey]);

  /* Load existing alignment on mount / pairId change ---------------- */
  useEffect(() => {
    if (!pairId) {
      setOperationsJson('[]');
      setPreviewResult(null);
      setPreviewError(null);
      setLastAppliedAt(null);
      return;
    }

    // Clear state immediately when switching to a new pair so stale
    // data from the previous pair is never visible during the load.
    setOperationsJson('[]');
    setPreviewResult(null);
    setPreviewError(null);
    setLastAppliedAt(null);

    const reqId = ++alignmentReqId.current;

    api
      .getPairingAlignment(projectId, pairId)
      .then((alignment: AlignmentResponse | null) => {
        if (!mountedRef.current) return;
        if (reqId !== alignmentReqId.current) return; // stale response
        if (alignment && alignment.operations_json) {
          setOperationsJson(alignment.operations_json);
          setLastAppliedAt(alignment.last_applied_at ?? null);
        } else {
          setOperationsJson('[]');
          setLastAppliedAt(null);
        }
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        if (reqId !== alignmentReqId.current) return; // stale response
        const message =
          err instanceof ApiError
            ? err.message
            : 'Failed to load existing alignment';
        showToast(message, 'error');
      });
  }, [projectId, pairId, showToast]);

  /* ---- Quick-add operation helpers -------------------------------- */

  const addOperation = useCallback((op: NormalizationOperation) => {
    setOperationsJson((prev) => {
      const ops = parseOperationsJson(prev) ?? [];
      ops.push(op);
      return formatOperationsJson(ops);
    });
    // Clear previous preview since operations changed
    setPreviewResult(null);
    setPreviewError(null);
  }, []);

  const addTrimTrailing = useCallback(
    () => addOperation({ type: 'trim_trailing_spaces' }),
    [addOperation],
  );
  const addNormalizeLineEndings = useCallback(
    () => addOperation({ type: 'normalize_line_endings' }),
    [addOperation],
  );
  const addCollapseBlankLines = useCallback(
    () => addOperation({ type: 'collapse_blank_lines' as string, max: 1 }),
    [addOperation],
  );
  const addNormalizeIndentation = useCallback(
    () =>
      addOperation({
        type: 'normalize_indentation' as string,
        size: 4,
      }),
    [addOperation],
  );

  /* ---- Preview Normalization -------------------------------------- */

  const handlePreview = useCallback(async () => {
    if (!pairId) return;

    const ops = parseOperationsJson(operationsJson);
    if (!ops) {
      showToast('Invalid operations JSON', 'error');
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewResult(null);

    try {
      const result = await api.previewPairingAlignment(projectId, pairId, {
        operations: ops,
      });
      if (mountedRef.current) {
        setPreviewResult(result);
        setPreviewLoading(false);
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const message =
        err instanceof ApiError
          ? err.message
          : 'Preview normalization failed';
      setPreviewError(message);
      setPreviewLoading(false);
      showToast(message, 'error');
    }
  }, [pairId, operationsJson, projectId, showToast]);

  /* ---- Save Alignment --------------------------------------------- */

  const handleSave = useCallback(async () => {
    if (!pairId) return;

    const ops = parseOperationsJson(operationsJson);
    if (!ops) {
      showToast('Invalid operations JSON', 'error');
      return;
    }

    setSaving(true);

    try {
      await api.savePairingAlignment(projectId, pairId, {
        operations_json: operationsJson,
      });
      if (mountedRef.current) {
        showToast('Normalization settings saved', 'success');
        onNormalizationSaved?.();
        setSaving(false);
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to save alignment';
      showToast(message, 'error');
      setSaving(false);
    }
  }, [pairId, operationsJson, projectId, showToast, onNormalizationSaved]);

  /* ---- Apply to File ---------------------------------------------- */

  const handleNormalizationApplied = useCallback(
    (result: ApplyAlignmentResponse) => {
      setShowApplyModal(false);
      // Persist last_applied_at so the status line shows immediately
      // without waiting for a re-fetch from the backend.
      setLastAppliedAt(result.last_applied_at ?? null);
      // Clear preview so user re-previews to see the applied state
      setPreviewResult(null);
      setPreviewError(null);
      onNormalizationSaved?.();
      onNormalizationApplied?.(result);
    },
    [onNormalizationSaved, onNormalizationApplied],
  );

  /* ---- No pair selected ------------------------------------------- */
  if (!pairId) {
    return null; // File View handles the empty state
  }

  /* ---- Derive apply button disabled state ------------------------- */
  const applyDisabled = !previewResult || hasUnsavedEdits;

  /* ---- Render ----------------------------------------------------- */
  return (
    <div className="normalization-section" ref={sectionRef}>
      {/* Collapsible header — styled as app section row */}
      <button
        type="button"
        className="normalization-section__header"
        onClick={handleToggle}
        aria-expanded={expanded}
      >
        <svg
          className="normalization-section__chevron"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Normalization Operations</span>
        {lastAppliedAt && (
          <span className="normalization-section__last-applied">
            Last applied: {new Date(lastAppliedAt).toLocaleString()}
          </span>
        )}
      </button>

      {expanded && (
        <div className="normalization-section__body" ref={bodyRef}>
          {/* Unsaved edits warning */}
          {hasUnsavedEdits && (
            <div
              className="alert alert-warning"
              style={{ marginBottom: '0.75rem', fontSize: '0.85rem' }}
            >
              Save or revert file edits before applying normalization.
            </div>
          )}

          {/* Operations JSON textarea */}
          <div style={{ marginBottom: '0.75rem' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '0.25rem',
                fontWeight: 600,
              }}
            >
              Operations (JSON)
            </label>
            <textarea
              className="form-control"
              value={operationsJson}
              onChange={(e) => {
                setOperationsJson(e.target.value);
                setPreviewResult(null);
                setPreviewError(null);
              }}
              rows={8}
              style={{
                width: '100%',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '0.85rem',
                resize: 'vertical',
              }}
            />
          </div>

          {/* Quick-add operation buttons */}
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              flexWrap: 'wrap',
              marginBottom: '0.75rem',
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={addTrimTrailing}
            >
              Trim trailing spaces
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={addNormalizeLineEndings}
            >
              Normalize line endings
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={addCollapseBlankLines}
            >
              Collapse blank lines (max 1)
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={addNormalizeIndentation}
            >
              Normalize indentation (4 spaces)
            </button>
          </div>

          {/* Preview / Save / Apply action buttons */}
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              marginBottom: '0.75rem',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              className="btn btn-primary"
              onClick={handlePreview}
              disabled={previewLoading}
            >
              {previewLoading ? 'Previewing...' : 'Preview Normalization'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setShowApplyModal(true)}
              disabled={applyDisabled}
              title={
                hasUnsavedEdits
                  ? 'Save or revert file edits before applying normalization'
                  : !previewResult
                    ? 'Preview normalization before applying'
                    : undefined
              }
            >
              Apply to File
            </button>
          </div>

          {/* Preview error */}
          {previewError && (
            <div
              className="alert alert-error"
              style={{ marginBottom: '0.75rem' }}
            >
              {previewError}
            </div>
          )}

          {/* Warnings for unknown operations */}
          {previewResult?.warnings && previewResult.warnings.length > 0 && (
            <div
              className="alert alert-warning"
              style={{ marginBottom: '0.75rem' }}
            >
              {previewResult.warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}

          {/* Preview result: side-by-side normalized content */}
          {previewResult && (
            <div className="side-by-side">
              <PreviewSide
                label="Source"
                data={previewResult.source_preview}
              />
              <PreviewSide
                label="Translated"
                data={previewResult.translated_preview}
              />
            </div>
          )}

          {/* Apply to File confirmation modal */}
          {showApplyModal && previewResult && (
            <ApplyConfirmationModal
              projectId={projectId}
              pairId={pairId}
              previewResult={previewResult}
              onClose={() => setShowApplyModal(false)}
              onApplied={handleNormalizationApplied}
            />
          )}
        </div>
      )}
    </div>
  );
}
