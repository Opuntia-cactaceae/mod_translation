/* ------------------------------------------------------------------ */
/*  ProjectWorkspace — workspace shell rendered below project cards     */
/*                                                                      */
/*  Layout:
/*    Header (settings, actions)
/*    Top:   FILES tree (left) | PAIR BOARD (right)
/*    Bottom: editor/preview/alignment panel (collapsible)              */
/* ------------------------------------------------------------------ */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { PairingProject, SuggestFilterScope, ApplyAlignmentResponse } from '../../api/types';
import { api, ApiError, useToast } from '../../App';
import { setDragFilePayload } from '../../domain/dragPayload';
import BottomEditorPanel, { type BottomEditorTab } from './BottomEditorPanel';
import { ConfirmDialog } from '../common/ConfirmDialog';
import LearnDialog from './LearnDialog';
import PairWorkspaceLayout from './workspace/PairWorkspaceLayout';
import PairingFileWorkspace, { type RevealTarget } from './workspace/PairingFileWorkspace';
import PairList, { __resetLineMatchCache } from './workspace/PairList';
import ProjectSettingsForm from './ProjectSettingsForm';
import { usePairingGroups } from '../../hooks/usePairingGroups';
import { usePairingPairs } from '../../hooks/usePairingPairs';
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning';
import type { WorkspaceFileGroup, WorkspaceFile, WorkspacePair } from '../../domain/pairingTypes';
import { buildPairingFileStateMap, getActivePairPaths } from '../../domain/pairingFileState';
import { pairDraftStore } from '../../utils/pairDraftStore';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ProjectWorkspaceProps {
  project: PairingProject;
  onProjectUpdated: () => void;
  onBackToList: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(raw: string | null | undefined): string {
  if (!raw) return '-';
  try {
    const d = new Date(raw);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return raw;
  }
}

/** Recursively build a file path → WorkspaceFile lookup map from the groups tree. */
function buildFilesByPath(groups: WorkspaceFileGroup[]): Map<string, WorkspaceFile> {
  const map = new Map<string, WorkspaceFile>();
  function walk(list: WorkspaceFileGroup[]) {
    for (const g of list) {
      for (const f of g.files) {
        map.set(f.relativePath, f);
      }
      walk(g.children);
    }
  }
  walk(groups);
  return map;
}

/* ================================================================== */
/*  Pairing-action helpers                                             */
/* ================================================================== */

interface FileAssignment {
  pair: WorkspacePair;
  role: 'source' | 'translated';
}

/** Find which pair (if any) a file ID is assigned to, and in what role. */
function findFileAssignment(
  fileId: string,
  pairs: WorkspacePair[],
): FileAssignment | null {
  for (const pair of pairs) {
    if (pair.sourceFileId === fileId) return { pair, role: 'source' };
    if (pair.translatedFileId === fileId) return { pair, role: 'translated' };
  }
  return null;
}

/**
 * Find the best target pair for a given slot.
 *
 * Priority:
 *   a. selectedPairId if that pair has the slot empty
 *   b. first incomplete pair (any) with the slot empty
 *   c. null → caller creates a new pair
 */
function findBestTargetPairForSlot(
  slot: 'source' | 'translated',
  pairs: WorkspacePair[],
  selectedPairId: string | null,
): WorkspacePair | null {
  // a) Selected pair with empty slot
  if (selectedPairId) {
    const sp = pairs.find(p => p.id === selectedPairId);
    if (sp && (slot === 'source' ? !sp.sourceFileId : !sp.translatedFileId)) {
      return sp;
    }
  }
  // b) First pair (any) with empty slot
  const emptyField = slot === 'source' ? 'sourceFileId' as const : 'translatedFileId' as const;
  return pairs.find(p => !p[emptyField]) ?? null;
  // c) null → caller creates new
}

/**
 * Returns true when dropping a file into the given slot of a pair would
 * make the same file occupy both slots (source_file_id === translated_file_id).
 */
function wouldDuplicateFileInPair(
  targetSlot: 'source' | 'translated',
  fileId: string,
  pair: WorkspacePair | undefined,
): boolean {
  if (!pair) return false;
  return targetSlot === 'source'
    ? pair.translatedFileId === fileId
    : pair.sourceFileId === fileId;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ProjectWorkspace({
  project,
  onProjectUpdated,
  onBackToList,
}: ProjectWorkspaceProps) {
  const toast = useToast();

  /* ================================================================ */
  /*  Hooks — groups, pairs                                           */
  /* ================================================================ */

  // Use fixed by_directory mode — PairingFileWorkspace handles
  // client-side grouping via genericFileGrouping.ts
  const {
    groups,
    loading: groupsLoading,
    refresh: refreshGroups,
  } = usePairingGroups(project.id, 'by_directory');

  const {
    pairs,
    loading: pairsLoading,
    error: pairsError,
    refresh: refreshPairs,
    createPair,
    suggestPairs,
    updatePairFiles,
    deletePair,
    clearPairs,
  } = usePairingPairs(project.id);

  /* ================================================================ */
  /*  Derived — file path → WorkspaceFile lookup map                   */
  /* ================================================================ */

  const filesByPath = useMemo(() => buildFilesByPath(groups), [groups]);

  /** Per-file pairing state map — computed from current pairs. */
  const pairingFileState = useMemo(() => buildPairingFileStateMap(pairs), [pairs]);

  const [selectedPairId, setSelectedPairId] = useState<string | null>(null);

  /** Dirty state from bottom editor — used to guard data-loss actions. */
  const [bottomDirty, setBottomDirty] = useState(false);

  /** Confirm-unsaved-changes dialog — replaces raw window.confirm. */
  const [confirmUnsavedOpen, setConfirmUnsavedOpen] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  /** Browser-level guard for tab close / page refresh. */
  useUnsavedChangesWarning({
    dirty: bottomDirty,
    message: 'You have unsaved changes in the editor. Leave anyway?',
  });

  /* ================================================================ */
  /*  Resize state — manual drag height for top/bottom sections        */
  /* ================================================================ */

  const [topHeightPx, setTopHeightPx] = useState<number | null>(null);
  const [bottomHeightPx, setBottomHeightPx] = useState<number | null>(null);

  /* Refs for explicit resize targets (handle lives inside .pw-files-card, not .pairing-workspace-top) */
  const topResizeTargetRef = useRef<HTMLDivElement | null>(null);
  const bottomResizeTargetRef = useRef<HTMLDivElement | null>(null);

  /* Track the bottom editor height before normalize expansion so we
     can restore it when normalize is collapsed. */
  const preNormalizeBottomHeightRef = useRef<number | null>(null);

  const startVerticalResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, section: 'top' | 'bottom') => {
      event.preventDefault();
      event.stopPropagation();
      const target =
        section === 'top'
          ? topResizeTargetRef.current
          : bottomResizeTargetRef.current;
      if (!target) return;
      const startY = event.clientY;
      const startScrollY = window.scrollY;
      const startHeight = target.getBoundingClientRect().height;
      const min = 520;
      const max = section === 'top' ? 1600 : 1400;
      let lastNext = startHeight;

      function onPointerMove(moveEvent: PointerEvent) {
        // Auto-scroll when cursor approaches viewport edges
        const viewportHeight = window.innerHeight;
        const edgeThreshold = 80;
        const maxScrollStep = 28;
        let scrollStep = 0;
        if (moveEvent.clientY > viewportHeight - edgeThreshold) {
          const distance = viewportHeight - moveEvent.clientY;
          scrollStep = Math.round(((edgeThreshold - distance) / edgeThreshold) * maxScrollStep);
        } else if (moveEvent.clientY < edgeThreshold) {
          scrollStep = -Math.round(((edgeThreshold - moveEvent.clientY) / edgeThreshold) * maxScrollStep);
        }
        if (scrollStep !== 0) {
          window.scrollBy({ top: scrollStep, behavior: 'auto' });
        }

        const totalDelta =
          (moveEvent.clientY - startY) +
          (window.scrollY - startScrollY);
        const next = Math.max(min, Math.min(max, Math.round(startHeight + totalDelta)));
        lastNext = next;
        if (section === 'top') setTopHeightPx(next);
        else setBottomHeightPx(next);
      }

      function onPointerUp() {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        document.body.classList.remove('is-resizing-vertical');
        // When the bottom panel was dragged taller than its starting
        // height, scroll the page to keep the panel fully in view.
        if (section === 'bottom' && lastNext > startHeight && target) {
          requestAnimationFrame(() => {
            // Wait one frame for React to commit the state update to the
            // DOM (setBottomHeightPx was called outside a React event
            // handler, so React schedules work via MessageChannel and may
            // not have committed by the first rAF).
            requestAnimationFrame(() => {
              const rect = target.getBoundingClientRect();
              const delta = rect.bottom - window.innerHeight + 16;
              if (delta > 0) {
                window.scrollBy({ top: delta, behavior: 'smooth' });
              }
            });
          });
        }
      }

      document.body.classList.add('is-resizing-vertical');
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [],
  );

  /** File paths belonging to the currently active/selected pair. */
  const activePairPaths = useMemo(
    () => getActivePairPaths(pairs, selectedPairId),
    [pairs, selectedPairId],
  );

  /* ================================================================ */
  /*  Ephemeral workspace state                                        */
  /* ================================================================ */

  const [editorTab, setEditorTab] = useState<BottomEditorTab>('fileView');
  /** Incremented to trigger line match stats re-fetch (e.g. after save normalization). */
  const [lineMatchRefreshKey, setLineMatchRefreshKey] = useState(0);
  /** Incremented to auto-expand normalize section in File View (e.g. from Open Normalize). */
  const [normalizeAutoExpandKey, setNormalizeAutoExpandKey] = useState(0);
  const [showLearnDialog, setShowLearnDialog] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [scanResult, setScanResult] = useState<{
    total_files: number;
    new_files: number;
    updated_files: number;
  } | null>(null);

  /** Reveal target state — file path + incrementing nonce to trigger reveal in the file tree. */
  const [revealFilePath, setRevealFilePath] = useState<string | null>(null);
  const [revealNonce, setRevealNonce] = useState(0);

  /* ---- Filter scope ref (updated by PairingFileWorkspace for Suggest Pairs) ---- */
  const filterScopeRef = useRef<SuggestFilterScope>({});
  const onFilterScopeUpdate = useCallback((scope: SuggestFilterScope) => {
    filterScopeRef.current = scope;
  }, []);

  const revealTarget: RevealTarget | undefined = useMemo(
    () => (revealFilePath ? { filePath: revealFilePath, nonce: revealNonce } : undefined),
    [revealFilePath, revealNonce],
  );

  /* ================================================================ */
  /*  Derived state                                                    */
  /* ================================================================ */

  const hasLearnablePairs = pairs.some(
    (p) => p.status === 'accepted' || p.status === 'manual',
  );

  const manualPairCount = pairs.filter((p) => p.status === 'manual').length;
  const acceptedPairCount = pairs.filter((p) => p.status === 'accepted').length;

  /** Bottom panel is open when a pair is selected AND has been explicitly activated. */
  const showBottomPanel = selectedPairId !== null;

  /* ================================================================ */
  /*  Effects                                                          */
  /* ================================================================ */

  /* Auto-dismiss scan result after 5 seconds */
  useEffect(() => {
    if (!scanResult) return;
    const timer = setTimeout(() => {
      setScanResult(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [scanResult]);

  /* Clear editor tab when selectedPairId becomes null */
  useEffect(() => {
    if (!selectedPairId) {
      setEditorTab('fileView');
    }
  }, [selectedPairId]);

  /* Cleanup: clear selectedPairId if the pair was deleted */
  useEffect(() => {
    const pairExists = pairs.some((p) => p.id === selectedPairId);
    if (selectedPairId && !pairExists) {
      setSelectedPairId(null);
    }
  }, [pairs, selectedPairId]);

  /* ================================================================ */
  /*  Action handlers                                                  */
  /* ================================================================ */

  const handleScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    setScanResult(null);
    try {
      const result = await api.scanPairingProject(project.id);
      setScanResult({
        total_files: result.total_files,
        new_files: result.new_files,
        updated_files: result.updated_files,
      });
      toast.showToast('Scan completed');
      refreshGroups();
      onProjectUpdated();
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Scan failed';
      toast.showToast(message, 'error');
    } finally {
      setScanning(false);
    }
  }, [project.id, scanning, toast, refreshGroups, onProjectUpdated]);

  const handleSuggest = useCallback(async () => {
    if (suggesting) return;
    setSuggesting(true);
    try {
      const scope = filterScopeRef.current;
      const hasFilters = scope.include_filter || scope.exclude_filter
        || (scope.extensions && scope.extensions.length > 0);
      await suggestPairs(hasFilters ? { scope: 'filtered', filters: scope } : undefined);
      toast.showToast('Pair suggestions generated');
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Failed to suggest pairs';
      toast.showToast(message, 'error');
    } finally {
      setSuggesting(false);
    }
  }, [suggesting, toast, suggestPairs]);

  const handleClearAll = useCallback(async () => {
    // Clear all in-memory drafts for the project
    pairDraftStore.clearAll();
    if (bottomDirty) {
      pendingActionRef.current = async () => {
        try {
          await clearPairs();
          setSelectedPairId(null);
          toast.showToast('All pairs cleared', 'success');
        } catch (err: unknown) {
          const message = err instanceof ApiError ? err.message : 'Failed to clear pairs';
          toast.showToast(message, 'error');
          throw err;
        }
      };
      setConfirmUnsavedOpen(true);
      return;
    }
    try {
      await clearPairs();
      setSelectedPairId(null);
      toast.showToast('All pairs cleared', 'success');
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Failed to clear pairs';
      toast.showToast(message, 'error');
      throw err; // re-throw so PairsPanel can also handle
    }
  }, [bottomDirty, clearPairs, toast]);

  /** Delete a single pair with dirty guard. Clears in-memory drafts. */
  const handleDeletePair = useCallback(async (pairId: string) => {
    // Clear in-memory drafts for the deleted pair
    pairDraftStore.clearPair(pairId);
    if (bottomDirty) {
      pendingActionRef.current = async () => {
        try {
          await deletePair(pairId);
          if (selectedPairId === pairId) setSelectedPairId(null);
          toast.showToast('Pair deleted', 'success');
        } catch (err: unknown) {
          const message = err instanceof ApiError ? err.message : 'Failed to delete pair';
          toast.showToast(message, 'error');
        }
      };
      setConfirmUnsavedOpen(true);
      return;
    }
    try {
      await deletePair(pairId);
      if (selectedPairId === pairId) setSelectedPairId(null);
      toast.showToast('Pair deleted', 'success');
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete pair';
      toast.showToast(message, 'error');
    }
  }, [bottomDirty, deletePair, selectedPairId, toast]);

  /** Called after normalization settings are saved — invalidates line match cache and triggers re-fetch. */
  const handleNormalizationSaved = useCallback(() => {
    __resetLineMatchCache(project.id);
    setLineMatchRefreshKey((k) => k + 1);
  }, [project.id]);

  /** Called after normalization is applied to file(s) — invalidates line match cache and triggers re-fetch. */
  const handleNormalizationApplied = useCallback(
    (_result: ApplyAlignmentResponse) => {
      __resetLineMatchCache(project.id);
      setLineMatchRefreshKey((k) => k + 1);
    },
    [project.id],
  );

  /* Keep a ref to bottomHeightPx so the callback below stays stable. */
  const bottomHeightPxRef = useRef(bottomHeightPx);
  bottomHeightPxRef.current = bottomHeightPx;

  /** When Normalize expands, grow the bottom editor by the body content
   *  height (like an automatic resize-handle drag).  Collapse restores
   *  the previous height.  Also scroll the panel into view so the newly
   *  revealed content is visible. */
  const handleNormalizeExpandedChange = useCallback(
    (expanded: boolean, bodyHeight?: number) => {
      if (expanded && bodyHeight && bodyHeight > 0) {
        const currentHeight =
          bottomHeightPxRef.current ??
          (bottomResizeTargetRef.current?.getBoundingClientRect().height ?? 520);
        preNormalizeBottomHeightRef.current = currentHeight;
        setBottomHeightPx(currentHeight + bodyHeight);
        // Wait one frame for React to flush and commit the height
        // change before scrolling.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const target = bottomResizeTargetRef.current;
            if (target) {
              const rect = target.getBoundingClientRect();
              const delta = rect.bottom - window.innerHeight + 16;
              if (delta > 0) {
                window.scrollBy({ top: delta, behavior: 'smooth' });
              }
            }
          });
        });
      } else if (!expanded) {
        if (preNormalizeBottomHeightRef.current !== null) {
          setBottomHeightPx(preNormalizeBottomHeightRef.current);
          preNormalizeBottomHeightRef.current = null;
        }
      }
    },
    [],
  );

  /** Called when the File View columns resize handle is released.
   *  Grows/shrinks the bottom editor zone by the same delta so the
   *  Normalize section stays in place and the whole zone grows.
   *  On grow, scrolls the page to keep the bottom of the editor in view. */
  const handleFileViewResize = useCallback((delta: number) => {
    const currentHeight =
      bottomHeightPxRef.current ??
      (bottomResizeTargetRef.current?.getBoundingClientRect().height ?? 520);
    const newHeight = Math.max(520, currentHeight + delta);
    setBottomHeightPx(newHeight);
    if (delta > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const target = bottomResizeTargetRef.current;
          if (target) {
            const rect = target.getBoundingClientRect();
            const scrollDelta = rect.bottom - window.innerHeight + 16;
            if (scrollDelta > 0) {
              window.scrollBy({ top: scrollDelta, behavior: 'smooth' });
            }
          }
        });
      });
    }
  }, []);

  /** Set as source: toggle off if already source, move within pair if translated+empty_source, or fill/create pair. */
  const handleDirectSetAsSource = useCallback(async (filePath: string) => {
    const file = filesByPath.get(filePath);
    if (!file) {
      toast.showToast('File not found', 'error');
      return;
    }

    try {
      const assignment = findFileAssignment(file.id, pairs);

      // CASE 1: Already source → toggle off (unassign)
      if (assignment && assignment.role === 'source') {
        const { pair } = assignment;
        await updatePairFiles(pair.id, { source_file_id: null });
        if (!pair.translatedFileId) {
          // Both slots empty → delete the pair
          await deletePair(pair.id);
          toast.showToast('Pair removed', 'success');
        } else {
          toast.showToast('Source file removed', 'success');
        }
        return;
      }

      // CASE 2: Already translated
      if (assignment && assignment.role === 'translated') {
        // 2a: Same pair has empty source → move within pair
        if (!assignment.pair.sourceFileId) {
          await updatePairFiles(assignment.pair.id, {
            translated_file_id: null,
            source_file_id: file.id,
          });
          setSelectedPairId(assignment.pair.id);
          toast.showToast('Moved to source slot', 'success');
          return;
        }
        // 2b: Pair already has source → cannot change role
        toast.showToast('File is assigned as translated, cannot set as source', 'error');
        return;
      }

      // CASE 3: Unassigned → find best target pair
      const target = findBestTargetPairForSlot('source', pairs, selectedPairId);
      if (target) {
        await updatePairFiles(target.id, { source_file_id: file.id });
        setSelectedPairId(target.id);
        toast.showToast('Source file set', 'success');
      } else {
        const newId = await createPair(file.id, null);
        if (newId) setSelectedPairId(newId);
        toast.showToast('Pair created with source file', 'success');
      }
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Failed to set source file';
      toast.showToast(message, 'error');
    }
  }, [filesByPath, pairs, selectedPairId, updatePairFiles, createPair, deletePair, toast, setSelectedPairId]);

  /** Set as translated: toggle off if already translated, move within pair if source+empty_translated, or fill/create pair. */
  const handleDirectSetAsTranslated = useCallback(async (filePath: string) => {
    const file = filesByPath.get(filePath);
    if (!file) {
      toast.showToast('File not found', 'error');
      return;
    }

    try {
      const assignment = findFileAssignment(file.id, pairs);

      // CASE 1: Already translated → toggle off (unassign)
      if (assignment && assignment.role === 'translated') {
        const { pair } = assignment;
        await updatePairFiles(pair.id, { translated_file_id: null });
        if (!pair.sourceFileId) {
          // Both slots empty → delete the pair
          await deletePair(pair.id);
          toast.showToast('Pair removed', 'success');
        } else {
          toast.showToast('Translated file removed', 'success');
        }
        return;
      }

      // CASE 2: Already source
      if (assignment && assignment.role === 'source') {
        // 2a: Same pair has empty translated → move within pair
        if (!assignment.pair.translatedFileId) {
          await updatePairFiles(assignment.pair.id, {
            source_file_id: null,
            translated_file_id: file.id,
          });
          setSelectedPairId(assignment.pair.id);
          toast.showToast('Moved to translated slot', 'success');
          return;
        }
        // 2b: Pair already has translated → cannot change role
        toast.showToast('File is assigned as source, cannot set as translated', 'error');
        return;
      }

      // CASE 3: Unassigned → find best target pair
      const target = findBestTargetPairForSlot('translated', pairs, selectedPairId);
      if (target) {
        await updatePairFiles(target.id, { translated_file_id: file.id });
        setSelectedPairId(target.id);
        toast.showToast('Translated file set', 'success');
      } else {
        const newId = await createPair(null, file.id);
        if (newId) setSelectedPairId(newId);
        toast.showToast('Pair created with translated file', 'success');
      }
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Failed to set translated file';
      toast.showToast(message, 'error');
    }
  }, [filesByPath, pairs, selectedPairId, updatePairFiles, createPair, deletePair, toast, setSelectedPairId]);

  const handleSelectPair = useCallback((pairId: string) => {
    const isClosing = selectedPairId === pairId;
    if (isClosing) {
      setSelectedPairId(null);
    } else {
      setSelectedPairId(pairId);
    }
    setEditorTab('fileView');
  }, []);

  const handleOpenFileView = useCallback((pairId: string) => {
    setSelectedPairId(pairId);
    setEditorTab('fileView');
  }, []);

  const handleOpenNormalize = useCallback((pairId: string) => {
    setSelectedPairId(pairId);
    setEditorTab('fileView');
    setNormalizeAutoExpandKey((k) => k + 1);
  }, []);

  const handleCloseBottomPanel = useCallback(() => {
    if (bottomDirty) {
      pendingActionRef.current = () => { setSelectedPairId(null); setEditorTab('fileView'); };
      setConfirmUnsavedOpen(true);
      return;
    }
    setSelectedPairId(null);
    setEditorTab('fileView');
  }, [bottomDirty]);

  const handleBackToList = useCallback(() => {
    if (bottomDirty) {
      pendingActionRef.current = onBackToList;
      setConfirmUnsavedOpen(true);
      return;
    }
    onBackToList();
  }, [bottomDirty, onBackToList]);

  /* ---- Drag-and-drop handlers ---- */

  /** FILES tree drag start: serialize file into drag payload. */
  const handleFileDragStart = useCallback((filePath: string, event: React.DragEvent) => {
    const file = filesByPath.get(filePath);
    if (!file) return;
    setDragFilePayload(event.dataTransfer, {
      fileId: file.id,
      relativePath: file.relativePath,
      fileName: file.fileName,
      detectedRole: file.detectedRole,
      sourcePairId: null,
      sourceSlot: null,
    });
    event.dataTransfer.effectAllowed = 'copy';
  }, [filesByPath]);

  /** Board drop: tree-origin file dropped onto empty pair-board space → create source-only pair. */
  const handleDropFileOnBoard = useCallback(async (payload: import('../../domain/dragPayload').DragFilePayload) => {
    // Guard: only tree-origin drops
    if (payload.sourcePairId) return;
    try {
      const newId = await createPair(payload.fileId, null);
      if (newId) setSelectedPairId(newId);
      toast.showToast('Pair created from dropped file', 'success');
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Failed to create pair';
      toast.showToast(message, 'error');
    }
  }, [createPair, toast, setSelectedPairId]);

  /** Pair slot drop/clear: update slot file via API then refresh.
   *  Supports three scenarios:
   *   1. fileId === null              → clear slot (existing behavior)
   *   2. fileId !== null, no source   → tree-origin drop (single PATCH)
   *   3. fileId !== null, source known → slot-origin move (clear source, then set target) */
  const handleUpdatePairSlot = useCallback(async (
    pairId: string,
    slot: 'source' | 'translated',
    fileId: string | null,
    sourcePairId?: string | null,
    sourceSlot?: string | null,
  ) => {
    // --- Clear (fileId === null) → single PATCH, then delete if both slots empty ---
    if (fileId === null) {
      const curPair = pairs.find(p => p.id === pairId);
      const becomesEmpty = curPair && (
        slot === 'source' ? !curPair.translatedFileId : !curPair.sourceFileId
      );
      try {
        await updatePairFiles(pairId, slot === 'source'
          ? { source_file_id: null }
          : { translated_file_id: null },
        );
        if (becomesEmpty) {
          await deletePair(pairId);
          toast.showToast('Pair removed (both slots empty)', 'success');
        } else {
          toast.showToast(
            `${slot === 'source' ? 'Source' : 'Translated'} slot cleared`,
            'success',
          );
        }
      } catch (err: unknown) {
        const message = err instanceof ApiError ? err.message : 'Failed to clear slot';
        toast.showToast(message, 'error');
      }
      return;
    }

    // --- Tree-origin drop (no sourcePairId) → single PATCH ---
    if (!sourcePairId) {
      const targetPair = pairs.find(p => p.id === pairId);
      if (wouldDuplicateFileInPair(slot, fileId, targetPair)) {
        toast.showToast('Cannot set same file as both source and translated', 'error');
        return;
      }
      const data = slot === 'source'
        ? { source_file_id: fileId }
        : { translated_file_id: fileId };
      try {
        await updatePairFiles(pairId, data);
        toast.showToast(
          `${slot === 'source' ? 'Source' : 'Translated'} file updated`,
          'success',
        );
      } catch (err: unknown) {
        const message = err instanceof ApiError ? err.message : 'Failed to update pair slot';
        toast.showToast(message, 'error');
      }
      return;
    }

    // --- Slot-origin drop ---
    // Self-drop on the same slot → no-op
    if (sourcePairId === pairId && sourceSlot === slot) {
      return;
    }

    const sourceField = sourceSlot === 'source' ? 'source_file_id' : 'translated_file_id';
    const targetPair = pairs.find((p) => p.id === pairId);

    // --- Duplicate check: fileId already occupies the target pair's other slot ---
    // Only applies to cross-pair or tree-origin drops.  Same-pair slot-origin
    // moves/swaps are always valid (files are already part of the pair).
    if (sourcePairId !== pairId && wouldDuplicateFileInPair(slot, fileId, targetPair)) {
      toast.showToast('Cannot set same file as both source and translated', 'error');
      return;
    }

    // Check if target slot is occupied
    const targetSlotOccupied = targetPair
      ? slot === 'source'
        ? !!targetPair.sourceFile
        : !!targetPair.translatedFile
      : false;

    if (targetSlotOccupied) {
      // --- Swap: source slot ↔ target slot ---
      const targetField = slot === 'source' ? 'source_file_id' : 'translated_file_id';
      const targetFileId = targetPair
        ? slot === 'source'
          ? targetPair.sourceFile!.id
          : targetPair.translatedFile!.id
        : null;

      if (!targetFileId) return; // Should not happen given targetSlotOccupied check

      // Check: swapping targetFileId into source pair would not create duplicate there
      // (only for cross-pair swaps — same-pair swaps are always valid)
      if (sourcePairId !== pairId) {
        const sourcePairForSwap = pairs.find(p => p.id === sourcePairId);
        const sourceOtherSlot = sourceSlot === 'source' ? 'translated' : 'source';
        if (sourcePairForSwap && wouldDuplicateFileInPair(sourceOtherSlot, targetFileId, sourcePairForSwap)) {
          toast.showToast('Swap would create duplicate file in source pair', 'error');
          return;
        }
      }

      try {
        // Execute both PATCHes in deterministic order (source first, then target)
        await updatePairFiles(sourcePairId, { [sourceField]: targetFileId });
        await updatePairFiles(pairId, { [targetField]: fileId });
        toast.showToast(
          `Swapped ${sourceSlot === 'source' ? 'source' : 'translated'} file with ${slot === 'source' ? 'source' : 'translated'} file`,
          'success',
        );
      } catch (err: unknown) {
        const message = err instanceof ApiError ? err.message : 'Swap failed';
        toast.showToast(message, 'error');
        // Refresh pairs to reflect partial state
        refreshPairs();
      }
      return;
    }

    // --- Move to empty slot: clear source, then set target ---
    try {
      await updatePairFiles(sourcePairId, { [sourceField]: null });
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Failed to clear source slot';
      toast.showToast(message, 'error');
      return;
    }

    const targetField = slot === 'source' ? 'source_file_id' : 'translated_file_id';
    try {
      await updatePairFiles(pairId, { [targetField]: fileId });
      toast.showToast(
        `Moved ${sourceSlot === 'source' ? 'source' : 'translated'} file to ${slot === 'source' ? 'source' : 'translated'} slot`,
        'success',
      );
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Slot update failed after clearing source';
      toast.showToast(message, 'error');
      refreshPairs();
    }
  }, [updatePairFiles, toast, pairs, refreshPairs]);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  const shellClass = showBottomPanel && selectedPairId
    ? 'pairing-workspace-shell pairing-workspace-shell--with-bottom'
    : 'pairing-workspace-shell';

  return (
    <div className={shellClass}>
      {/* Card settings section */}
      <div className="pairing-workspace-settings">
        <ProjectSettingsForm
          project={project}
          onSaved={onProjectUpdated}
        />
      </div>

      {/* Workspace header */}
      <div className="pairing-workspace-header">
        <div className="pw-workspace-meta">
          <span className="pw-workspace-meta__item pw-workspace-meta__item--root">
            <strong>Root:</strong>{' '}
            <code className="pw-workspace-meta__root-path" title={project.root_path}>
              {project.root_path}
            </code>
          </span>
          <span>
            <strong>Last scanned:</strong>{' '}
            {formatDate(project.last_scanned_at)}
          </span>
          <span>
            <strong>Status:</strong>{' '}
            <span className="badge">{project.status}</span>
          </span>
        </div>

        {/* Action buttons row */}
        <div className="pw-workspace-actions">
          <button
            className="btn btn-sm btn-primary"
            onClick={handleSuggest}
            disabled={suggesting}
          >
            {suggesting ? 'Suggesting...' : 'Suggest Pairs'}
          </button>

          <button
            className="btn btn-sm btn-outline"
            onClick={() => setShowLearnDialog(true)}
          >
            Learn
          </button>
        </div>
      </div>

      {/* Top area: pairing workspace grid (files + pair board) */}
      <div
        ref={topResizeTargetRef}
        className="pairing-workspace-top"
        style={topHeightPx !== null ? { height: `${topHeightPx}px` } : undefined}
      >
        <PairWorkspaceLayout
          leftColumn={
            <PairingFileWorkspace
              projectId={project.id}
              rootPath={project.root_path ?? ''}
              lastScannedAt={project.last_scanned_at ?? null}
              groups={groups}
              groupsLoading={groupsLoading}
              onRefreshGroups={refreshGroups}
              onScan={handleScan}
              scanning={scanning}
              scanResult={scanResult}
              filesByPath={filesByPath}
              onSetAsSource={handleDirectSetAsSource}
              onSetAsTranslated={handleDirectSetAsTranslated}
              pairingFileState={pairingFileState}
              selectedPairId={selectedPairId}
              activePairPaths={activePairPaths}
              revealTarget={revealTarget}
              onFileDragStart={handleFileDragStart}
              onFilterScopeUpdate={onFilterScopeUpdate}
              resizeHandle={
                <div
                  className="pairing-workspace-resize-handle pairing-workspace-resize-handle--top"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize files and pairs area"
                  onPointerDown={(event) => startVerticalResize(event, 'top')}
                />
              }
            />
          }
          centerColumn={
            <PairList
              projectId={project.id}
              pairs={pairs}
              loading={pairsLoading}
              error={pairsError}
              onPairsChange={refreshPairs}
              selectedPairId={selectedPairId}
              onSelectPair={handleSelectPair}
              onOpenFileView={handleOpenFileView}
              onOpenNormalize={handleOpenNormalize}
              onRevealFile={(filePath: string) => {
                setRevealFilePath(filePath);
                setRevealNonce(n => n + 1);
              }}
              onUpdatePairSlot={handleUpdatePairSlot}
              onDropFileOnBoard={handleDropFileOnBoard}
              getFilterScope={() => filterScopeRef.current}
              onClearAll={handleClearAll}
              onDeletePair={handleDeletePair}
              lineMatchRefreshKey={lineMatchRefreshKey}
              dirty={bottomDirty}
            />
          }
        />
      </div>

      {/* Bottom panel — separate grid row, only when a pair is selected */}
      {showBottomPanel && selectedPairId && (
        <div
          ref={bottomResizeTargetRef}
          className="pairing-workspace-bottom"
          style={bottomHeightPx !== null ? { height: `${bottomHeightPx}px` } : undefined}
        >
          <div className="pw-bottom-panel">
            <BottomEditorPanel
              projectId={project.id}
              pairId={selectedPairId}
              initialTab={editorTab}
              onClose={handleCloseBottomPanel}
              onDirtyChange={setBottomDirty}
              onNormalizationSaved={handleNormalizationSaved}
              onNormalizationApplied={handleNormalizationApplied}
              normalizeAutoExpandKey={normalizeAutoExpandKey}
              onNormalizeExpandedChange={handleNormalizeExpandedChange}
              onFileViewResize={handleFileViewResize}
            />
          </div>
          <div
            className="pairing-workspace-resize-handle"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize bottom editor area"
            onPointerDown={(event) => startVerticalResize(event, 'bottom')}
          />
        </div>
      )}

      {/* Learn Dialog */}
      <LearnDialog
        open={showLearnDialog}
        projectId={project.id}
        hasLearnablePairs={hasLearnablePairs}
        manualPairCount={manualPairCount}
        acceptedPairCount={acceptedPairCount}
        onClose={() => setShowLearnDialog(false)}
      />

      {/* Unsaved changes confirmation dialog */}
      <ConfirmDialog
        open={confirmUnsavedOpen}
        title="Unsaved changes"
        message="You have unsaved changes in the editor. Discard them and continue?"
        confirmLabel="Discard changes"
        confirmClass="btn btn-danger"
        onConfirm={() => {
          setConfirmUnsavedOpen(false);
          const action = pendingActionRef.current;
          pendingActionRef.current = null;
          action?.();
        }}
        onCancel={() => {
          setConfirmUnsavedOpen(false);
          pendingActionRef.current = null;
        }}
      />
    </div>
  );
}
