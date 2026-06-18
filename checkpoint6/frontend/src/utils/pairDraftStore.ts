/**
 * Per-pair in-memory draft store.
 *
 * Holds unsaved editor content keyed by ``pairId`` so that switching away
 * from a pair and back later restores the user's uncommitted edits.
 *
 * Design decisions:
 * - Module-level ``Map`` — survives component unmount/remount within a page
 *   session, but NOT page reload (deliberate: no disk writes).
 * - File View and Line Editor drafts are stored independently so that edits
 *   in one tab do not clobber edits in the other.
 * - A draft is cleared (via ``clear()`` / ``clearPair()``) after a
 *   successful save or when its pair is deleted.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface FileViewDraft {
  sourceContent: string;
  translatedContent: string;
  sourceDirty: boolean;
  translatedDirty: boolean;
}

export interface LineEditorRowDraft {
  id: number;
  translatedText: string;
  dirty: boolean;
  originalTranslated: string;
  /** Stable content-based key: ``sourceText + \x1F + originalTranslated``.
   *  Used for correct merge-on-restore when rows shift (insert/remove/reorder).
   *  Old drafts saved before this field existed will be ``undefined`` —
   *  the restore logic falls back to ``originalTranslated`` matching. */
  draftKey?: string;
}

export interface LineEditorDraft {
  rows: LineEditorRowDraft[];
}

export interface PairDrafts {
  fileView?: FileViewDraft;
  lineEditor?: LineEditorDraft;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Build a stable content-based draft key that survives row shifts.
 *
 *  Uses ``sourceText`` and ``originalTranslated`` together so that rows
 *  with duplicate ``originalTranslated`` text are still disambiguated
 *  by their source text. The ``\x1F`` (unit separator) character is
 *  extremely unlikely to appear in real file content.
 */
export function buildLineDraftKey(sourceText: string, originalTranslated: string): string {
  return `${sourceText}\u001f${originalTranslated}`;
}

/* ------------------------------------------------------------------ */
/*  Store implementation                                               */
/* ------------------------------------------------------------------ */

class PairDraftStoreInternal {
  private drafts = new Map<string, PairDrafts>();

  /** Save File View draft for a pair. */
  saveFileViewDraft(pairId: string, draft: FileViewDraft): void {
    const existing = this.drafts.get(pairId) ?? {};
    this.drafts.set(pairId, { ...existing, fileView: draft });
  }

  /** Save Line Editor draft for a pair. */
  saveLineEditorDraft(pairId: string, draft: LineEditorDraft): void {
    const existing = this.drafts.get(pairId) ?? {};
    this.drafts.set(pairId, { ...existing, lineEditor: draft });
  }

  /** Load all drafts for a pair (returns ``undefined`` when none exist). */
  load(pairId: string): PairDrafts | undefined {
    return this.drafts.get(pairId);
  }

  /** Check whether any draft exists for a pair. */
  has(pairId: string): boolean {
    return this.drafts.has(pairId);
  }

  /** Delete all drafts for a single pair. */
  clearPair(pairId: string): void {
    this.drafts.delete(pairId);
  }

  /** Delete File View draft only for a pair. */
  clearFileViewDraft(pairId: string): void {
    const existing = this.drafts.get(pairId);
    if (!existing) return;
    const { fileView: _, ...rest } = existing;
    if (Object.keys(rest).length === 0) {
      this.drafts.delete(pairId);
    } else {
      this.drafts.set(pairId, rest);
    }
  }

  /** Delete Line Editor draft only for a pair. */
  clearLineEditorDraft(pairId: string): void {
    const existing = this.drafts.get(pairId);
    if (!existing) return;
    const { lineEditor: _, ...rest } = existing;
    if (Object.keys(rest).length === 0) {
      this.drafts.delete(pairId);
    } else {
      this.drafts.set(pairId, rest);
    }
  }

  /** Delete all drafts for all pairs. */
  clearAll(): void {
    this.drafts.clear();
  }

  /** Return number of pairs with saved drafts (useful for tests). */
  get size(): number {
    return this.drafts.size;
  }
}

/** Singleton instance shared across the application. */
export const pairDraftStore = new PairDraftStoreInternal();
