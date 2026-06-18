import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { PairingProjectPair, SuggestFilterScope } from '../../api/types';
import { api, ApiError, useToast } from '../../App';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { PairSlotCard } from './PairSlotCard';
import { getDragFilePayload, type DragFilePayload } from '../../domain/dragPayload';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface PairsPanelProps {
  projectId: string;
  pairs: PairingProjectPair[];
  loading: boolean;
  pairsError: string | null;
  onPairsChange: () => void;
  selectedPairId: string | null;
  onSelectPair: (pairId: string) => void;
  onOpenFileView: (pairId: string) => void;
  onOpenNormalize?: (pairId: string) => void;
  onPairDeleted?: (pairId: string) => void;
  onRevealFile?: (relativePath: string) => void;
  onUpdatePairSlot?: (
    pairId: string,
    slot: 'source' | 'translated',
    fileId: string | null,
    sourcePairId?: string | null,
    sourceSlot?: string | null,
  ) => void;
  onDropFileOnBoard?: (payload: DragFilePayload) => void;
  getFilterScope?: () => SuggestFilterScope;
  onClearAll?: () => Promise<void>;
  onDeletePair?: (pairId: string) => Promise<void>;
  lineMatchStats?: Record<string, { percent: number } | null> | null;
  lineMatchLoading?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'suggested', label: 'Suggested' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'manual', label: 'Manual' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'ignored', label: 'Ignored' },
] as const;

const SORT_OPTIONS = [
  { value: 'confidence', label: 'Pair confidence' },
  { value: 'sameLines', label: 'Same lines' },
  { value: 'status', label: 'Status' },
  { value: 'sourceFile', label: 'Source filename' },
  { value: 'translatedFile', label: 'Translated filename' },
  { value: 'sourceLang', label: 'Source language' },
  { value: 'targetLang', label: 'Target language' },
  { value: 'reason', label: 'Reason' },
] as const;

type SortBy = (typeof SORT_OPTIONS)[number]['value'];
type SortDir = 'asc' | 'desc';

/* ------------------------------------------------------------------ */
/*  Helpers (outside component to avoid re-creation)                   */
/* ------------------------------------------------------------------ */

function sourceFileName(p: PairingProjectPair): string {
  return p.source_file?.file_name ?? p.source_file_id ?? '';
}

function translatedFileName(p: PairingProjectPair): string {
  return p.translated_file?.file_name ?? p.translated_file_id ?? '';
}

function sourceLang(p: PairingProjectPair): string {
  return p.source_file?.detected_language ?? '';
}

function targetLang(p: PairingProjectPair): string {
  return p.translated_file?.detected_language ?? '';
}

function sameLinesPercent(
  p: PairingProjectPair,
  stats: PairsPanelProps['lineMatchStats'],
): number {
  if (!stats) return -1;
  const entry = stats[p.id];
  return entry?.percent ?? -1;
}

/**
 * Deterministic tie-break so sort is stable even when primary key values
 * are equal: source filename -> translated filename -> id.
 */
