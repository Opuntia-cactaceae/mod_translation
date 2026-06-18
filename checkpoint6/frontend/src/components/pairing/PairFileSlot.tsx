/* ------------------------------------------------------------------ */
/*  PairFileSlot — individual file slot inside a PairSlotCard          */
/*                                                                      */
/*  Shows file_name, relative_path, extension/detected_role/language    */
/*  for a populated slot, or a placeholder for an empty slot.           */
/*                                                                      */
/*  Supports native HTML5 drag-and-drop:                                */
/*   - Drag source: when filled (pairId + slotName provided)            */
/*   - Drop target: when onDropFile is provided                         */
/*   - Clear button: when onClear is provided                           */
/* ------------------------------------------------------------------ */

import { useState } from 'react';
import type { PairingProjectFile } from '../../api/types';
import {
  getDragFilePayload,
  setDragFilePayload,
  type DragFilePayload,
} from '../../domain/dragPayload';

interface PairFileSlotProps {
  /** 'SOURCE' or 'TRANSLATED' label */
  label: string;
  /** File metadata from the enriched PairResponse, or null if slot is empty */
  file: PairingProjectFile | null | undefined;
  labelFor?: string;
  /** Pair ID — makes this slot a drag source when file is present. */
  pairId?: string;
  /** Slot name — `'source'` or `'translated'`. Required for drag source. */
  slotName?: 'source' | 'translated';
  /**
   * The file ID in the *other* slot of this same pair, or null.
   * Used in dragOver to detect and reject duplicate drops where the
   * dragged file would occupy both slots of the same pair.
   */
  otherSlotFileId?: string | null;
  /** Optional handler when the file slot is clicked (e.g. reveal in tree). */
  onRevealFile?: (relativePath: string) => void;
  /** Called with the full DragFilePayload when a file is dropped onto this slot. */
  onDropFile?: (payload: DragFilePayload) => void;
  /** Called when the clear ✕ button is clicked (occupied slot only). */
  onClear?: () => void;
}

export function PairFileSlot({
  label,
  file,
  labelFor,
  pairId,
  slotName,
  otherSlotFileId,
  onRevealFile,
  onDropFile,
  onClear,
}: PairFileSlotProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragInvalid, setIsDragInvalid] = useState(false);

  /** True when this slot can act as a drag source (occupied + pair context known). */
  const isDraggable = !!(file && pairId && slotName);

  const handleClick = onRevealFile && file
    ? (e: React.MouseEvent) => { e.stopPropagation(); onRevealFile(file.relative_path); }
    : undefined;

  const canDrop = !!onDropFile;

  const handleDragStart = (e: React.DragEvent) => {
    if (!file || !pairId || !slotName) return;
    setDragFilePayload(e.dataTransfer, {
      fileId: file.id,
      relativePath: file.relative_path,
      fileName: file.file_name,
      detectedRole: file.detected_role,
      sourcePairId: pairId,
      sourceSlot: slotName,
    });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Attempt to read the drag payload to determine origin type.
    // If unreadable (some browsers/tests), fall back to valid state.
    const payload = getDragFilePayload(e.dataTransfer);
    if (!payload) {
      // Unreadable payload — show valid drop target
      setIsDragOver(true);
      setIsDragInvalid(false);
      return;
    }

    // --- Duplicate check: payload file would occupy both slots of this pair ---
    if (otherSlotFileId != null && payload.fileId === otherSlotFileId) {
      e.dataTransfer.dropEffect = 'none';
      setIsDragOver(false);
      setIsDragInvalid(true);
      return;
    }

    if (payload.sourcePairId) {
      // Slot-origin drag
      const isSelfDrop = payload.sourcePairId === pairId && payload.sourceSlot === slotName;
      if (file && isSelfDrop) {
        // Self-drop on the same slot → invalid (no-op)
        e.dataTransfer.dropEffect = 'none';
        setIsDragOver(false);
        setIsDragInvalid(true);
      } else if (file) {
        // Occupied slot → valid swap target
        e.dataTransfer.dropEffect = 'move';
        setIsDragOver(true);
        setIsDragInvalid(false);
      } else {
        // Empty slot → valid move target
        e.dataTransfer.dropEffect = 'move';
        setIsDragOver(true);
        setIsDragInvalid(false);
      }
    } else {
      // Tree-origin drag — always valid (unless duplicate already caught above)
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
      setIsDragInvalid(false);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    setIsDragOver(false);
    setIsDragInvalid(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setIsDragInvalid(false);
    const payload = getDragFilePayload(e.dataTransfer);
    if (payload) {
      onDropFile?.(payload);
    }
  };

  return (
    <div
      className={`pair-slot ${file ? 'pair-slot--filled' : 'pair-slot--empty'}${isDragOver ? ' pair-slot--drag-over' : ''}${isDragInvalid ? ' pair-slot--drag-invalid' : ''}`}
      draggable={isDraggable}
      onDragStart={isDraggable ? handleDragStart : undefined}
      onDragOver={canDrop ? handleDragOver : undefined}
      onDragLeave={canDrop ? handleDragLeave : undefined}
      onDrop={canDrop ? handleDrop : undefined}
      title={!file ? 'Drop file here' : undefined}
      aria-label={!file ? 'Drop file here' : undefined}
    >
      {/* Slot label */}
      <div className="pair-slot__label">
        {label}{labelFor ? ` (${labelFor})` : ''}
      </div>

      {/* Clear button for occupied slots */}
      {file && onClear && (
        <button
          className="pair-slot__clear"
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          title={`Clear ${label.toLowerCase()} slot`}
          type="button"
          aria-label={`Clear ${label.toLowerCase()} slot`}
        >
          ×
        </button>
      )}

      {file ? (
        <div
          className="pair-slot__content"
          onClick={handleClick}
          role={handleClick ? 'button' : undefined}
          tabIndex={handleClick ? 0 : undefined}
          onKeyDown={handleClick ? (e) => { if (e.key === 'Enter') handleClick(e as any); } : undefined}
          title={handleClick ? `Reveal in tree: ${file.file_name}` : undefined}
        >
          <div className="pair-slot__filename" title={file.file_name}>
            {file.file_name}
          </div>
          <div className="pair-slot__path" title={file.relative_path}>
            {file.parent_dir}
          </div>
          <div className="pair-slot__meta">
            <span className="pair-slot__ext">{file.extension || '-'}</span>
            <span className="pair-slot__sep">·</span>
            <span>{file.detected_role || 'unknown'}</span>
            {file.detected_language && (
              <>
                <span className="pair-slot__sep">·</span>
                <span>{file.detected_language}</span>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="pair-slot__empty">
          <div className="pair-slot__placeholder">No {label.toLowerCase()} file</div>
          <div className="pair-slot__hint">Drop/add later</div>
        </div>
      )}
    </div>
  );
}
