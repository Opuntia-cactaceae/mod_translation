/* ------------------------------------------------------------------ */
/*  PairLineEditorPanel — line-by-line SOURCE ↔ TRANSLATION editor     */
/*                                                                      */
/*  Reads the same pair preview data and breaks source/translated       */
/*  content into individual rows. Source is read-only; translation is   */
/*  editable per row. Toolbar shows stats, filters, and action buttons. */
/*                                                                      */
/*  Receives preview/loading/error from parent — does NOT fetch API.    */
/* ------------------------------------------------------------------ */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import type { PairPreviewResponse } from '../../api/types';
import { api, ApiError, useToast } from '../../App';
import { pairDraftStore, buildLineDraftKey } from '../../utils/pairDraftStore';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PairLineEditorPanelProps {
  pairId: string | null;
  preview: PairPreviewResponse | null;
  loading: boolean;
  error: string | null;
  /** Called when user clicks "Open in File View" on a row. */
  onOpenInFileView?: (target: {
    sourceLineNumber?: number | null;
    translatedLineNumber?: number | null;
  }) => void;
  /** Called when dirty state (any row edited) changes. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Project ID — required for save API calls. */
  projectId: string;
  /** Called after a file is successfully saved (parent may refresh preview). */
  onContentSaved?: () => void;
}

interface LineRow {
  id: number;
  sourceText: string;
  translatedText: string;
  sourceLineNumber: number | null;
  translatedLineNumber: number | null;
  state: 'matched' | 'source_only' | 'translated_only' | 'empty';
  /** Has the translation draft been modified from the original? */
  dirty: boolean;
  /** Original translation text (for revert). */
  originalTranslated: string;
}

type FilterMode = 'all' | 'matched' | 'source_only' | 'translated_only' | 'edited';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function computeState(
  sourceText: string,
  translatedText: string,
): LineRow['state'] {
  const hasSource = sourceText.length > 0;
  const hasTranslated = translatedText.length > 0;
  if (hasSource && hasTranslated) return 'matched';
  if (hasSource && !hasTranslated) return 'source_only';
  if (!hasSource && hasTranslated) return 'translated_only';
  return 'empty';
}

