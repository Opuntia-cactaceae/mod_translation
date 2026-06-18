/* ------------------------------------------------------------------ */
/*  Drag payload types & helpers for the Pairing Workspace DnD          */
/*                                                                      */
/*  Defines the custom MIME type and helpers for serializing/parsing    */
/*  drag payloads between the FILES tree (drag source), pair slots      */
/*  (drop target), and slot-to-slot moves.                              */
/*                                                                      */
/*  Tree-origin:  sourcePairId === null, sourceSlot === null            */
/*  Slot-origin:  sourcePairId === pair.id, sourceSlot === slot name    */
/* ------------------------------------------------------------------ */

export const PAIRING_FILE_DRAG_TYPE =
  'application/x-llm-translator-pairing-file';

export interface DragFilePayload {
  /** File UUID from the backend. */
  fileId: string;
  /** Relative path within the project. */
  relativePath: string;
  /** Display file name (optional). */
  fileName?: string;
  /** Detected role: 'source' | 'translated' | null. */
  detectedRole?: string | null;
  /** Null for tree-origin drags; pair.id for slot-origin drags. */
  sourcePairId: string | null;
  /** Null for tree-origin drags; 'source' | 'translated' for slot-origin. */
  sourceSlot: 'source' | 'translated' | null;
}

/**
 * Serialize a DragFilePayload into a DataTransfer object.
 */
export function setDragFilePayload(
  dataTransfer: DataTransfer,
  payload: DragFilePayload,
): void {
  dataTransfer.setData(PAIRING_FILE_DRAG_TYPE, JSON.stringify(payload));
}

/**
 * Deserialize a DragFilePayload from a DataTransfer object.
 *
 * Returns `null` when:
 *  - No data exists for the custom MIME type.
 *  - JSON parsing fails.
 *  - Required fields (`fileId`, `relativePath`) are missing or wrong type.
 *
 * Never throws.
 */
export function getDragFilePayload(
  dataTransfer: DataTransfer,
): DragFilePayload | null {
  try {
    const raw = dataTransfer.getData(PAIRING_FILE_DRAG_TYPE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.fileId !== 'string' ||
      typeof parsed.relativePath !== 'string'
    ) {
      return null;
    }
    return {
      fileId: parsed.fileId,
      relativePath: parsed.relativePath,
      fileName: parsed.fileName,
      detectedRole: parsed.detectedRole ?? null,
      sourcePairId: parsed.sourcePairId ?? null,
      sourceSlot: parsed.sourceSlot ?? null,
    };
  } catch {
    return null;
  }
}
