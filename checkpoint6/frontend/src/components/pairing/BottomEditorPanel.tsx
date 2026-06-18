/* ------------------------------------------------------------------ */
/*  BottomEditorPanel — singleton bottom editor area for the Pairing    */
/*  Workspace. Houses PairFileViewPanel (File View) and                 */
/*  PairLineEditorPanel (Line Editor).                                  */
/*                                                                      */
/*  Normalization is embedded inside PairFileViewPanel as a             */
/*  collapsible section — no separate Normalize tab.                    */
/*                                                                      */
/*  Owns the shared pair preview data so switching between File View    */
/*  and Line Editor does NOT trigger a new API call.                    */
/*                                                                      */
/*  Manages cross-tab navigation: Line Editor can request File View     */
/*  to jump to a specific line via FileViewRevealTarget.                */
/* ------------------------------------------------------------------ */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { PairPreviewResponse, ApplyAlignmentResponse } from '../../api/types';
import { api, ApiError } from '../../App';
import PairFileViewPanel from './PairFileViewPanel';
import PairLineEditorPanel from './PairLineEditorPanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type BottomEditorTab = 'fileView' | 'lineEditor';

export interface FileViewRevealTarget {
  sourceLineNumber?: number | null;
  translatedLineNumber?: number | null;
  /** Incremented each reveal so PairFileViewPanel can detect re-reveal. */
  nonce: number;
}