const TIE_BREAK = (a: PairingProjectPair, b: PairingProjectPair): number => {
  const sf = sourceFileName(a).localeCompare(sourceFileName(b));
  if (sf !== 0) return sf;
  const tf = translatedFileName(a).localeCompare(translatedFileName(b));
  if (tf !== 0) return tf;
  return a.id.localeCompare(b.id);
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PairsPanel({
  projectId,
  pairs,
  loading,
  pairsError,
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
  lineMatchStats,
  lineMatchLoading,
}: PairsPanelProps) {
  const { showToast } = useToast();

  /* ---- mounted ref guard ---- */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /* ---- local state ---- */
  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterMinConfidence, setFilterMinConfidence] = useState('');
  const [filterMaxConfidence, setFilterMaxConfidence] = useState('');
  const [filterMinSameLines, setFilterMinSameLines] = useState('');
  const [filterMaxSameLines, setFilterMaxSameLines] = useState('');
  const [filterSourceLang, setFilterSourceLang] = useState('');
  const [filterTargetLang, setFilterTargetLang] = useState('');
  const [filterReasonContains, setFilterReasonContains] = useState('');
  const [filterFilenameContains, setFilterFilenameContains] = useState('');

  // Sort
  const [sortBy, setSortBy] = useState<SortBy>('confidence');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Collapsed sections
  const [sortOpen, setSortOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Actions
  const [suggesting, setSuggesting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PairingProjectPair | null>(null);
  const [clearAllConfirm, setClearAllConfirm] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isBoardDragOver, setIsBoardDragOver] = useState(false);

  // Bulk actions
  const [bulkConfirm, setBulkConfirm] = useState<{
    action: 'accept' | 'reject' | 'delete';
    pairIds: string[];
    preview: PairingProjectPair[];
  } | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  /* ---- active filter count (for badge — excludes status) ---- */
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterMinConfidence !== '') n++;
    if (filterMaxConfidence !== '') n++;
    if (filterMinSameLines !== '') n++;
    if (filterMaxSameLines !== '') n++;
    if (filterSourceLang !== '') n++;
    if (filterTargetLang !== '') n++;
    if (filterReasonContains !== '') n++;
    if (filterFilenameContains !== '') n++;
    return n;
  }, [
    filterMinConfidence, filterMaxConfidence,
    filterMinSameLines, filterMaxSameLines,
    filterSourceLang, filterTargetLang,
    filterReasonContains, filterFilenameContains,
  ]);

  /* ---- available languages from current pairs ---- */
  const availableSourceLangs = useMemo(
    () => [...new Set(pairs.map(sourceLang).filter(Boolean))].sort(),
    [pairs],
  );
  const availableTargetLangs = useMemo(
    () => [...new Set(pairs.map(targetLang).filter(Boolean))].sort(),
    [pairs],
  );

  /* ---- derived: filtered + sorted pairs ---- */
  const filteredPairs = useMemo(() => {
    let result = pairs;

    // --- Filters ---
    if (filterStatus !== '') {
      result = result.filter((p) => p.status === filterStatus);
    }

    const minConf = parseFloat(filterMinConfidence);
    if (!isNaN(minConf)) {
      result = result.filter((p) => p.confidence >= minConf / 100);
    }
    const maxConf = parseFloat(filterMaxConfidence);
    if (!isNaN(maxConf)) {
      result = result.filter((p) => p.confidence <= maxConf / 100);
    }

    const minSL = parseFloat(filterMinSameLines);
    if (!isNaN(minSL)) {
      result = result.filter((p) => sameLinesPercent(p, lineMatchStats) >= minSL);
    }
    const maxSL = parseFloat(filterMaxSameLines);
    if (!isNaN(maxSL)) {
      result = result.filter((p) => {
        const pct = sameLinesPercent(p, lineMatchStats);
        return pct >= 0 && pct <= maxSL;
      });
    }

    if (filterSourceLang !== '') {
      result = result.filter((p) => sourceLang(p) === filterSourceLang);
    }
    if (filterTargetLang !== '') {
      result = result.filter((p) => targetLang(p) === filterTargetLang);
    }

    if (filterReasonContains !== '') {
      const term = filterReasonContains.toLowerCase();
      result = result.filter(
        (p) => p.reason?.toLowerCase().includes(term),
      );
    }

    if (filterFilenameContains !== '') {
      const term = filterFilenameContains.toLowerCase();
      result = result.filter(
        (p) =>
          sourceFileName(p).toLowerCase().includes(term) ||
          translatedFileName(p).toLowerCase().includes(term),
      );
    }

    // --- Sort ---
    const dirMul = sortDir === 'asc' ? 1 : -1;
    result = [...result].sort((a, b) => {
      let cmp: number = 0;
      switch (sortBy) {
        case 'confidence':
          cmp = a.confidence - b.confidence;
          break;
        case 'sameLines':
          cmp = sameLinesPercent(a, lineMatchStats) - sameLinesPercent(b, lineMatchStats);
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'sourceFile':
          cmp = sourceFileName(a).localeCompare(sourceFileName(b));
          break;
        case 'translatedFile':
          cmp = translatedFileName(a).localeCompare(translatedFileName(b));
          break;
        case 'sourceLang':
          cmp = sourceLang(a).localeCompare(sourceLang(b));
          break;
        case 'targetLang':
          cmp = targetLang(a).localeCompare(targetLang(b));
          break;
        case 'reason':
          cmp = (a.reason ?? '').localeCompare(b.reason ?? '');
          break;
      }
      cmp *= dirMul;
      if (cmp === 0) return TIE_BREAK(a, b);
      return cmp;
    });

    return result;
  }, [
    pairs, lineMatchStats,
    filterStatus, filterMinConfidence, filterMaxConfidence,
    filterMinSameLines, filterMaxSameLines,
    filterSourceLang, filterTargetLang,
    filterReasonContains, filterFilenameContains,
    sortBy, sortDir,
  ]);

  /* ---- Bulk: compute which pairs are eligible ---- */
  const { bulkEligibleIds, bulkSkippedCount } = useMemo(() => {
    if (bulkConfirm) {
      const action = bulkConfirm.action;
      if (action === 'delete') {
        // All visible pairs can be deleted
        return {
          bulkEligibleIds: filteredPairs.map((p) => p.id),
          bulkSkippedCount: 0,
        };
      }
      // Accept/reject: only suggested/manual
      const eligible = filteredPairs.filter(
        (p) => p.status === 'suggested' || p.status === 'manual',
      );
      return {
        bulkEligibleIds: eligible.map((p) => p.id),
        bulkSkippedCount: filteredPairs.length - eligible.length,
      };
    }
    return { bulkEligibleIds: [], bulkSkippedCount: 0 };
  }, [filteredPairs, bulkConfirm]);

  const isEmpty = !loading && !pairsError && filteredPairs.length === 0;

  /* ---- helpers ---- */

  const updatePairStatus = async (
    pair: PairingProjectPair,
    newStatus: string,
  ) => {
    if (actionLoading) return;
    setActionLoading(pair.id);
    try {
      await api.updatePairingPair(projectId, pair.id, { status: newStatus });
      if (mountedRef.current) {
        showToast(`Pair ${newStatus}`, 'success');
        onPairsChange();
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to update pair';
      showToast(message, 'error');
    } finally {
      if (mountedRef.current) setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || actionLoading) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setActionLoading(target.id);
    try {
      if (onDeletePair) {
        await onDeletePair(target.id);
      } else {
        await api.deletePairingPair(projectId, target.id);
      }
      if (mountedRef.current) {
        showToast('Pair deleted', 'success');
        onPairDeleted?.(target.id);
        onPairsChange();
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to delete pair';
      showToast(message, 'error');
    } finally {
      if (mountedRef.current) setActionLoading(null);
    }
  };

  const handleSuggest = async () => {
    if (suggesting) return;
    setSuggesting(true);
    try {
      const scope = getFilterScope?.() ?? {};
      const hasFilters = scope.include_filter || scope.exclude_filter
        || (scope.extensions && scope.extensions.length > 0);
      const body = hasFilters
        ? { scope: 'filtered' as const, filters: scope }
        : undefined;
      await api.suggestPairingPairs(projectId, body);
      if (mountedRef.current) {
        showToast('Pair suggestions generated', 'success');
        onPairsChange();
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to suggest pairs';
      showToast(message, 'error');
    } finally {
      if (mountedRef.current) setSuggesting(false);
    }
  };

  const handleClearAll = async () => {
    if (!onClearAll) return;
    setClearAllConfirm(false);
    try {
      await onClearAll();
    } catch (err: unknown) {
      // Error handling is done by the parent
    }
  };

  /* ---- Bulk action handlers ---- */

  const openBulkConfirm = (action: 'accept' | 'reject' | 'delete') => {
    setBulkConfirm({
      action,
      pairIds: filteredPairs.map((p) => p.id),
      preview: filteredPairs.slice(0, 5),
    });
  };

  const handleBulkConfirm = async () => {
    if (!bulkConfirm || bulkRunning) return;
    setBulkRunning(true);
    const { action } = bulkConfirm;

    try {
      if (action === 'delete') {
        const resp = await api.bulkDeletePairs(projectId, {
          pair_ids: bulkEligibleIds,
        });
        showToast(
          `Deleted ${resp.deleted_count} pairs`,
          'success',
        );
      } else if (action === 'accept') {
        const resp = await api.bulkAcceptPairs(projectId, {
          pair_ids: bulkEligibleIds,
        });
        showToast(
          `Accepted ${resp.updated} pairs${resp.skipped > 0 ? ` (${resp.skipped} skipped)` : ''}`,
          'success',
        );
      } else if (action === 'reject') {
        const resp = await api.bulkRejectPairs(projectId, {
          pair_ids: bulkEligibleIds,
        });
        showToast(
          `Rejected ${resp.updated} pairs${resp.skipped > 0 ? ` (${resp.skipped} skipped)` : ''}`,
          'success',
        );
      }
      if (mountedRef.current) {
        onPairsChange();
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Bulk action failed';
      showToast(message, 'error');
    } finally {
      if (mountedRef.current) {
        setBulkRunning(false);
        setBulkConfirm(null);
      }
    }
  };

  /* ---- Board drag-over handlers (empty-space drop) ---- */

  const canBoardDrop = !!onDropFileOnBoard;

  const handleBoardDragOver = useCallback((e: React.DragEvent) => {
    if (!canBoardDrop) return;
    const payload = getDragFilePayload(e.dataTransfer);
    if (!payload || payload.sourcePairId) return;
    e.preventDefault();
    e.stopPropagation();
    setIsBoardDragOver(true);
  }, [canBoardDrop]);

  const handleBoardDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setIsBoardDragOver(false);
  }, []);

  const handleBoardDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsBoardDragOver(false);
    const payload = getDragFilePayload(e.dataTransfer);
    if (payload && !payload.sourcePairId) {
      onDropFileOnBoard?.(payload);
    }
  }, [onDropFileOnBoard]);

  /* ---- render ---- */

  const bulkActionLabel = bulkConfirm
    ? bulkConfirm.action === 'accept'
      ? 'Accept visible'
      : bulkConfirm.action === 'reject'
        ? 'Reject visible'
        : 'Delete visible'
    : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' }}>
      {/* ---- Top controls ---- */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '0.5rem',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        {/* Status filter */}
        <select
          className="form-control"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          aria-label="Filter by status"
          style={{ minWidth: 130, width: 'auto' }}
        >
          {STATUS_FILTERS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Toggle sort section */}
        <button
          className={`btn btn-sm ${sortOpen ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => { setSortOpen(!sortOpen); setFiltersOpen(false); }}
          title="Sort pairs"
        >
          Sort {sortBy !== 'confidence' || sortDir !== 'desc' ? ' (active)' : ''}
        </button>

        {/* Toggle filters section */}
        <button
          className={`btn btn-sm ${filtersOpen ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => { setFiltersOpen(!filtersOpen); setSortOpen(false); }}
          title="Filter pairs"
        >
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>

        {/* Action buttons */}
        <button
          className="btn btn-sm btn-primary"
          onClick={handleSuggest}
          disabled={suggesting}
        >
          {suggesting ? 'Suggesting...' : 'Suggest Pairs'}
        </button>

        <button
          className="btn btn-sm btn-outline"
          onClick={onPairsChange}
        >
          Refresh
        </button>

        {pairs.length > 0 && onClearAll && (
          <button
            className="btn btn-sm btn-danger"
            onClick={() => setClearAllConfirm(true)}
            title="Delete all pairs in this project"
            style={{ marginLeft: 'auto' }}
          >
            Clear All
          </button>
        )}
      </div>

      {/* ---- Sort panel (collapsible) ---- */}
      {sortOpen && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '0.5rem',
            padding: '0.5rem',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            flexShrink: 0,
            flexWrap: 'wrap',
            fontSize: '0.85rem',
          }}
        >
          <label style={{ fontWeight: 600 }}>Sort by:</label>
          <select
            className="form-control"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            aria-label="Sort by"
            style={{ width: 'auto', minWidth: 140 }}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            className="form-control"
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value as SortDir)}
            aria-label="Sort direction"
            style={{ width: 'auto', minWidth: 80 }}
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
      )}

      {/* ---- Filters panel (collapsible) ---- */}
      {filtersOpen && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '0.4rem 0.75rem',
            marginBottom: '0.5rem',
            padding: '0.5rem',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            flexShrink: 0,
            fontSize: '0.85rem',
          }}
        >
          {/* Confidence range */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 2 }}>
              Min confidence %
            </label>
            <input
              className="form-control"
              type="number"
              min="0"
              max="100"
              step="1"
              placeholder="0"
              value={filterMinConfidence}
              onChange={(e) => setFilterMinConfidence(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 2 }}>
              Max confidence %
            </label>
            <input
              className="form-control"
              type="number"
              min="0"
              max="100"
              step="1"
              placeholder="100"
              value={filterMaxConfidence}
              onChange={(e) => setFilterMaxConfidence(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          {/* Same lines range */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 2 }}>
              Min same lines %
            </label>
            <input
              className="form-control"
              type="number"
              min="0"
              max="100"
              step="1"
              placeholder="0"
              value={filterMinSameLines}
              onChange={(e) => setFilterMinSameLines(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 2 }}>
              Max same lines %
            </label>
            <input
              className="form-control"
              type="number"
              min="0"
              max="100"
              step="1"
              placeholder="100"
              value={filterMaxSameLines}
              onChange={(e) => setFilterMaxSameLines(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          {/* Source language */}
          {availableSourceLangs.length > 0 && (
            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 2 }}>
                Source language
              </label>
              <select
                className="form-control"
                value={filterSourceLang}
                onChange={(e) => setFilterSourceLang(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">All</option>
                {availableSourceLangs.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
          )}

          {/* Target language */}
          {availableTargetLangs.length > 0 && (
            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 2 }}>
                Target language
              </label>
              <select
                className="form-control"
                value={filterTargetLang}
                onChange={(e) => setFilterTargetLang(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">All</option>
                {availableTargetLangs.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
          )}

          {/* Reason contains */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 2 }}>
              Reason contains
            </label>
            <input
              className="form-control"
              type="text"
              placeholder="Search reasons..."
              value={filterReasonContains}
              onChange={(e) => setFilterReasonContains(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          {/* Filename contains */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 2 }}>
              Filename contains
            </label>
            <input
              className="form-control"
              type="text"
              placeholder="Search filenames..."
              value={filterFilenameContains}
              onChange={(e) => setFilterFilenameContains(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          {/* Reset filters */}
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => {
                setFilterMinConfidence('');
                setFilterMaxConfidence('');
                setFilterMinSameLines('');
                setFilterMaxSameLines('');
                setFilterSourceLang('');
                setFilterTargetLang('');
                setFilterReasonContains('');
                setFilterFilenameContains('');
              }}
              disabled={activeFilterCount === 0}
            >
              Reset filters
            </button>
          </div>
        </div>
      )}

      {/* ---- Bulk action bar ---- */}
      {filteredPairs.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '0.5rem',
            padding: '0.4rem 0.6rem',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            flexShrink: 0,
            fontSize: '0.85rem',
          }}
        >
          <span style={{ fontWeight: 600, marginRight: '0.5rem' }}>
            {filteredPairs.length} visible pairs
          </span>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => openBulkConfirm('accept')}
            disabled={bulkRunning}
          >
            Accept visible
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => openBulkConfirm('reject')}
            disabled={bulkRunning}
          >
            Reject visible
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => openBulkConfirm('delete')}
            disabled={bulkRunning}
            title="Delete visible pairs"
          >
            Delete visible
          </button>
        </div>
      )}

      {/* ---- Loading state ---- */}
      {loading && <div className="empty-state">Loading pairs...</div>}

      {/* ---- Error state ---- */}
      {!loading && pairsError && (
        <div className="alert alert-error">{pairsError}</div>
      )}

      {/* ---- Scrollable pair slot cards ---- */}
      {!loading && !pairsError && (
        <div
          className={`pw-pair-list-viewport${isBoardDragOver ? ' pw-pair-list-viewport--drag-over' : ''}`}
          style={{ overflow: 'auto', flex: '1 1 auto', minHeight: 0 }}
          onDragOver={canBoardDrop ? handleBoardDragOver : undefined}
          onDragLeave={canBoardDrop ? handleBoardDragLeave : undefined}
          onDrop={canBoardDrop ? handleBoardDrop : undefined}
        >
          {filteredPairs.length > 0 ? (
            filteredPairs.map((pair) => (
              <div key={pair.id} style={{ marginBottom: '0.75rem' }}>
                <PairSlotCard
                  pair={pair}
                  isSelected={pair.id === selectedPairId}
                  actionLoading={actionLoading === pair.id}
                  onSelect={() => onSelectPair(pair.id)}
                  onAccept={
                    pair.status === 'suggested' ||
                    pair.status === 'ignored' ||
                    pair.status === 'rejected'
                      ? () => updatePairStatus(pair, 'accepted')
                      : undefined
                  }
                  onReject={
                    pair.status === 'suggested' ||
                    pair.status === 'accepted' ||
                    pair.status === 'ignored' ||
                    pair.status === 'manual'
                      ? () => updatePairStatus(pair, 'rejected')
                      : undefined
                  }
                  onDelete={() => setDeleteTarget(pair)}
                  onFileView={() => onOpenFileView(pair.id)}
                  onOpenNormalize={
                    onOpenNormalize
                      ? () => onOpenNormalize(pair.id)
                      : undefined
                  }
                  onRevealFile={onRevealFile}
                  onUpdateSlot={onUpdatePairSlot}
                  exactLineMatchPercent={lineMatchStats?.[pair.id]?.percent ?? null}
                  exactLineMatchLoading={!!lineMatchLoading}
                />
              </div>
            ))
          ) : (
            <div className="empty-state" style={{ pointerEvents: 'none', userSelect: 'none' }}>
              {activeFilterCount === 0 && filterStatus === ''
                ? 'No pairs yet — drop a file here to create a pair'
                : 'No pairs matching filters'}
            </div>
          )}
        </div>
      )}

      {/* ---- Confirm delete dialog ---- */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete pair"
        message={`Are you sure you want to delete the pair${
          deleteTarget
            ? ` between "${
                deleteTarget.source_file?.file_name ??
                deleteTarget.source_file_id ??
                'no source'
              }" and "${
                deleteTarget.translated_file?.file_name ??
                deleteTarget.translated_file_id ??
                'no translated'
              }"`
            : ''
        }?`}
        confirmLabel="Delete"
        confirmClass="btn btn-danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* ---- Confirm Clear All dialog ---- */}
      <ConfirmDialog
        open={clearAllConfirm}
        title="Clear all pairs?"
        message={`This will delete ${pairs.length} pairs from this project. This action cannot be undone.`}
        confirmLabel="Delete all pairs"
        confirmClass="btn btn-danger"
        onConfirm={handleClearAll}
        onCancel={() => setClearAllConfirm(false)}
      />

      {/* ---- Bulk action confirmation modal ---- */}
      {bulkConfirm && (
        <ConfirmDialog
          open={true}
          title={`${bulkActionLabel}?`}
          message={
            <div style={{ fontSize: '0.9rem' }}>
              <p>
                <strong>{bulkConfirm.action === 'accept' ? 'Accept' : bulkConfirm.action === 'reject' ? 'Reject' : 'Delete'}</strong>{' '}
                <strong>{bulkEligibleIds.length}</strong> visible pairs
                {bulkConfirm.action !== 'delete' && bulkSkippedCount > 0 && (
                  <span style={{ color: 'var(--color-warning)' }}> ({bulkSkippedCount} skipped — already accepted/rejected)</span>
                )}
                {bulkConfirm.action !== 'delete' && (
                  <span> (only suggested/manual pairs will be updated)</span>
                )}
              </p>
              {activeFilterCount > 0 && (
                <p>
                  <strong>Active filters:</strong>{' '}
                  {filterStatus && `Status: ${filterStatus} · `}
                  {filterMinConfidence && `Min confidence: ${filterMinConfidence}% · `}
                  {filterMaxConfidence && `Max confidence: ${filterMaxConfidence}% · `}
                  {filterMinSameLines && `Min same lines: ${filterMinSameLines}% · `}
                  {filterMaxSameLines && `Max same lines: ${filterMaxSameLines}% · `}
                  {filterSourceLang && `Source language: ${filterSourceLang} · `}
                  {filterTargetLang && `Target language: ${filterTargetLang} · `}
                  {filterReasonContains && `Reason: "${filterReasonContains}" · `}
                  {filterFilenameContains && `Filename: "${filterFilenameContains}" · `}
                </p>
              )}
              {bulkConfirm.preview.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <strong>First {bulkConfirm.preview.length} affected:</strong>
                  <ul style={{ margin: '0.25rem 0', paddingLeft: '1.2rem' }}>
                    {bulkConfirm.preview.map((p) => (
                      <li key={p.id}>
                        {p.status === 'suggested' || p.status === 'manual' ? (
                          <span style={{ color: 'var(--color-primary)' }}>[{p.status}]</span>
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)' }}>[{p.status} — skipped]</span>
                        )}{' '}
                        {sourceFileName(p) || '—'} ↔ {translatedFileName(p) || '—'}{' '}
                        ({Math.round(p.confidence * 100)}%)
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          }
          confirmLabel={bulkConfirm.action === 'delete' ? 'Delete all' : bulkConfirm.action === 'accept' ? 'Accept all' : 'Reject all'}
          confirmClass="btn btn-danger"
          onConfirm={handleBulkConfirm}
          onCancel={() => setBulkConfirm(null)}
        />
      )}
    </div>
  );
}
