/* ------------------------------------------------------------------ */
/*  PairFileViewPanel — editable file view for a selected pair         */
/*                                                                      */
/*  Shows source and translated file side by side with editable         */
/*  textareas, draft/dirty tracking, Save and Revert buttons.           */
/*  Supports revealTarget to jump to a specific line (from Line Editor).*/
/*                                                                      */
/*  Receives preview/loading/error from parent — does NOT fetch API.    */
/* ------------------------------------------------------------------ */

import { useEffect, useState, useRef, useCallback } from 'react';
import type { PairPreviewResponse, FileContentResponse, ApplyAlignmentResponse } from '../../api/types';
import { api, ApiError, useToast } from '../../App';
import type { FileViewRevealTarget } from './BottomEditorPanel';
import { pairDraftStore } from '../../utils/pairDraftStore';
import NormalizationSection from './NormalizationSection';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface PairFileViewPanelProps {
  pairId: string | null;
  preview: PairPreviewResponse | null;
  loading: boolean;
  error: string | null;
  /** If set, scrolls/selects the target line in the appropriate textarea. */
  revealTarget?: FileViewRevealTarget | null;
  /** Called when the dirty state (sourceDirty || translatedDirty) changes. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Project ID — required for save API calls. */
  projectId: string;
  /** Called after a file is successfully saved (parent may refresh preview). */
  onContentSaved?: () => void;

  /* ---- Normalize section props (forwarded from BottomEditorPanel) --- */
  /** When incremented, auto-expands the Normalize section and scrolls to it. */
  normalizeAutoExpandKey?: number;
  /** Called after normalization settings are saved. */
  onNormalizationSaved?: () => void;
  /** Called after normalization is applied to file(s). */
  onNormalizationApplied?: (result: ApplyAlignmentResponse) => void;
  /** Called when Normalize section expands or collapses with the body height. */
  onNormalizeExpandedChange?: (expanded: boolean, bodyHeight?: number) => void;
  /** Called when the columns resize handle is released with the net height delta
   *  (final columnsHeight − start columnsHeight).  The parent should grow/shrink the
   *  bottom editor zone by the same delta. */
  onFileViewResize?: (delta: number) => void;
}

interface FilePanelState {
  file: FileContentResponse | null | undefined;
  draft: string;
  dirty: boolean;
}

type Side = 'source' | 'translated';

