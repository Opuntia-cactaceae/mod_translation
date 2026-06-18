/* ------------------------------------------------------------------ */
/*  PairSlotCard — slot-style pair card for the Pairing Workspace       */
/*                                                                      */
/*  Header: status badge · confidence · reason    [Open align] [Del]   */
/*  Body:  ┌───────────┬──────────────┐                                */
/*         │ SOURCE    │ TRANSLATED   │                                */
/*         │ file_name │ file_name    │                                */
/*         │ path      │ path         │                                */
/*         │ meta      │ meta         │                                */
/*         └───────────┴──────────────┘                                */
/* ------------------------------------------------------------------ */

import type { PairingProjectPair } from '../../api/types';
import { PairFileSlot } from './PairFileSlot';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface PairSlotCardProps {
  pair: PairingProjectPair;
  isSelected: boolean;
  actionLoading: boolean;
  onSelect: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onDelete: () => void;
  onFileView: () => void;
  onOpenNormalize?: () => void;
  /** Optional handler when a file slot is clicked (e.g. reveal in tree). */
  onRevealFile?: (relativePath: string) => void;
  /**
   * Called when a file is dropped onto a slot or the clear button is clicked.
   * slot: 'source' | 'translated'
   * fileId: string to assign, or null to clear.
   * sourcePairId/sourceSlot: set when dragging from another slot (for move/swap).
   */
  onUpdateSlot?: (
    pairId: string,
    slot: 'source' | 'translated',
    fileId: string | null,
    sourcePairId?: string | null,
    sourceSlot?: 'source' | 'translated' | null,
  ) => void;
  /** Exact line match percentage (null = not computed yet). */
  exactLineMatchPercent?: number | null;
  /** True while exact line match stats are being loaded. */
  exactLineMatchLoading?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const STATUS_LABELS: Record<string, string> = {
  suggested: 'Suggested',
  accepted: 'Accepted',
  rejected: 'Rejected',
  manual: 'Manual',
  ignored: 'Ignored',
};

const STATUS_BADGE: Record<string, string> = {
  suggested: 'badge badge-info',
  accepted: 'badge badge-success',
  rejected: 'badge badge-error',
  manual: 'badge badge-warning',
  ignored: 'badge',
};

function statusLabel(s: string): string {
  return STATUS_LABELS[s] || s.charAt(0).toUpperCase() + s.slice(1);
}

function badgeClass(s: string): string {
  return STATUS_BADGE[s] || 'badge';
}

/** CSS class for the exact-line-match badge based on severity. */
function lineMatchBadgeClass(percent: number): string {
  if (percent >= 70) return 'badge badge-error';
  if (percent >= 20) return 'badge badge-warning';
  return 'badge';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PairSlotCard({
  pair,
  isSelected,
  actionLoading,
  onSelect,
  onAccept,
  onReject,
  onDelete,
  onFileView,
  onOpenNormalize,
  onRevealFile,
  onUpdateSlot,
  exactLineMatchPercent,
  exactLineMatchLoading,
}: PairSlotCardProps) {
  return (
    <div
      className={`pair-slot-card ${isSelected ? 'pair-slot-card--selected' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(); }}
    >
      {/* ---- Header ---- */}
      <div className="pair-slot-card__header">
        <div className="pair-slot-card__status-group">
          <span className={badgeClass(pair.status)}>
            {statusLabel(pair.status)}
          </span>
          <span
            className="badge"
            title={`Pair confidence: ${Math.round(pair.confidence * 100)}% — score from pairing heuristic`}
            style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
          >
            Pair confidence: {Math.round(pair.confidence * 100)}%
          </span>
          {exactLineMatchPercent !== undefined && exactLineMatchPercent !== null ? (
            <span
              className={lineMatchBadgeClass(exactLineMatchPercent)}
              title={`Exact line match: ${exactLineMatchPercent.toFixed(1)}%`}
            >
              Same lines: {Math.round(exactLineMatchPercent)}%
            </span>
          ) : (
            <span
              className="badge"
              style={{ opacity: 0.55, fontStyle: 'italic' }}
              title="Exact line match not available"
            >
              Same lines: {exactLineMatchLoading ? '…' : '—'}
            </span>
          )}
          {pair.reason && (
            <span className="pair-slot-card__reason" title={pair.reason}>
              {pair.reason}
            </span>
          )}
        </div>
        <div
          className="pair-slot-card__actions"
          onClick={(e) => e.stopPropagation()}
        >
          {onOpenNormalize && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={onOpenNormalize}
              disabled={actionLoading}
              title="Open normalize editor"
            >
              Open Normalize
            </button>
          )}
          {onDelete && (
            <button
              className="btn btn-sm btn-danger"
              onClick={onDelete}
              disabled={actionLoading}
              title="Delete pair"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* ---- File slots ---- */}
      <div className="pair-slot-card__slots">
        <PairFileSlot
          label="SOURCE"
          file={pair.source_file}
          pairId={pair.id}
          slotName="source"
          otherSlotFileId={pair.translated_file?.id ?? null}
          onRevealFile={onRevealFile}
          onDropFile={onUpdateSlot ? (payload) => onUpdateSlot(pair.id, 'source', payload.fileId, payload.sourcePairId, payload.sourceSlot) : undefined}
          onClear={onUpdateSlot && pair.source_file ? () => onUpdateSlot(pair.id, 'source', null) : undefined}
        />
        <div className="pair-slot-card__divider" />
        <PairFileSlot
          label="TRANSLATED"
          file={pair.translated_file}
          pairId={pair.id}
          slotName="translated"
          otherSlotFileId={pair.source_file?.id ?? null}
          onRevealFile={onRevealFile}
          onDropFile={onUpdateSlot ? (payload) => onUpdateSlot(pair.id, 'translated', payload.fileId, payload.sourcePairId, payload.sourceSlot) : undefined}
          onClear={onUpdateSlot && pair.translated_file ? () => onUpdateSlot(pair.id, 'translated', null) : undefined}
        />
      </div>

      {/* ---- Footer actions ---- */}
      <div
        className="pair-slot-card__footer"
        onClick={(e) => e.stopPropagation()}
      >
        {(pair.status === 'suggested' ||
          pair.status === 'ignored' ||
          pair.status === 'rejected') &&
          onAccept && (
            <button
              className="btn btn-sm btn-primary"
              onClick={onAccept}
              disabled={actionLoading}
            >
              Accept
            </button>
          )}
        {(pair.status === 'suggested' ||
          pair.status === 'accepted' ||
          pair.status === 'ignored' ||
          pair.status === 'manual') &&
          onReject && (
            <button
              className="btn btn-sm btn-danger"
              onClick={onReject}
              disabled={actionLoading}
            >
              Reject
            </button>
          )}
        <button
          className="btn btn-sm btn-outline"
          onClick={onFileView}
          disabled={actionLoading}
        >
          File View
        </button>
      </div>

      {/* Notes */}
      {pair.notes && (
        <div className="pair-slot-card__notes">Notes: {pair.notes}</div>
      )}
    </div>
  );
}
