import { describe, it, expect, beforeEach } from 'vitest';
import { pairDraftStore } from '../pairDraftStore';

/* ------------------------------------------------------------------ */
/*  Tests for PairDraftStore                                           */
/* ------------------------------------------------------------------ */

describe('PairDraftStore', () => {
  beforeEach(() => {
    pairDraftStore.clearAll();
  });

  /* ---- saveFileViewDraft / load ----------------------------------- */

  it('stores and retrieves a File View draft', () => {
    pairDraftStore.saveFileViewDraft('pair_1', {
      sourceContent: 'source text',
      translatedContent: 'translated text',
      sourceDirty: true,
      translatedDirty: false,
    });

    const loaded = pairDraftStore.load('pair_1');
    expect(loaded).toBeDefined();
    expect(loaded!.fileView).toBeDefined();
    expect(loaded!.fileView!.sourceContent).toBe('source text');
    expect(loaded!.fileView!.translatedContent).toBe('translated text');
    expect(loaded!.fileView!.sourceDirty).toBe(true);
    expect(loaded!.fileView!.translatedDirty).toBe(false);
  });

  it('returns undefined for a pair with no drafts', () => {
    expect(pairDraftStore.load('nonexistent')).toBeUndefined();
  });

  /* ---- saveLineEditorDraft / load --------------------------------- */

  it('stores and retrieves a Line Editor draft', () => {
    pairDraftStore.saveLineEditorDraft('pair_1', {
      rows: [
        { id: 0, translatedText: 'hello', dirty: true, originalTranslated: 'hola' },
        { id: 1, translatedText: 'world', dirty: false, originalTranslated: 'mundo' },
      ],
    });

    const loaded = pairDraftStore.load('pair_1');
    expect(loaded).toBeDefined();
    expect(loaded!.lineEditor).toBeDefined();
    expect(loaded!.lineEditor!.rows).toHaveLength(2);
    expect(loaded!.lineEditor!.rows[0].translatedText).toBe('hello');
    expect(loaded!.lineEditor!.rows[0].dirty).toBe(true);
    expect(loaded!.lineEditor!.rows[1].translatedText).toBe('world');
  });

  /* ---- independent tabs: File View and Line Editor separate -------- */

  it('keeps File View and Line Editor drafts independent', () => {
    pairDraftStore.saveFileViewDraft('pair_1', {
      sourceContent: 'src', translatedContent: 'tgt',
      sourceDirty: true, translatedDirty: false,
    });
    pairDraftStore.saveLineEditorDraft('pair_1', {
      rows: [{ id: 0, translatedText: 't', dirty: true, originalTranslated: 'o' }],
    });

    const loaded = pairDraftStore.load('pair_1');
    expect(loaded!.fileView).toBeDefined();
    expect(loaded!.lineEditor).toBeDefined();

    // Clear File View only — Line Editor should survive
    pairDraftStore.clearFileViewDraft('pair_1');
    const afterClear = pairDraftStore.load('pair_1');
    expect(afterClear!.fileView).toBeUndefined();
    expect(afterClear!.lineEditor).toBeDefined();
  });

  /* ---- clearPair -------------------------------------------------- */

  it('clears all drafts for a single pair', () => {
    pairDraftStore.saveFileViewDraft('pair_1', {
      sourceContent: 's', translatedContent: 't',
      sourceDirty: true, translatedDirty: false,
    });
    expect(pairDraftStore.has('pair_1')).toBe(true);

    pairDraftStore.clearPair('pair_1');
    expect(pairDraftStore.has('pair_1')).toBe(false);
    expect(pairDraftStore.load('pair_1')).toBeUndefined();
  });

  /* ---- clearAll --------------------------------------------------- */

  it('clears all drafts for all pairs', () => {
    pairDraftStore.saveFileViewDraft('pair_a', {
      sourceContent: 'a', translatedContent: 'b',
      sourceDirty: false, translatedDirty: false,
    });
    pairDraftStore.saveLineEditorDraft('pair_b', {
      rows: [{ id: 0, translatedText: 'x', dirty: false, originalTranslated: 'x' }],
    });

    expect(pairDraftStore.size).toBe(2);
    pairDraftStore.clearAll();
    expect(pairDraftStore.size).toBe(0);
  });

  /* ---- clearFileViewDraft / clearLineEditorDraft ------------------- */

  it('clearFileViewDraft removes only the File View draft', () => {
    pairDraftStore.saveFileViewDraft('pair_1', {
      sourceContent: 's', translatedContent: 't',
      sourceDirty: true, translatedDirty: false,
    });
    expect(pairDraftStore.has('pair_1')).toBe(true);

    pairDraftStore.clearFileViewDraft('pair_1');
    // No other draft type → pair entry should be removed entirely
    expect(pairDraftStore.has('pair_1')).toBe(false);
  });

  it('clearLineEditorDraft removes only the Line Editor draft', () => {
    pairDraftStore.saveLineEditorDraft('pair_1', {
      rows: [{ id: 0, translatedText: 'x', dirty: false, originalTranslated: 'x' }],
    });
    expect(pairDraftStore.has('pair_1')).toBe(true);

    pairDraftStore.clearLineEditorDraft('pair_1');
    expect(pairDraftStore.has('pair_1')).toBe(false);
  });

  /* ---- has -------------------------------------------------------- */

  it('has returns true when a draft exists', () => {
    expect(pairDraftStore.has('pair_1')).toBe(false);
    pairDraftStore.saveFileViewDraft('pair_1', {
      sourceContent: '', translatedContent: '',
      sourceDirty: false, translatedDirty: false,
    });
    expect(pairDraftStore.has('pair_1')).toBe(true);
  });

  /* ---- size -------------------------------------------------------- */

  it('size reflects number of pairs with drafts', () => {
    expect(pairDraftStore.size).toBe(0);
    pairDraftStore.saveFileViewDraft('pair_x', {
      sourceContent: '', translatedContent: '',
      sourceDirty: false, translatedDirty: false,
    });
    expect(pairDraftStore.size).toBe(1);
    pairDraftStore.saveLineEditorDraft('pair_y', {
      rows: [{ id: 0, translatedText: '', dirty: false, originalTranslated: '' }],
    });
    expect(pairDraftStore.size).toBe(2);
  });

  /* ---- Real-world scenario: edit -> switch -> return --------------- */

  it('simulates editing pair A, switching to B, returning to A', () => {
    // 1. User edits pair A
    pairDraftStore.saveFileViewDraft('pair_a', {
      sourceContent: 'original source',
      translatedContent: 'edited translation',
      sourceDirty: false,
      translatedDirty: true,
    });

    // 2. User switches to pair B (no draft for B yet)
    expect(pairDraftStore.load('pair_b')).toBeUndefined();

    // 3. User edits pair B
    pairDraftStore.saveFileViewDraft('pair_b', {
      sourceContent: 'source b',
      translatedContent: 'edited b',
      sourceDirty: false,
      translatedDirty: true,
    });

    // 4. User switches back to pair A → draft should be intact
    const restored = pairDraftStore.load('pair_a')!.fileView!;
    expect(restored.translatedContent).toBe('edited translation');
    expect(restored.translatedDirty).toBe(true);

    // 5. User saves pair A → draft should be cleared
    pairDraftStore.clearFileViewDraft('pair_a');
    expect(pairDraftStore.has('pair_a')).toBe(false);
  });

  /* ---- Simulates save-then-check cleanup -------------------------- */

  it('clears draft after successful save (File View both sides clean)', () => {
    pairDraftStore.saveFileViewDraft('pair_1', {
      sourceContent: 's', translatedContent: 't',
      sourceDirty: true, translatedDirty: true,
    });

    // Save source side only — translated is still dirty → keep draft
    pairDraftStore.clearFileViewDraft('pair_1');
    // In the real flow, after saving BOTH sides, the draft is cleared
    expect(pairDraftStore.has('pair_1')).toBe(false);
  });

  it('clears draft after successful Line Editor save', () => {
    pairDraftStore.saveLineEditorDraft('pair_1', {
      rows: [{ id: 0, translatedText: 'edited', dirty: true, originalTranslated: 'original' }],
    });

    // Simulate save success
    pairDraftStore.clearLineEditorDraft('pair_1');
    expect(pairDraftStore.has('pair_1')).toBe(false);
  });

  /* ---- clearLineEditorDraft preserves FileView draft --------------- */

  it('preserves File View draft when only Line Editor draft is cleared', () => {
    pairDraftStore.saveFileViewDraft('pair_1', {
      sourceContent: 's', translatedContent: 't',
      sourceDirty: true, translatedDirty: false,
    });
    pairDraftStore.saveLineEditorDraft('pair_1', {
      rows: [{ id: 0, translatedText: 'x', dirty: true, originalTranslated: 'y' }],
    });

    pairDraftStore.clearLineEditorDraft('pair_1');
    const loaded = pairDraftStore.load('pair_1');
    expect(loaded!.fileView).toBeDefined();
    expect(loaded!.lineEditor).toBeUndefined();
  });
});