/** Compute char offset for a 1-indexed line number in a newline-separated string. */
function lineToCharOffset(content: string, lineNumber: number): number {
  const lines = content.split('\n');
  const clampedLine = Math.max(1, Math.min(lineNumber, lines.length));
  let offset = 0;
  for (let i = 0; i < clampedLine - 1; i++) {
    offset += lines[i].length + 1; // +1 for \n
  }
  return offset;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PairFileViewPanel({
  pairId,
  preview,
  loading,
  error,
  revealTarget,
  onDirtyChange,
  projectId,
  onContentSaved,
  normalizeAutoExpandKey,
  onNormalizationSaved,
  onNormalizationApplied,
  onNormalizeExpandedChange,
  onFileViewResize,
}: PairFileViewPanelProps) {
  const toast = useToast();

  /* Draft state per side -------------------------------------------- */
  const [sourceDraft, setSourceDraft] = useState('');
  const [translatedDraft, setTranslatedDraft] = useState('');
  const [sourceDirty, setSourceDirty] = useState(false);
  const [translatedDirty, setTranslatedDirty] = useState(false);

  /* Saving-in-progress per side ------------------------------------ */
  const [savingSource, setSavingSource] = useState(false);
  const [savingTranslated, setSavingTranslated] = useState(false);

  /* Resizable columns height — managed entirely by parent via bottomHeightPx.
     No local columnsHeight state — the columns container uses CSS flex: 1
     and fills the available space inside the bottom editor. */

  const startColumnsResize = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const startY = event.clientY;
      let prevDelta = 0;

      function onPointerMove(moveEvent: PointerEvent) {
        const totalDelta = moveEvent.clientY - startY;
        const incrementalDelta = totalDelta - prevDelta;
        prevDelta = totalDelta;
        if (incrementalDelta !== 0) {
          onFileViewResize?.(incrementalDelta);
        }
      }

      function onPointerUp() {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        document.body.classList.remove('is-resizing-vertical');
      }

      document.body.classList.add('is-resizing-vertical');
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [onFileViewResize],
  );

  /* Refs for latest values — used in async save callbacks ----------- */
  const sourceDraftRef = useRef('');
  const translatedDraftRef = useRef('');
  const sourceDirtyRef = useRef(false);
  const translatedDirtyRef = useRef(false);

  // Keep refs in sync
  sourceDraftRef.current = sourceDraft;
  translatedDraftRef.current = translatedDraft;
  sourceDirtyRef.current = sourceDirty;
  translatedDirtyRef.current = translatedDirty;

  const mountedRef = useRef(true);

  /* Save sequence counter — incremented on each save and on pairId change
      to invalidate stale async save completions. */
  const saveSeqRef = useRef(0);

  /* Track dirty for upward reporting --------------------------------- */
  const currentDirty = sourceDirty || translatedDirty;
  const prevDirtyRef = useRef<boolean | null>(null);

  /* ---- Report dirty state to parent -------------------------------- */
  useEffect(() => {
    if (onDirtyChange && prevDirtyRef.current !== currentDirty) {
      prevDirtyRef.current = currentDirty;
      onDirtyChange(currentDirty);
    }
  }, [currentDirty, onDirtyChange]);

  /* Textarea refs for reveal-scroll --------------------------------- */
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null);
  const translatedTextareaRef = useRef<HTMLTextAreaElement>(null);

  /* Reveal info line ------------------------------------------------- */
  const [revealInfo, setRevealInfo] = useState<string | null>(null);

  /* Track preview identity so we reset drafts when preview changes --- */
  const previewRef = useRef<PairPreviewResponse | null>(null);
  /** Tracks which pairId the current non-null preview belongs to.
      Used to distinguish "new pair loaded" from "preview refreshed for same pair". */
  const loadedPairIdRef = useRef<string | null>(null);

  /* ---- Mounted guard ---------------------------------------------- */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ---- Reset drafts when preview changes (new pair or re-fetch) --- */
  useEffect(() => {
    if (!pairId) {
      // Save drafts for the closing pair before clearing state
      const oldPairId = loadedPairIdRef.current;
      if (oldPairId && (sourceDirty || translatedDirty)) {
        pairDraftStore.saveFileViewDraft(oldPairId, {
          sourceContent: sourceDraftRef.current,
          translatedContent: translatedDraftRef.current,
          sourceDirty,
          translatedDirty,
        });
      }
      saveSeqRef.current += 1;
      setSavingSource(false);
      setSavingTranslated(false);
      setSourceDraft('');
      setTranslatedDraft('');
      setSourceDirty(false);
      setTranslatedDirty(false);
      setRevealInfo(null);
      previewRef.current = null;
      loadedPairIdRef.current = null;
      return;
    }

    if (previewRef.current !== preview) {
      previewRef.current = preview;

      if (!preview) {
        setRevealInfo(null);
        return;
      }

      // Distinguish "new pair loaded" from "preview refreshed for same pair"
      // (e.g. after save).  On pair change, save old pair's drafts and
      // restore any saved drafts for the new pair.
      // On refresh, preserve dirty-side drafts so unsaved edits survive.
      const pairChanged = loadedPairIdRef.current !== pairId;

      if (pairChanged) {
        // Save current drafts for the pair we are leaving
        const oldPairId = loadedPairIdRef.current;
        if (oldPairId && (sourceDirty || translatedDirty)) {
          pairDraftStore.saveFileViewDraft(oldPairId, {
            sourceContent: sourceDraftRef.current,
            translatedContent: translatedDraftRef.current,
            sourceDirty,
            translatedDirty,
          });
        }

        saveSeqRef.current += 1;
        setSavingSource(false);
        setSavingTranslated(false);
        loadedPairIdRef.current = pairId;

        // Restore saved drafts for the new pair, or initialise from preview
        const saved = pairDraftStore.load(pairId);
        if (saved?.fileView) {
          setSourceDraft(saved.fileView.sourceContent);
          setTranslatedDraft(saved.fileView.translatedContent);
          setSourceDirty(saved.fileView.sourceDirty);
          setTranslatedDirty(saved.fileView.translatedDirty);
        } else {
          setSourceDraft(preview?.source_file?.content ?? '');
          setTranslatedDraft(preview?.translated_file?.content ?? '');
          setSourceDirty(false);
          setTranslatedDirty(false);
        }
      } else {
        // Same pair, preview refreshed — only update clean sides
        if (!sourceDirty) {
          setSourceDraft(preview?.source_file?.content ?? '');
        }
        if (!translatedDirty) {
          setTranslatedDraft(preview?.translated_file?.content ?? '');
        }
      }
      setRevealInfo(null);
    }
  }, [pairId, preview]);

  /* ---- Reveal target: scroll textarea to target line -------------- */
  useEffect(() => {
    if (!revealTarget) {
      setRevealInfo(null);
      return;
    }

    const { sourceLineNumber, translatedLineNumber } = revealTarget;

    // Build info text
    const parts: string[] = [];
    if (sourceLineNumber != null) parts.push(`source line ${sourceLineNumber}`);
    if (translatedLineNumber != null)
      parts.push(`translation line ${translatedLineNumber}`);
    setRevealInfo(
      parts.length > 0
        ? `Opened ${parts.join(' / ')}`
        : null,
    );

    // Prefer translated textarea if line number available, else source
    const useSide =
      translatedLineNumber != null ? 'translated' : 'source';
    const lineNumber =
      useSide === 'translated'
        ? (translatedLineNumber ?? 1)
        : (sourceLineNumber ?? 1);
    const content =
      useSide === 'translated' ? translatedDraft : sourceDraft;
    const textareaRef =
      useSide === 'translated'
        ? translatedTextareaRef
        : sourceTextareaRef;

    const ta = textareaRef.current;
    if (ta && content) {
      const offset = lineToCharOffset(content, lineNumber);
      // Use requestAnimationFrame to wait for DOM layout
      requestAnimationFrame(() => {
        if (!mountedRef.current) return;
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(offset, offset);
        // scroll into rough view: estimate line height and scroll
        const lineHeight = 18; // approximate line height in px
        ta.scrollTop = Math.max(0, (lineNumber - 3) * lineHeight);
      });
    }
  }, [revealTarget?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Handlers --------------------------------------------------- */

  const handleSourceChange = useCallback((value: string) => {
    setSourceDraft(value);
    setSourceDirty(true);
  }, []);

  const handleTranslatedChange = useCallback((value: string) => {
    setTranslatedDraft(value);
    setTranslatedDirty(true);
  }, []);

  const handleRevertSource = useCallback(() => {
    setSourceDraft(preview?.source_file?.content ?? '');
    setSourceDirty(false);
  }, [preview]);

  const handleRevertTranslated = useCallback(() => {
    setTranslatedDraft(preview?.translated_file?.content ?? '');
    setTranslatedDirty(false);
  }, [preview]);

  const handleSave = useCallback(
    async (side: Side) => {
      saveSeqRef.current += 1;
      const mySaveSeq = saveSeqRef.current;

      const fileId =
        side === 'source'
          ? preview?.source_file?.file_id
          : preview?.translated_file?.file_id;
      const content =
        side === 'source' ? sourceDraftRef.current : translatedDraftRef.current;

      if (!fileId) {
        toast.showToast(`Cannot save ${side} file: file not available.`, 'error');
        return;
      }

      try {
        if (side === 'source') setSavingSource(true);
        else setSavingTranslated(true);

        await api.savePairingFileContent(projectId, fileId, content);

        // Guard: if pairId changed since save started, discard stale completion
        if (mySaveSeq !== saveSeqRef.current) return;

        toast.showToast(
          `Saved ${side === 'source' ? 'Source' : 'Translation'} file.`,
          'success',
        );

        if (side === 'source') {
          setSourceDirty(false);
          sourceDirtyRef.current = false;
        } else {
          setTranslatedDirty(false);
          translatedDirtyRef.current = false;
        }

        // Clear draft only when BOTH sides are clean (fully saved)
        if (side === 'source' && !translatedDirtyRef.current) {
          pairDraftStore.clearFileViewDraft(pairId!);
        } else if (side === 'translated' && !sourceDirtyRef.current) {
          pairDraftStore.clearFileViewDraft(pairId!);
        }

        onContentSaved?.();
      } catch (err) {
        if (mySaveSeq === saveSeqRef.current) {
          const message =
            err instanceof ApiError
              ? err.message
              : `Failed to save ${side} file`;
          toast.showToast(message, 'error');
        }
      } finally {
        if (mySaveSeq === saveSeqRef.current) {
          if (side === 'source') setSavingSource(false);
          else setSavingTranslated(false);
        }
      }
    },
    [projectId, preview, toast, onContentSaved],
  );

  const handleSaveAll = useCallback(async () => {
    if (sourceDirty) await handleSave('source');
    if (translatedDirty) await handleSave('translated');
  }, [handleSave, sourceDirty, translatedDirty]);

  /* ---- Derive per-side state -------------------------------------- */

  const sourceFile = preview?.source_file ?? null;
  const translatedFile = preview?.translated_file ?? null;

  const sourceStatus: string = !sourceFile
    ? 'missing'
    : savingSource
      ? 'saving'
      : sourceDirty
        ? 'dirty'
        : 'saved';

  const translatedStatus: string = !translatedFile
    ? 'missing'
    : savingTranslated
      ? 'saving'
      : translatedDirty
        ? 'dirty'
        : 'saved';

  /* ================================================================ */
  /*  Render — states                                                  */
  /* ================================================================ */

  if (!pairId) {
    return (
      <div className="pair-file-view">
        <div className="empty-state">Select a pair to view files.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="pair-file-view">
        <div className="empty-state">Loading file view...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pair-file-view">
        <div className="alert alert-error">{error}</div>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="pair-file-view">
        <div className="empty-state">No file preview data available.</div>
      </div>
    );
  }

  /* ================================================================ */
  /*  Render — file panels                                             */
  /* ================================================================ */

  const hasDirty = sourceDirty || translatedDirty;

  return (
    <div className="pair-file-view">
      {/* Global actions */}
      <div
        className="pair-file-view__actions"
        style={{
          borderTop: 'none',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <button
          className="btn btn-sm btn-primary"
          onClick={handleSaveAll}
          disabled={!hasDirty || savingSource || savingTranslated}
          title="Save both files"
        >
          Save Both
        </button>

        {/* Reveal info chip */}
        {revealInfo && (
          <span className="pair-file-view__reveal-info">{revealInfo}</span>
        )}
      </div>

      {/* Resizable columns container — holds file panels + resize handle.
          Height is driven by parent bottomHeightPx + CSS flex: 1 (no inline style). */}
      <div
        className="pair-file-view__columns-container"
      >
        {/* Two-column layout */}
        <div className="pair-file-view__columns">
          {/* Source panel */}
          <FilePanel
            side="source"
            label="Source File"
            file={sourceFile}
            draft={sourceDraft}
            status={sourceStatus}
            onDraftChange={handleSourceChange}
            onSave={handleSave}
            onRevert={handleRevertSource}
            textareaRef={sourceTextareaRef}
          />

          {/* Translated panel */}
          <FilePanel
            side="translated"
            label="Translated File"
            file={translatedFile}
            draft={translatedDraft}
            status={translatedStatus}
            onDraftChange={handleTranslatedChange}
            onSave={handleSave}
            onRevert={handleRevertTranslated}
            textareaRef={translatedTextareaRef}
          />
        </div>

        {/* Bottom-right resize grip — follows existing app pattern */}
        <div
          className="pair-file-view__resize-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize file viewer height"
          onPointerDown={startColumnsResize}
        />
      </div>

      {/* Normalize section — embedded below file panels */}
      <NormalizationSection
        projectId={projectId}
        pairId={pairId}
        autoExpandKey={normalizeAutoExpandKey}
        hasUnsavedEdits={hasDirty}
        onNormalizationSaved={onNormalizationSaved}
        onNormalizationApplied={onNormalizationApplied}
        onExpandedChange={onNormalizeExpandedChange}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FilePanel — single file panel (source or translated)               */
/* ------------------------------------------------------------------ */

interface FilePanelProps {
  side: Side;
  label: string;
  file: FileContentResponse | null;
  draft: string;
  status: string;
  onDraftChange: (value: string) => void;
  onSave: (side: Side) => void;
  onRevert: () => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

function FilePanel({
  side,
  label,
  file,
  draft,
  status,
  onDraftChange,
  onSave,
  onRevert,
  textareaRef,
}: FilePanelProps) {
  const statusLabel =
    status === 'dirty'
      ? 'Unsaved changes'
      : status === 'saving'
        ? 'Saving...'
        : status === 'missing'
          ? 'File missing'
          : 'Saved';

  const isMissing = status === 'missing';

  return (
    <div className="pair-file-view__panel">
      {/* Header */}
      <div className="pair-file-view__header">
        <div className="pair-file-view__header-top">
          <span className="pair-file-view__title">{label}</span>
          <span
            className={`pair-file-view__status pair-file-view__status--${status}`}
          >
            {statusLabel}
          </span>
        </div>
        {file && (
          <span className="pair-file-view__path" title={file.relative_path}>
            {file.relative_path} ({file.line_count} lines)
          </span>
        )}
      </div>

      {/* Body */}
      {isMissing ? (
        <div className="pair-file-view__missing">
          File content is not available for this pair.
        </div>
      ) : (
        <textarea
          ref={textareaRef as React.Ref<HTMLTextAreaElement>}
          className="pair-file-view__textarea custom-scrollbar"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          spellCheck={false}
          wrap="off"
        />
      )}

      {/* Actions */}
      <div className="pair-file-view__actions">
        <button
          className="btn btn-sm btn-primary"
          onClick={() => onSave(side)}
          disabled={status !== 'dirty'}
        >
          Save {side === 'source' ? 'Source' : 'Translation'}
        </button>
        <button
          className="btn btn-sm btn-outline"
          onClick={onRevert}
          disabled={status !== 'dirty'}
        >
          Revert {side === 'source' ? 'Source' : 'Translation'}
        </button>
      </div>
    </div>
  );
}