interface BottomEditorPanelProps {
  projectId: string;
  pairId: string;
  /** Initial active tab when mounting or when pairId changes. */
  initialTab?: BottomEditorTab;
  onClose: () => void;
  /** Called when aggregated dirty state (fileView || lineEditor) changes. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Called after normalization settings are saved. */
  onNormalizationSaved?: () => void;
  /** Called after normalization is applied to file(s). */
  onNormalizationApplied?: (result: ApplyAlignmentResponse) => void;
  /** When incremented, File View auto-expands the Normalize section and scrolls to it. */
  normalizeAutoExpandKey?: number;
  /** Called when Normalize section expands or collapses with the body height. */
  onNormalizeExpandedChange?: (expanded: boolean, bodyHeight?: number) => void;
  /** Called when the File View columns resize handle is released with the net height delta. */
  onFileViewResize?: (delta: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Tab config                                                        */
/* ------------------------------------------------------------------ */

interface TabConfig {
  id: BottomEditorTab;
  label: string;
}

const TABS: TabConfig[] = [
  { id: 'fileView', label: 'File View' },
  { id: 'lineEditor', label: 'Line Editor' },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function BottomEditorPanel({
  projectId,
  pairId,
  initialTab = 'fileView',
  onClose,
  onDirtyChange,
  onNormalizationSaved,
  onNormalizationApplied,
  normalizeAutoExpandKey,
  onNormalizeExpandedChange,
  onFileViewResize,
}: BottomEditorPanelProps) {
  const [activeTab, setActiveTab] = useState<BottomEditorTab>(initialTab);
  const [fileViewRevealTarget, setFileViewRevealTarget] =
    useState<FileViewRevealTarget | null>(null);

  /* Dirty state aggregation — children report via onDirtyChange ------ */
  const [fileViewDirty, setFileViewDirty] = useState(false);
  const [lineEditorDirty, setLineEditorDirty] = useState(false);

  const hasUnsavedChanges = fileViewDirty || lineEditorDirty;
  const aggregatedDirtyPrevRef = useRef<boolean | null>(null);

  /* ---- Report aggregated dirty state upward ----------------------- */
  useEffect(() => {
    if (onDirtyChange && aggregatedDirtyPrevRef.current !== hasUnsavedChanges) {
      aggregatedDirtyPrevRef.current = hasUnsavedChanges;
      onDirtyChange(hasUnsavedChanges);
    }
  }, [hasUnsavedChanges, onDirtyChange]);

  /* Shared preview state — loaded once per pairId, shared across tabs */
  const [preview, setPreview] = useState<PairPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  /* Refresh key — incremented when child saves content to re-fetch preview */
  const [refreshKey, setRefreshKey] = useState(0);

  const handleContentSaved = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleNormalizationApplied = useCallback(
    (result: ApplyAlignmentResponse) => {
      setRefreshKey((k) => k + 1);
      onNormalizationApplied?.(result);
    },
    [onNormalizationApplied],
  );

  const mountedRef = useRef(true);
  const previewReqId = useRef(0);

  /* ---- Mounted guard ---------------------------------------------- */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ---- Reset to initialTab when switching to a different pair ----- */
  useEffect(() => {
    setActiveTab(initialTab);
    setFileViewRevealTarget(null);
    setFileViewDirty(false);
    setLineEditorDirty(false);
    aggregatedDirtyPrevRef.current = null;
  }, [pairId, initialTab]);

  /* ---- Fetch shared preview when pairId changes ------------------- */
  useEffect(() => {
    if (!pairId) {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);

    const myReqId = ++previewReqId.current;

    api
      .getPairingPairPreview(projectId, pairId)
      .then((data) => {
        if (!mountedRef.current || myReqId !== previewReqId.current) return;
        if (!data) {
          setPreview(null);
          setPreviewLoading(false);
          return;
        }
        setPreview(data);
        setPreviewLoading(false);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current || myReqId !== previewReqId.current) return;
        const message =
          err instanceof ApiError ? err.message : 'Failed to load preview';
        setPreviewError(message);
        setPreviewLoading(false);
      });
  }, [projectId, pairId, refreshKey]);

  /* Handle "Open in File View" from Line Editor -------------------- */
  const handleOpenInFileView = useCallback(
    (target: { sourceLineNumber?: number | null; translatedLineNumber?: number | null }) => {
      setFileViewRevealTarget({
        sourceLineNumber: target.sourceLineNumber ?? undefined,
        translatedLineNumber: target.translatedLineNumber ?? undefined,
        nonce: Date.now(),
      });
      setActiveTab('fileView');
    },
    [],
  );

  return (
    <div className="pw-bottom-editor">
      {/* ---- Toolbar ---- */}
      <div className="pw-bottom-editor__toolbar">
        <div className="pw-bottom-editor__tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`pw-bottom-editor__tab ${activeTab === tab.id ? 'pw-bottom-editor__tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="pw-bottom-editor__actions">
          {hasUnsavedChanges && (
            <span className="pw-bottom-editor__dirty-badge" title="Unsaved local changes">
              Unsaved changes
            </span>
          )}
          <span className="pw-bottom-editor__pair-id" title={pairId}>
            Pair: {pairId.slice(0, 8)}
          </span>
          <button
            className="btn btn-sm btn-ghost"
            onClick={onClose}
            title="Close editor panel"
          >
            Close
          </button>
        </div>
      </div>

      {/* ---- Body ---- */}
      {/*
        File View and Line Editor remain mounted at all times to preserve
        internal draft/edit state across tab switches.  Inactive panels are
        hidden with the HTML5 `hidden` attribute (→ display: none).

        Normalization is embedded inside PairFileViewPanel as a collapsible
        section — no separate Normalize tab.
      */}
      <div className="pw-bottom-editor__body">
        <div
          className="pw-bottom-editor__tab-panel"
          hidden={activeTab !== 'fileView'}
          aria-hidden={activeTab !== 'fileView'}
        >
          <PairFileViewPanel
            pairId={pairId}
            preview={preview}
            loading={previewLoading}
            error={previewError}
            revealTarget={fileViewRevealTarget}
            onDirtyChange={setFileViewDirty}
            projectId={projectId}
            onContentSaved={handleContentSaved}
            normalizeAutoExpandKey={normalizeAutoExpandKey}
            onNormalizationSaved={onNormalizationSaved}
            onNormalizationApplied={handleNormalizationApplied}
            onNormalizeExpandedChange={onNormalizeExpandedChange}
            onFileViewResize={onFileViewResize}
          />
        </div>
        <div
          className="pw-bottom-editor__tab-panel"
          hidden={activeTab !== 'lineEditor'}
          aria-hidden={activeTab !== 'lineEditor'}
        >
          <PairLineEditorPanel
            pairId={pairId}
            preview={preview}
            loading={previewLoading}
            error={previewError}
            onOpenInFileView={handleOpenInFileView}
            onDirtyChange={setLineEditorDirty}
            projectId={projectId}
            onContentSaved={handleContentSaved}
          />
        </div>
      </div>
    </div>
  );
}
