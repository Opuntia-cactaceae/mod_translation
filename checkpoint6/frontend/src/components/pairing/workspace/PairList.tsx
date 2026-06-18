/* ------------------------------------------------------------------ */
/*  PairList — Workspace-aware wrapper around PairsPanel               */
/*                                                                      */
/*  Accepts domain model types and converts to API types                */
/*  for delegation to the existing PairsPanel component.                */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../App';
import { PairsPanel } from '../PairsPanel';
import BulkCleanup from '../BulkCleanup';
import type { WorkspacePair, WorkspaceFile } from '../../../domain/pairingTypes';
import type { PairingProjectFile } from '../../../api/types';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

/** pair_id -> { percent } for line match stats. */
type LineMatchStatsMap = Record<string, { percent: number }>;

/* ------------------------------------------------------------------ */
/*  Module-level cache (survives unmount/remount)                       */
/* ------------------------------------------------------------------ */

const lineMatchStatsCache: Record<string, LineMatchStatsMap> = {};

/**
 * Reset the module-level cache for a specific projectId, or all if omitted.
 * Exported only for testing; do not use in production code.
 */
export function __resetLineMatchCache(projectId?: string): void {
  if (projectId) {
    delete lineMatchStatsCache[projectId];
  } else {
    Object.keys(lineMatchStatsCache).forEach((k) => delete lineMatchStatsCache[k]);
  }
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface PairListProps {
  projectId: string;
  pairs: WorkspacePair[];
  loading: boolean;
  error: string | null;
  onPairsChange: () => void;
  selectedPairId: string | null;
  onSelectPair: (pairId: string) => void;
  onOpenFileView: (pairId: string) => void;
  onOpenNormalize?: (pairId: string) => void;
  onPairDeleted?: (pairId: string) => void;
  onRevealFile?: (relativePath: string) => void;
  /** Called when a pair slot file is updated via DnD drop or clear button. */
  onUpdatePairSlot?: (
    pairId: string,
    slot: 'source' | 'translated',
    fileId: string | null,
    sourcePairId?: string | null,
    sourceSlot?: string | null,
  ) => void;
  /** Called when a file is dropped onto empty pair-board space. */
  onDropFileOnBoard?: (payload: import('../../../domain/dragPayload').DragFilePayload) => void;
  /**
   * Getter for current FILES filter scope (for scoped Suggest Pairs).
   * Called at click time so the value is always live.
   */
  getFilterScope?: () => import('../../../api/types').SuggestFilterScope;
  /** Called when user confirms Clear All. */
  onClearAll?: () => Promise<void>;
  /** Called when a single pair is deleted (wraps deletePair with dirty guard). */
  onDeletePair?: (pairId: string) => Promise<void>;
  /**
   * Increment to trigger a re-fetch of exact line match stats
   * (e.g. after normalization settings are saved).
   */
  lineMatchRefreshKey?: number;
  /** When true, bulk delete actions show a confirmation dialog. */
  dirty?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helper: convert WorkspacePair to PairingProjectPair shape          */
/* ------------------------------------------------------------------ */

interface RawPair {
  id: string;
  project_id: string;
  source_file_id: string | null;
  translated_file_id: string | null;
  source_file: PairingProjectFile | null;
  translated_file: PairingProjectFile | null;
  status: string;
  confidence: number;
  reason: string | null;
  created_by: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toRawFile(f: WorkspaceFile): PairingProjectFile {
  return {
    id: f.id,
    project_id: f.projectId,
    relative_path: f.relativePath,
    file_name: f.fileName,
    extension: f.extension,
    parent_dir: f.parentDir,
    size_bytes: f.sizeBytes,
    content_hash: null,
    modified_at: null,
    detected_language: f.detectedLanguage,
    detected_role: f.detectedRole,
    group_key: null,
    is_ignored: f.isIgnored,
    created_at: '',
    updated_at: '',
  };
}

function toRawPair(p: WorkspacePair): RawPair {
  return {
    id: p.id,
    project_id: p.projectId,
    source_file_id: p.sourceFileId,
    translated_file_id: p.translatedFileId,
    source_file: p.sourceFile ? toRawFile(p.sourceFile) : null,
    translated_file: p.translatedFile ? toRawFile(p.translatedFile) : null,
    status: p.status,
    confidence: p.confidence,
    reason: p.reason,
    created_by: p.createdBy,
    notes: p.notes,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PairList({
  projectId,
  pairs,
  loading,
  error,
  onPairsChange,
  selectedPairId,
  onSelectPair,
  onOpenFileView,
  onOpenNormalize,
  onPairDeleted,
  onRevealFile,
  onUpdatePairSlot,
  onDropFileOnBoard,
  getFilterScope,
  onClearAll,
  onDeletePair,
  lineMatchRefreshKey,
  dirty,
}: PairListProps) {
  /* ---- Exact line match stats with cache + stale guard ---- */
  const [lineMatchStats, setLineMatchStats] = useState<LineMatchStatsMap | null>(null);
  const [lineMatchLoading, setLineMatchLoading] = useState(false);

  /** Monotonic sequence counter for stale-response guard. */
  const lineMatchReqSeqRef = useRef(0);
  /** Tracks mount status to avoid state updates after unmount. */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /** Stable callback to fetch exact line match stats for the current project.
   *  Does NOT set loading state — caller should set it when appropriate
   *  (e.g. useEffect for initial mount, but NOT handlePairsChange to
   *   avoid disrupting the current render cycle in tests). */
  const fetchLineMatchStats = useCallback((pid: string) => {
    lineMatchReqSeqRef.current += 1;
    const reqSeq = lineMatchReqSeqRef.current;

    api.exactLineMatchPreview(pid, { threshold_percent: 0 })
      .then((resp) => {
        if (!mountedRef.current || reqSeq !== lineMatchReqSeqRef.current) return; // stale
        const map: LineMatchStatsMap = {};
        for (const m of resp.matches) {
          map[m.pair_id] = { percent: m.exact_line_match_percent };
        }
        lineMatchStatsCache[pid] = map;
        setLineMatchStats(map);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current || reqSeq !== lineMatchReqSeqRef.current) return; // stale
        console.warn('exactLineMatchPreview failed:', err);
        setLineMatchStats({});
      })
      .finally(() => {
        if (!mountedRef.current || reqSeq !== lineMatchReqSeqRef.current) return; // stale
        setLineMatchLoading(false);
      });
  }, []);

  /**
   * Wraps onPairsChange to also invalidate the line-match cache
   * and trigger a refetch. Refetch is deferred (setTimeout 0) so it
   * does not interfere with the current React render cycle — important
   * for test environments where act() flushes pending microtasks.
   */
  const handlePairsChange = useCallback(() => {
    delete lineMatchStatsCache[projectId];
    onPairsChange();
    setTimeout(() => fetchLineMatchStats(projectId), 0);
  }, [projectId, onPairsChange, fetchLineMatchStats]);

  useEffect(() => {
    if (!projectId) return;

    const cached = lineMatchStatsCache[projectId];
    if (cached) {
      setLineMatchStats(cached);
      setLineMatchLoading(false);
      return;
    }

    // Set loading for initial mount (handlePairsChange skips this to avoid
    // disrupting the render cycle — the API response will update stats).
    if (mountedRef.current) {
      setLineMatchStats(null);
      setLineMatchLoading(true);
    }
    fetchLineMatchStats(projectId);
  }, [projectId, fetchLineMatchStats]);

  /* Re-fetch line match stats when lineMatchRefreshKey changes
     (e.g. after normalization settings are saved). */
  useEffect(() => {
    if (lineMatchRefreshKey === undefined || lineMatchRefreshKey < 1) return;
    delete lineMatchStatsCache[projectId];
    fetchLineMatchStats(projectId);
  }, [lineMatchRefreshKey, projectId, fetchLineMatchStats]);

  return (
    <>
      <PairsPanel
        projectId={projectId}
        pairs={pairs.map(toRawPair) as any}
        loading={loading}
        pairsError={error}
        onPairsChange={handlePairsChange}
        selectedPairId={selectedPairId}
        onSelectPair={onSelectPair}
        onOpenFileView={onOpenFileView}
        onOpenNormalize={onOpenNormalize}
        onPairDeleted={onPairDeleted}
        onRevealFile={onRevealFile}
        onUpdatePairSlot={onUpdatePairSlot}
        onDropFileOnBoard={onDropFileOnBoard}
        getFilterScope={getFilterScope}
        onClearAll={onClearAll}
        onDeletePair={onDeletePair}
        lineMatchStats={lineMatchStats}
        lineMatchLoading={lineMatchLoading}
      />
      <BulkCleanup projectId={projectId} onDeleted={handlePairsChange} dirty={dirty} />
    </>
  );
}