/** Build rows from source/translated content lines. */
function buildRows(
  sourceLines: string[],
  translatedLines: string[],
): LineRow[] {
  const maxLen = Math.max(sourceLines.length, translatedLines.length);
  if (maxLen === 0) return [];
  const rows: LineRow[] = [];

  for (let i = 0; i < maxLen; i++) {
    const sourceText = sourceLines[i] ?? '';
    const translatedText = translatedLines[i] ?? '';
    rows.push({
      id: i,
      sourceText,
      translatedText,
      sourceLineNumber: i < sourceLines.length ? i + 1 : null,
      translatedLineNumber: i < translatedLines.length ? i + 1 : null,
      state: computeState(sourceText, translatedText),
      dirty: false,
      originalTranslated: translatedText,
    });
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/*  Filter labels                                                      */
/* ------------------------------------------------------------------ */

const FILTER_OPTIONS: { id: FilterMode; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'matched', label: 'Matched' },
  { id: 'source_only', label: 'Source only' },
  { id: 'translated_only', label: 'Translated only' },
  { id: 'edited', label: 'Edited' },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PairLineEditorPanel({
  pairId,
  preview,
  loading,
  error,
  onOpenInFileView,
  onDirtyChange,
  projectId,
  onContentSaved,
}: PairLineEditorPanelProps) {
  const toast = useToast();

  /* Rows state */
  const [rows, setRows] = useState<LineRow[]>([]);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [saving, setSaving] = useState(false);

  /* Refs for stable async callbacks ---------------------------------- */
  const rowsRef = useRef<LineRow[]>([]);
  rowsRef.current = rows;

  /* Save sequence counter — incremented on each save and on pairId change
      to invalidate stale async save completions. */
  const saveSeqRef = useRef(0);

  /* Track preview identity so we rebuild rows when preview changes --- */
  const previewRef = useRef<PairPreviewResponse | null>(null);
  /** Tracks which pairId the current non-null preview belongs to. */
  const loadedPairIdRef = useRef<string | null>(null);

  /* ---- Rebuild rows when preview changes -------------------------- */
  useEffect(() => {
    if (!pairId) {
      // Save drafts for the closing pair before clearing state
      const oldPairId = loadedPairIdRef.current;
      if (oldPairId) {
        const currentRows = rowsRef.current;
        const hasDirtyRows = currentRows.some((r) => r.dirty);
        if (hasDirtyRows) {
          pairDraftStore.saveLineEditorDraft(oldPairId, {
            rows: currentRows.map((r) => ({
              id: r.id,
              translatedText: r.translatedText,
              dirty: r.dirty,
              originalTranslated: r.originalTranslated,
              draftKey: buildLineDraftKey(r.sourceText, r.originalTranslated),
            })),
          });
        }
      }
      saveSeqRef.current += 1;
      setSaving(false);
      setRows([]);
      setFilter('all');
      previewRef.current = null;
      loadedPairIdRef.current = null;
      return;
    }

    if (previewRef.current !== preview) {
      previewRef.current = preview;

      if (!preview) {
        return;
      }

      // Distinguish "new pair loaded" from "preview refreshed for same pair"
      // (e.g. after save).  On pair change, save old pair's drafts and
      // restore any saved drafts for the new pair.
      // On refresh, preserve dirty rows so unsaved edits survive.
      const pairChanged = loadedPairIdRef.current !== pairId;

      if (pairChanged) {
        // Save current drafts for the pair we are leaving
        const oldPairId = loadedPairIdRef.current;
        if (oldPairId) {
          const currentRows = rowsRef.current;
          const hasDirtyRows = currentRows.some((r) => r.dirty);
          if (hasDirtyRows) {
            pairDraftStore.saveLineEditorDraft(oldPairId, {
              rows: currentRows.map((r) => ({
                id: r.id,
                translatedText: r.translatedText,
                dirty: r.dirty,
                originalTranslated: r.originalTranslated,
              })),
            });
          }
        }

        saveSeqRef.current += 1;
        setSaving(false);
        loadedPairIdRef.current = pairId;

        // Restore saved drafts for the new pair, or build from preview
        const saved = pairDraftStore.load(pairId);
        if (saved?.lineEditor) {
          const sourceLines = preview?.source_file?.content
            ? preview.source_file.content.split('\n')
            : [];
          const translatedLines = preview?.translated_file?.content
            ? preview.translated_file.content.split('\n')
            : [];
          const freshRows = buildRows(sourceLines, translatedLines);
          // Merge saved translations into fresh rows so source structure is current.
          // Match by stable draftKey (sourceText + originalTranslated) so that
          // inserted / removed / reordered lines don't corrupt wrong rows.
          // Fallback: for old drafts without draftKey, match by originalTranslated.
          const savedRows = saved.lineEditor!.rows;
          const draftKeyMap = new Map<string, (typeof savedRows)[number]>();
          const fallbackMatch = new Map<string, (typeof savedRows)[number]>();
          for (const sr of savedRows) {
            if (sr.draftKey) {
              draftKeyMap.set(sr.draftKey, sr);
            } else {
              // Old drafts: key by originalTranslated for fallback
              fallbackMatch.set(sr.originalTranslated, sr);
            }
          }
          const mergedRows = freshRows.map((row) => {
            const key = buildLineDraftKey(row.sourceText, row.translatedText);
            const savedRow = draftKeyMap.get(key) ?? fallbackMatch.get(row.translatedText);
            if (savedRow) {
              return {
                ...row,
                translatedText: savedRow.translatedText,
                dirty: savedRow.dirty,
                originalTranslated: savedRow.originalTranslated,
              };
            }
            return row;
          });
          setRows(mergedRows);
        } else {
          const sourceLines = preview?.source_file?.content
            ? preview.source_file.content.split('\n')
            : [];
          const translatedLines = preview?.translated_file?.content
            ? preview.translated_file.content.split('\n')
            : [];
          setRows(buildRows(sourceLines, translatedLines));
        }
        setFilter('all');
        setRowHeights({});
      } else {
        // Same pair, preview refreshed — only rebuild if no dirty rows
        const currentRows = rowsRef.current;
        const anyDirty = currentRows.some((r) => r.dirty);
        if (!anyDirty) {
          const sourceLines = preview?.source_file?.content
            ? preview.source_file.content.split('\n')
            : [];
          const translatedLines = preview?.translated_file?.content
            ? preview.translated_file.content.split('\n')
            : [];
          setRows(buildRows(sourceLines, translatedLines));
          setFilter('all');
        }
        // If dirty rows exist, preserve local state
      }
    }
  }, [pairId, preview]);

  /* ---- Row heights state (per-row manual resize) ------------------ */
  const [rowHeights, setRowHeights] = useState<Record<number, number>>({});

  /* ---- Translation change handler --------------------------------- */
  const handleTranslationChange = useCallback(
    (rowId: number, value: string) => {
      setRows((prev) =>
        prev.map((row) => {
          if (row.id !== rowId) return row;
          const dirty = value !== row.originalTranslated;
          return { ...row, translatedText: value, dirty };
        }),
      );
    },
    [],
  );

  /* ---- Revert all rows -------------------------------------------- */
  const handleRevert = useCallback(() => {
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        translatedText: row.originalTranslated,
        dirty: false,
      })),
    );
  }, []);

  /* ---- Save changes via API --------------------------------------- */
  const handleSave = useCallback(async () => {
    saveSeqRef.current += 1;
    const mySaveSeq = saveSeqRef.current;

    const fileId = preview?.translated_file?.file_id;
    if (!fileId) {
      toast.showToast('No translation file to save.', 'error');
      return;
    }

    const currentRows = rowsRef.current;
    if (!currentRows.some((r) => r.dirty)) return; // no-op

    const fullContent = currentRows.map((row) => row.translatedText).join('\n');

    setSaving(true);
    try {
      await api.savePairingFileContent(projectId, fileId, fullContent);

      // Guard: if pairId changed since save started, discard stale completion
      if (mySaveSeq !== saveSeqRef.current) return;

      // Clear dirty, update originals so next edit → dirty comparison works
      setRows((prev) =>
        prev.map((row) => ({
          ...row,
          dirty: false,
          originalTranslated: row.translatedText,
        })),
      );

      // After a successful line-editor save the draft for this pair is
      // no longer needed.
      pairDraftStore.clearLineEditorDraft(pairId!);

      toast.showToast('Line edits saved.', 'success');
      onContentSaved?.();
    } catch (err) {
      if (mySaveSeq === saveSeqRef.current) {
        const message =
          err instanceof ApiError ? err.message : 'Failed to save line edits';
        toast.showToast(message, 'error');
      }
    } finally {
      if (mySaveSeq === saveSeqRef.current) {
        setSaving(false);
      }
    }
  }, [projectId, preview, toast, onContentSaved]);

  /* ---- Row resize handler ----------------------------------------- */
  const startRowResize = useCallback(
    (event: React.PointerEvent, rowId: number) => {
      event.preventDefault();
      event.stopPropagation();
      const rowEl = event.currentTarget.closest('.pair-line-editor__row') as HTMLElement | null;
      if (!rowEl) return;
      const startY = event.clientY;
      const startHeight = rowEl.getBoundingClientRect().height;
      const minHeight = 72;
      const maxHeight = 480;

      function onPointerMove(moveEvent: PointerEvent) {
        const delta = moveEvent.clientY - startY;
        const next = Math.max(minHeight, Math.min(maxHeight, Math.round(startHeight + delta)));
        setRowHeights((prev) => ({ ...prev, [rowId]: next }));
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
    [],
  );

  /* ---- Computed stats --------------------------------------------- */
  const stats = useMemo(() => {
    const total = rows.length;
    let matched = 0;
    let sourceOnly = 0;
    let translatedOnly = 0;
    let edited = 0;

    for (const row of rows) {
      if (row.state === 'matched') matched++;
      else if (row.state === 'source_only') sourceOnly++;
      else if (row.state === 'translated_only') translatedOnly++;
      if (row.dirty) edited++;
    }

    return { total, matched, sourceOnly, translatedOnly, edited };
  }, [rows]);

  /* ---- Filtered rows ---------------------------------------------- */
  const filteredRows = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'edited') return rows.filter((r) => r.dirty);
    return rows.filter((r) => r.state === filter);
  }, [rows, filter]);

  const hasDirty = stats.edited > 0;

  /* Track dirty for upward reporting --------------------------------- */
  const currentDirty = hasDirty;
  const prevDirtyRef = useRef<boolean | null>(null);

  /* ---- Report dirty state to parent -------------------------------- */
  useEffect(() => {
    if (onDirtyChange && prevDirtyRef.current !== currentDirty) {
      prevDirtyRef.current = currentDirty;
      onDirtyChange(currentDirty);
    }
  }, [currentDirty, onDirtyChange]);

  /* ---- Pre-compute original content for empty-source fallback ----- */
  const sourceFile = preview?.source_file ?? null;
  const translatedFile = preview?.translated_file ?? null;

  /* ================================================================ */
  /*  Render — states                                                  */
  /* ================================================================ */

  if (!pairId) {
    return (
      <div className="pair-line-editor">
        <div className="empty-state">Select a pair to edit lines.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="pair-line-editor">
        <div className="empty-state">Loading line editor...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pair-line-editor">
        <div className="alert alert-error">{error}</div>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="pair-line-editor">
        <div className="empty-state">No line editor data available.</div>
      </div>
    );
  }

  /* ================================================================ */
  /*  Render — full editor                                             */
  /* ================================================================ */

  const missingSource = !sourceFile;
  const missingTranslated = !translatedFile;

  return (
    <div className="pair-line-editor">
      {/* ---- Toolbar ---- */}
      <div className="pair-line-editor__toolbar">
        <div className="pair-line-editor__stats">
          <span className="pair-line-editor__stat">
            <span className="pair-line-editor__stat-value">{stats.total}</span>
            <span className="pair-line-editor__stat-label">Rows</span>
          </span>
          <span className="pair-line-editor__stat">
            <span className="pair-line-editor__stat-value">{stats.matched}</span>
            <span className="pair-line-editor__stat-label">Matched</span>
          </span>
          <span className="pair-line-editor__stat">
            <span className="pair-line-editor__stat-value">{stats.sourceOnly}</span>
            <span className="pair-line-editor__stat-label">Source only</span>
          </span>
          <span className="pair-line-editor__stat">
            <span className="pair-line-editor__stat-value">{stats.translatedOnly}</span>
            <span className="pair-line-editor__stat-label">Translated only</span>
          </span>
          <span className="pair-line-editor__stat">
            <span className="pair-line-editor__stat-value">{stats.edited}</span>
            <span className="pair-line-editor__stat-label">Edited</span>
          </span>
        </div>

        <div className="pair-line-editor__toolbar-right">
          <div className="pair-line-editor__filters">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                className={`pair-line-editor__filter-btn ${filter === opt.id ? 'pair-line-editor__filter-btn--active' : ''}`}
                onClick={() => setFilter(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---- Column headers ---- */}
      <div className="pair-line-editor__headers">
        <div className="pair-line-editor__header-cell">
          SOURCE{missingSource ? ' (missing)' : ''}
        </div>
        <div className="pair-line-editor__header-cell">
          TRANSLATION{missingTranslated ? ' (missing)' : ''}
        </div>
      </div>

      {/* ---- Body rows ---- */}
      {filteredRows.length === 0 ? (
        <div className="pair-line-editor__empty">
          {filter !== 'all'
            ? `No rows match the "${FILTER_OPTIONS.find((o) => o.id === filter)?.label ?? filter}" filter.`
            : 'No file content available.'}
        </div>
      ) : (
        <div className="pair-line-editor__body custom-scrollbar">
          {filteredRows.map((row) => {
            const rowClasses = [
              'pair-line-editor__row',
              row.dirty ? 'pair-line-editor__row--dirty' : '',
              row.state === 'source_only' ? 'pair-line-editor__row--source-only' : '',
              row.state === 'translated_only' ? 'pair-line-editor__row--translated-only' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div
                key={row.id}
                className={rowClasses}
                style={rowHeights[row.id] ? { height: `${rowHeights[row.id]}px` } : undefined}
              >
                {/* Source cell */}
                <div className="pair-line-editor__cell">
                  <div className="pair-line-editor__cell-meta">
                    <span className="pair-line-editor__cell-meta-left">
                      {row.sourceLineNumber !== null ? `L${row.sourceLineNumber}` : ''}
                      {onOpenInFileView && (
                        <button
                          className="pair-line-editor__open-btn"
                          onClick={() =>
                            onOpenInFileView({
                              sourceLineNumber: row.sourceLineNumber,
                              translatedLineNumber: row.translatedLineNumber,
                            })
                          }
                          title="Open in File View"
                        >
                          Open
                        </button>
                      )}
                    </span>
                    <StateBadge state={row.state} />
                  </div>
                  <div className="pair-line-editor__source-text">
                    {row.sourceText || '\u00A0'}
                  </div>
                </div>

                {/* Translation cell */}
                <div className="pair-line-editor__cell">
                  <div className="pair-line-editor__cell-meta">
                    <span>
                      {row.translatedLineNumber !== null
                        ? `L${row.translatedLineNumber}`
                        : ''}
                    </span>
                  </div>
                  {missingTranslated ? (
                    <div className="pair-line-editor__empty">
                      File content not available.
                    </div>
                  ) : (
                    <textarea
                      className={`pair-line-editor__translation-input${row.dirty ? ' pair-line-editor__translation-input--dirty' : ''}`}
                      value={row.translatedText}
                      onChange={(e) =>
                        handleTranslationChange(row.id, e.target.value)
                      }
                      spellCheck={false}
                    />
                  )}
                </div>
                <div
                  className="pair-line-editor__row-resize-handle"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label={`Resize row ${row.id + 1}`}
                  onPointerDown={(event) => startRowResize(event, row.id)}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* ---- Actions ---- */}
      <div className="pair-line-editor__actions">
        <button
          className="btn btn-sm btn-primary"
          onClick={handleSave}
          disabled={!hasDirty || saving}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        <button
          className="btn btn-sm btn-outline"
          onClick={handleRevert}
          disabled={!hasDirty || saving}
        >
          Revert Changes
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  StateBadge — small label showing row state                         */
/* ------------------------------------------------------------------ */

interface StateBadgeProps {
  state: LineRow['state'];
}

function StateBadge({ state }: StateBadgeProps) {
  if (state === 'matched') return null; // no badge for normal matched rows

  const label =
    state === 'source_only'
      ? 'Src'
      : state === 'translated_only'
        ? 'Trans'
        : 'Empty';

  return (
    <span className={`pair-line-editor__state-badge pair-line-editor__state-badge--${state}`}>
      {label}
    </span>
  );
}
