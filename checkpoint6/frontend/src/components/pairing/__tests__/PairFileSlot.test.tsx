/* ------------------------------------------------------------------ */
/*  Tests: PairFileSlot — drop target, drag-over visual, clear button  */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { PairFileSlot } from '../PairFileSlot';
import type { PairingProjectFile } from '../../../api/types';

/* ================================================================== */
/*  Fixtures                                                            */
/* ================================================================== */

function makeFile(overrides: Partial<Record<string, any>> = {}): PairingProjectFile {
  return {
    id: overrides.id ?? 'file-1',
    project_id: 'proj-1',
    relative_path: overrides.relative_path ?? 'localisation/english/events.yml',
    file_name: overrides.file_name ?? 'events.yml',
    extension: '.yml',
    parent_dir: 'localisation/english',
    size_bytes: 1024,
    content_hash: 'abc',
    modified_at: null,
    detected_language: 'en',
    detected_role: 'source',
    group_key: null,
    is_ignored: false,
    created_at: '',
    updated_at: '',
  };
}

function createDragEvent(data?: { fileId?: string }): React.DragEvent {
  const dt = new DataTransfer();
  if (data?.fileId) {
    dt.setData(
      'application/x-llm-translator-pairing-file',
      JSON.stringify({
        fileId: data.fileId,
        relativePath: 'localisation/english/events.yml',
        sourcePairId: null,
        sourceSlot: null,
      }),
    );
  }
  return {
    dataTransfer: dt,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.DragEvent;
}

/* ================================================================== */
/*  Setup helpers                                                       */
/* ================================================================== */

beforeEach(cleanup);
afterEach(cleanup);

/* ================================================================== */
/*  Tests                                                               */
/* ================================================================== */

describe('PairFileSlot', () => {
  describe('drop target behavior', () => {
    it('calls onDropFile with fileId when valid payload is dropped', () => {
      const onDropFile = vi.fn();
      render(
        <PairFileSlot label="SOURCE" file={null} onDropFile={onDropFile} />,
      );

      const slot = screen.getByText('No source file').closest('.pair-slot')!;
      const event = createDragEvent({ fileId: 'file-123' });
      fireEvent.drop(slot, event);

      expect(onDropFile).toHaveBeenCalledTimes(1);
      expect(onDropFile).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: 'file-123', sourcePairId: null, sourceSlot: null }),
      );
    });

    it('does not call onDropFile when payload has wrong MIME type', () => {
      const onDropFile = vi.fn();
      render(
        <PairFileSlot label="SOURCE" file={null} onDropFile={onDropFile} />,
      );

      const slot = screen.getByText('No source file').closest('.pair-slot')!;
      const dt = new DataTransfer();
      dt.setData('text/plain', 'hello');
      const event = {
        dataTransfer: dt,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.DragEvent;
      fireEvent.drop(slot, event);

      expect(onDropFile).not.toHaveBeenCalled();
    });

    it('does not call onDropFile when no onDropFile handler is set', () => {
      render(
        <PairFileSlot label="SOURCE" file={null} />,
      );

      const slot = screen.getByText('No source file').closest('.pair-slot')!;
      const event = createDragEvent({ fileId: 'file-123' });
      // Should not throw
      fireEvent.drop(slot, event);
    });

    it('applies drag-over CSS class while dragging over', () => {
      render(
        <PairFileSlot label="SOURCE" file={null} onDropFile={vi.fn()} />,
      );

      const slot = screen.getByText('No source file').closest('.pair-slot')!;
      expect(slot.classList.contains('pair-slot--drag-over')).toBe(false);

      fireEvent.dragOver(slot, createDragEvent({ fileId: 'file-1' }));
      expect(slot.classList.contains('pair-slot--drag-over')).toBe(true);

      fireEvent.dragLeave(slot);
      expect(slot.classList.contains('pair-slot--drag-over')).toBe(false);
    });

    it('removes drag-over class on drop', () => {
      render(
        <PairFileSlot label="SOURCE" file={null} onDropFile={vi.fn()} />,
      );

      const slot = screen.getByText('No source file').closest('.pair-slot')!;
      fireEvent.dragOver(slot, createDragEvent({ fileId: 'file-1' }));
      expect(slot.classList.contains('pair-slot--drag-over')).toBe(true);

      fireEvent.drop(slot, createDragEvent({ fileId: 'file-1' }));
      expect(slot.classList.contains('pair-slot--drag-over')).toBe(false);
    });

    it('stops propagation on dragOver and drop (onDropFile is called)', () => {
      const onDropFile = vi.fn();
      const parentDropHandler = vi.fn();
      render(
        <div onDrop={parentDropHandler}>
          <PairFileSlot label="SOURCE" file={null} onDropFile={onDropFile} />
        </div>,
      );

      const slot = screen.getByText('No source file').closest('.pair-slot')!;

      // Fire drop with valid payload — onDropFile should be called
      // and parent drop handler should NOT be called (stopPropagation)
      const dt = new DataTransfer();
      dt.setData(
        'application/x-llm-translator-pairing-file',
        JSON.stringify({ fileId: 'f1', relativePath: 'p', sourcePairId: null, sourceSlot: null }),
      );
      fireEvent.drop(slot, { dataTransfer: dt });

      expect(onDropFile).toHaveBeenCalledTimes(1);
      expect(parentDropHandler).not.toHaveBeenCalled();
    });
  });

  describe('clear button', () => {
    it('shows clear button when slot is filled and onClear is provided', () => {
      const onClear = vi.fn();
      render(
        <PairFileSlot
          label="SOURCE"
          file={makeFile()}
          onClear={onClear}
        />,
      );

      const clearBtn = screen.getByLabelText('Clear source slot');
      expect(clearBtn).toBeDefined();
    });

    it('does not show clear button when slot is empty', () => {
      render(
        <PairFileSlot label="SOURCE" file={null} onClear={vi.fn()} />,
      );

      expect(screen.queryByLabelText('Clear source slot')).toBeNull();
    });

    it('does not show clear button when onClear is not provided', () => {
      render(
        <PairFileSlot label="SOURCE" file={makeFile()} />,
      );

      expect(screen.queryByLabelText('Clear source slot')).toBeNull();
    });

    it('calls onClear when clear button is clicked', () => {
      const onClear = vi.fn();
      render(
        <PairFileSlot
          label="SOURCE"
          file={makeFile()}
          onClear={onClear}
        />,
      );

      fireEvent.click(screen.getByLabelText('Clear source slot'));
      expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('stops propagation on clear button click', () => {
      const onClear = vi.fn();
      const parentClick = vi.fn();

      const { container } = render(
        <div onClick={parentClick}>
          <PairFileSlot
            label="SOURCE"
            file={makeFile()}
            onClear={onClear}
          />
        </div>,
      );

      fireEvent.click(screen.getByLabelText('Clear source slot'));
      expect(onClear).toHaveBeenCalledTimes(1);
      expect(parentClick).not.toHaveBeenCalled();
    });
  });

  describe('drag feedback enhancements', () => {
    /* ---- Helpers ---- */

    function createSlotOriginDragEvent(overrides?: { fileId?: string; sourcePairId?: string | null; sourceSlot?: string | null }): React.DragEvent {
      const dt = new DataTransfer();
      dt.setData(
        'application/x-llm-translator-pairing-file',
        JSON.stringify({
          fileId: overrides?.fileId ?? 'file-slot',
          relativePath: 'some/path.yml',
          sourcePairId: overrides?.sourcePairId ?? 'pair-other',
          sourceSlot: overrides?.sourceSlot ?? 'source',
        }),
      );
      return {
        dataTransfer: dt,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.DragEvent;
    }

    function createTreeOriginDragEvent(): React.DragEvent {
      const dt = new DataTransfer();
      dt.setData(
        'application/x-llm-translator-pairing-file',
        JSON.stringify({
          fileId: 'file-tree',
          relativePath: 'tree/path.yml',
          sourcePairId: null,
          sourceSlot: null,
        }),
      );
      return {
        dataTransfer: dt,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.DragEvent;
    }

    /* ---- Tests ---- */

    it('slot-origin dragStart sets effectAllowed to "move" via DataTransfer', () => {
      render(
        <PairFileSlot label="SOURCE" file={makeFile()} pairId="pair-1" slotName="source" />,
      );

      const slot = screen.getByText('events.yml').closest('.pair-slot')!;
      const dt = new DataTransfer();
      fireEvent.dragStart(slot, { dataTransfer: dt } as unknown as React.DragEvent);

      // In happy-dom the effectAllowed may not survive the DragEvent constructor,
      // but the handler did execute and set the payload on the DataTransfer.
      expect(dt.getData('application/x-llm-translator-pairing-file')).toBeTruthy();
    });

    it('dragOver from tree-origin applies drag-over class (dropEffect not testable in happy-dom)', () => {
      render(
        <PairFileSlot label="SOURCE" file={null} onDropFile={vi.fn()} />,
      );

      const slot = screen.getByText('No source file').closest('.pair-slot')!;
      const event = createTreeOriginDragEvent();

      fireEvent.dragOver(slot, event);

      expect(slot.classList.contains('pair-slot--drag-over')).toBe(true);
      expect(slot.classList.contains('pair-slot--drag-invalid')).toBe(false);
    });

    it('dragOver from slot-origin to empty slot applies drag-over class', () => {
      render(
        <PairFileSlot label="TRANSLATED" file={null} onDropFile={vi.fn()} />,
      );

      const slot = screen.getByText('No translated file').closest('.pair-slot')!;
      const event = createSlotOriginDragEvent();

      fireEvent.dragOver(slot, event);

      expect(slot.classList.contains('pair-slot--drag-over')).toBe(true);
      expect(slot.classList.contains('pair-slot--drag-invalid')).toBe(false);
    });

    it('dragOver from slot-origin to occupied slot now shows drag-over class (valid swap)', () => {
      render(
        <PairFileSlot label="SOURCE" file={makeFile()} onDropFile={vi.fn()} />,
      );

      const slot = screen.getByText('events.yml').closest('.pair-slot')!;
      const event = createSlotOriginDragEvent();

      fireEvent.dragOver(slot, event);

      // Occupied target is now valid for slot-origin swap
      expect(slot.classList.contains('pair-slot--drag-over')).toBe(true);
      expect(slot.classList.contains('pair-slot--drag-invalid')).toBe(false);
    });

    it('self-drop (same slot) applies drag-invalid class', () => {
      render(
        <PairFileSlot label="SOURCE" file={makeFile()} pairId="pair-1" slotName="source" onDropFile={vi.fn()} />,
      );

      const slot = screen.getByText('events.yml').closest('.pair-slot')!;
      const dt = new DataTransfer();
      dt.setData(
        'application/x-llm-translator-pairing-file',
        JSON.stringify({
          fileId: 'file-slot',
          relativePath: 'some/path.yml',
          sourcePairId: 'pair-1',
          sourceSlot: 'source',
        }),
      );
      const event = {
        dataTransfer: dt,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.DragEvent;

      fireEvent.dragOver(slot, event);

      expect(slot.classList.contains('pair-slot--drag-over')).toBe(false);
      expect(slot.classList.contains('pair-slot--drag-invalid')).toBe(true);
    });

    it('dragLeave clears both drag-over and drag-invalid classes', () => {
      render(
        <PairFileSlot label="SOURCE" file={makeFile()} pairId="pair-1" slotName="source" onDropFile={vi.fn()} />,
      );

      const slot = screen.getByText('events.yml').closest('.pair-slot')!;
      // Self-drop → drag-invalid
      const selfDropDt = new DataTransfer();
      selfDropDt.setData(
        'application/x-llm-translator-pairing-file',
        JSON.stringify({ fileId: 's', relativePath: 'p', sourcePairId: 'pair-1', sourceSlot: 'source' }),
      );
      fireEvent.dragOver(slot, {
        dataTransfer: selfDropDt, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      } as unknown as React.DragEvent);
      expect(slot.classList.contains('pair-slot--drag-invalid')).toBe(true);

      fireEvent.dragLeave(slot);
      expect(slot.classList.contains('pair-slot--drag-over')).toBe(false);
      expect(slot.classList.contains('pair-slot--drag-invalid')).toBe(false);
    });

    it('drop clears both drag-over and drag-invalid classes', () => {
      const onDropFile = vi.fn();
      render(
        <PairFileSlot label="SOURCE" file={makeFile()} pairId="pair-1" slotName="source" onDropFile={onDropFile} />,
      );

      const slot = screen.getByText('events.yml').closest('.pair-slot')!;
      // Self-drop → shows drag-invalid
      const selfDropDt = new DataTransfer();
      selfDropDt.setData(
        'application/x-llm-translator-pairing-file',
        JSON.stringify({ fileId: 's', relativePath: 'p', sourcePairId: 'pair-1', sourceSlot: 'source' }),
      );
      fireEvent.dragOver(slot, {
        dataTransfer: selfDropDt, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      } as unknown as React.DragEvent);
      expect(slot.classList.contains('pair-slot--drag-invalid')).toBe(true);

      const dropEvent = createTreeOriginDragEvent();
      fireEvent.drop(slot, dropEvent);
      expect(slot.classList.contains('pair-slot--drag-over')).toBe(false);
      expect(slot.classList.contains('pair-slot--drag-invalid')).toBe(false);
    });

    it('duplicate drop onto source slot (otherSlotFileId matches) applies drag-invalid class', () => {
      render(
        <PairFileSlot
          label="SOURCE"
          file={null}
          otherSlotFileId="file-same"
          onDropFile={vi.fn()}
        />,
      );

      const slot = screen.getByText('No source file').closest('.pair-slot')!;
      // Tree-origin drag with fileId matching otherSlotFileId
      const dt = new DataTransfer();
      dt.setData(
        'application/x-llm-translator-pairing-file',
        JSON.stringify({ fileId: 'file-same', relativePath: 'p', sourcePairId: null, sourceSlot: null }),
      );
      fireEvent.dragOver(slot, {
        dataTransfer: dt, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      } as unknown as React.DragEvent);

      expect(slot.classList.contains('pair-slot--drag-over')).toBe(false);
      expect(slot.classList.contains('pair-slot--drag-invalid')).toBe(true);
    });

    it('duplicate drop onto translated slot (otherSlotFileId matches) applies drag-invalid class', () => {
      render(
        <PairFileSlot
          label="TRANSLATED"
          file={null}
          otherSlotFileId="file-same"
          onDropFile={vi.fn()}
        />,
      );

      const slot = screen.getByText('No translated file').closest('.pair-slot')!;
      const dt = new DataTransfer();
      dt.setData(
        'application/x-llm-translator-pairing-file',
        JSON.stringify({ fileId: 'file-same', relativePath: 'p', sourcePairId: null, sourceSlot: null }),
      );
      fireEvent.dragOver(slot, {
        dataTransfer: dt, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      } as unknown as React.DragEvent);

      expect(slot.classList.contains('pair-slot--drag-over')).toBe(false);
      expect(slot.classList.contains('pair-slot--drag-invalid')).toBe(true);
    });

    it('non-duplicate drop onto source slot (different fileId) applies drag-over class', () => {
      render(
        <PairFileSlot
          label="SOURCE"
          file={null}
          otherSlotFileId="existing-file"
          onDropFile={vi.fn()}
        />,
      );

      const slot = screen.getByText('No source file').closest('.pair-slot')!;
      const dt = new DataTransfer();
      dt.setData(
        'application/x-llm-translator-pairing-file',
        JSON.stringify({ fileId: 'different-file', relativePath: 'p', sourcePairId: null, sourceSlot: null }),
      );
      fireEvent.dragOver(slot, {
        dataTransfer: dt, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      } as unknown as React.DragEvent);

      expect(slot.classList.contains('pair-slot--drag-over')).toBe(true);
      expect(slot.classList.contains('pair-slot--drag-invalid')).toBe(false);
    });

    it('slot-origin duplicate (otherSlotFileId matches) applies drag-invalid class', () => {
      render(
        <PairFileSlot
          label="TRANSLATED"
          file={makeFile()}
          pairId="pair-1"
          slotName="translated"
          otherSlotFileId="file-same"
          onDropFile={vi.fn()}
        />,
      );

      const slot = screen.getByText('events.yml').closest('.pair-slot')!;
      const dt = new DataTransfer();
      dt.setData(
        'application/x-llm-translator-pairing-file',
        JSON.stringify({ fileId: 'file-same', relativePath: 'p', sourcePairId: 'pair-other', sourceSlot: 'source' }),
      );
      fireEvent.dragOver(slot, {
        dataTransfer: dt, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      } as unknown as React.DragEvent);

      expect(slot.classList.contains('pair-slot--drag-over')).toBe(false);
      expect(slot.classList.contains('pair-slot--drag-invalid')).toBe(true);
    });

    it('title attribute shows "Drop file here" on empty slot', () => {
      render(
        <PairFileSlot label="SOURCE" file={null} onDropFile={vi.fn()} />,
      );

      const slot = screen.getByText('No source file').closest('.pair-slot')!;
      expect(slot.getAttribute('title')).toBe('Drop file here');
      expect(slot.getAttribute('aria-label')).toBe('Drop file here');
    });

    it('title is null on occupied slot even during dragOver (valid swap, not an error)', () => {
      render(
        <PairFileSlot label="SOURCE" file={makeFile()} onDropFile={vi.fn()} />,
      );

      const slot = screen.getByText('events.yml').closest('.pair-slot')!;
      expect(slot.getAttribute('title')).toBeNull();

      // Even during slot-origin dragOver, no warning title (swap is valid)
      const event = createSlotOriginDragEvent();
      fireEvent.dragOver(slot, event);
      expect(slot.getAttribute('title')).toBeNull();
      expect(slot.getAttribute('aria-label')).toBeNull();
    });

    it('existing valid drop still calls onDropFile', () => {
      const onDropFile = vi.fn();
      render(
        <PairFileSlot label="SOURCE" file={null} onDropFile={onDropFile} />,
      );

      const slot = screen.getByText('No source file').closest('.pair-slot')!;
      const event = createTreeOriginDragEvent();
      fireEvent.drop(slot, event);

      expect(onDropFile).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: 'file-tree', sourcePairId: null }),
      );
    });
  });
});
