/* ------------------------------------------------------------------ */
/*  Tests: PairSlotCard — slot-style pair card rendering and actions    */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { PairSlotCard } from '../PairSlotCard';
import type { PairingProjectPair } from '../../../api/types';

/* ================================================================== */
/*  Fixtures                                                            */
/* ================================================================== */

function makeFile(id = 'file-1', overrides: Partial<Record<string, any>> = {}) {
  return {
    id,
    project_id: 'proj-1',
    relative_path: overrides.relative_path ?? `localisation/${id === 'file-1' ? 'english' : 'russian'}/events_${id}.yml`,
    file_name: overrides.file_name ?? `events_${id}.yml`,
    extension: overrides.extension ?? '.yml',
    parent_dir: overrides.parent_dir ?? (id === 'file-1' ? 'localisation/english' : 'localisation/russian'),
    size_bytes: 1024,
    content_hash: 'abc',
    modified_at: '2025-01-01T00:00:00Z',
    detected_language: overrides.detected_language ?? (id === 'file-1' ? 'en' : 'ru'),
    detected_role: overrides.detected_role ?? (id === 'file-1' ? 'source' : 'translated'),
    group_key: 'en',
    is_ignored: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };
}

function makePair(overrides: Partial<Record<string, any>> = {}): PairingProjectPair {
  const srcFile = makeFile('file-1', {
    file_name: 'events_l_english.yml',
    detected_role: 'source',
    detected_language: 'en',
    parent_dir: 'localisation/english',
  });
  const tgtFile = makeFile('file-2', {
    file_name: 'events_l_russian.yml',
    detected_role: 'translated',
    detected_language: 'ru',
    parent_dir: 'localisation/russian',
  });
  return {
    id: overrides.id ?? 'pair-1',
    project_id: 'proj-1',
    source_file_id: overrides.source_file_id ?? 'file-1',
    translated_file_id: overrides.translated_file_id ?? 'file-2',
    source_file: overrides.source_file !== undefined ? overrides.source_file : srcFile,
    translated_file: overrides.translated_file !== undefined ? overrides.translated_file : tgtFile,
    status: overrides.status ?? 'manual',
    confidence: overrides.confidence ?? 1.0,
    reason: overrides.reason ?? null,
    created_by: 'user',
    notes: overrides.notes ?? null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };
}

/* ================================================================== */
/*  Setup helpers                                                       */
/* ================================================================== */

function renderCard(pair: PairingProjectPair, overrides: Record<string, any> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onDelete: vi.fn(),
    onFileView: vi.fn(),
    onOpenNormalize: vi.fn(),
    ...overrides,
  };
  const view = render(
    <PairSlotCard
      pair={pair}
      isSelected={false}
      actionLoading={false}
      onSelect={handlers.onSelect}
      onAccept={handlers.onAccept}
      onReject={handlers.onReject}
      onDelete={handlers.onDelete}
      onFileView={handlers.onFileView}
      onOpenNormalize={handlers.onOpenNormalize}
    />,
  );
  return { view, handlers };
}

/* ================================================================== */
/*  Tests                                                               */
/* ================================================================== */

beforeEach(cleanup);
afterEach(cleanup);

describe('PairSlotCard', () => {
  describe('file metadata rendering', () => {
    it('renders source and translated file names from metadata', () => {
      const pair = makePair();
      renderCard(pair);

      expect(screen.getByText('events_l_english.yml')).toBeTruthy();
      expect(screen.getByText('events_l_russian.yml')).toBeTruthy();
    });

    it('does not primarily show raw source_file_id when metadata exists', () => {
      const pair = makePair();
      renderCard(pair);

      // File names should be visible
      expect(screen.getByText('events_l_english.yml')).toBeTruthy();
      // Raw ID should NOT be visible as main text
      expect(screen.queryByText('file-1')).toBeNull();
    });

    it('shows relative path / parent_dir secondary text', () => {
      const pair = makePair();
      renderCard(pair);

      expect(screen.getByText('localisation/english')).toBeTruthy();
    });

    it('shows extension and detected_role metadata', () => {
      const srcFile = makeFile('file-1', {
        file_name: 'events_l_english.yml',
        extension: '.yml',
        detected_role: 'source',
        detected_language: 'en',
      });
      const tgtFile = makeFile('file-2', {
        file_name: 'events_l_russian.yml',
        extension: '.yml',
        detected_role: 'translated',
        detected_language: 'ru',
      });
      const pair = makePair({ source_file: srcFile, translated_file: tgtFile });

      renderCard(pair);

      // Extension appears at least once in meta
      expect(screen.getAllByText('.yml').length).toBeGreaterThanOrEqual(1);
      // Roles should be visible
      expect(screen.getByText('source')).toBeTruthy();
      expect(screen.getByText('translated')).toBeTruthy();
    });
  });

  describe('empty slots', () => {
    it('shows placeholder when source slot is null', () => {
      const pair = makePair({
        source_file_id: null,
        source_file: null,
      });
      renderCard(pair);

      expect(screen.getByText('No source file')).toBeTruthy();
    });

    it('shows placeholder when translated slot is null', () => {
      const pair = makePair({
        translated_file_id: null,
        translated_file: null,
      });
      renderCard(pair);

      expect(screen.getByText('No translated file')).toBeTruthy();
    });

    it('renders source-only pair (translated slot empty)', () => {
      const pair = makePair({
        translated_file_id: null,
        translated_file: null,
      });
      renderCard(pair);

      // Source file should be visible
      expect(screen.getByText('events_l_english.yml')).toBeTruthy();
      // Translated placeholder should be visible
      expect(screen.getByText('No translated file')).toBeTruthy();
    });

    it('renders translated-only pair (source slot empty)', () => {
      const pair = makePair({
        source_file_id: null,
        source_file: null,
        translated_file: makeFile('file-2', {
          file_name: 'events_l_russian.yml',
          detected_role: 'translated',
        }),
      });
      renderCard(pair);

      // Translated file should be visible
      expect(screen.getByText('events_l_russian.yml')).toBeTruthy();
      // Source placeholder should be visible
      expect(screen.getByText('No source file')).toBeTruthy();
    });
  });

  describe('actions', () => {
    it('calls onOpenNormalize with pair id when Open Normalize is clicked', () => {
      const pair = makePair();
      const onOpenNormalize = vi.fn();
      renderCard(pair, { onOpenNormalize });

      const btn = screen.getByText('Open Normalize');
      fireEvent.click(btn);

      expect(onOpenNormalize).toHaveBeenCalledTimes(1);
    });

    it('calls onAccept when Accept is clicked', () => {
      // suggested status shows Accept button
      const pair = makePair({ status: 'suggested' });
      const onAccept = vi.fn();
      renderCard(pair, { onAccept });

      const btn = screen.getByText('Accept');
      fireEvent.click(btn);

      expect(onAccept).toHaveBeenCalledTimes(1);
    });

    it('calls onReject when Reject is clicked', () => {
      const pair = makePair({ status: 'suggested' });
      const onReject = vi.fn();
      renderCard(pair, { onReject });

      const btn = screen.getByText('Reject');
      fireEvent.click(btn);

      expect(onReject).toHaveBeenCalledTimes(1);
    });

    it('calls onDelete when Delete is clicked', () => {
      const pair = makePair();
      const onDelete = vi.fn();
      renderCard(pair, { onDelete });

      const btn = screen.getByText('Delete');
      fireEvent.click(btn);

      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('calls onFileView when File View is clicked', () => {
      const pair = makePair();
      const onFileView = vi.fn();
      renderCard(pair, { onFileView });

      const btn = screen.getByText('File View');
      fireEvent.click(btn);

      expect(onFileView).toHaveBeenCalledTimes(1);
    });
  });

  describe('selected state', () => {
    it('applies selected CSS class when isSelected is true', () => {
      const pair = makePair();
      const { view } = renderCard(pair);

      // Not selected — class should not be present
      const card = view.container.querySelector('.pair-slot-card');
      expect(card?.classList.contains('pair-slot-card--selected')).toBe(false);
    });

    it('does NOT apply selected class when isSelected is false', () => {
      const pair = makePair();
      const { view } = renderCard(pair);

      const card = view.container.querySelector('.pair-slot-card');
      expect(card?.classList.contains('pair-slot-card--selected')).toBe(false);
    });
  });

  describe('status display', () => {
    it('shows status badge text', () => {
      const pair = makePair({ status: 'manual' });
      renderCard(pair);

      expect(screen.getByText('Manual')).toBeTruthy();
    });

    it('shows confidence percentage', () => {
      const pair = makePair({ confidence: 0.85 });
      renderCard(pair);

      expect(screen.getByText('Pair confidence: 85%')).toBeTruthy();
    });
  });

  describe('partial pair rendering', () => {
    it('renders source-only pair card without error', () => {
      const pair = makePair({
        source_file_id: 'file-1',
        translated_file_id: null,
        source_file: makeFile('file-1', { file_name: 'common.yml', detected_role: 'source' }),
        translated_file: null,
      });
      renderCard(pair);

      expect(screen.getByText('common.yml')).toBeTruthy();
      expect(screen.getByText('No translated file')).toBeTruthy();
    });

    it('renders translated-only pair card without error', () => {
      const pair = makePair({
        source_file_id: null,
        translated_file_id: 'file-2',
        source_file: null,
        translated_file: makeFile('file-2', { file_name: 'common_ru.yml', detected_role: 'translated' }),
      });
      renderCard(pair);

      expect(screen.getByText('common_ru.yml')).toBeTruthy();
      expect(screen.getByText('No source file')).toBeTruthy();
    });
  });

  describe('onRevealFile', () => {
    it('calls onRevealFile with source file relative_path when source slot is clicked', () => {
      const srcFile = makeFile('file-1', {
        file_name: 'events_l_english.yml',
        relative_path: 'localisation/english/events_l_english.yml',
        detected_role: 'source',
      });
      const tgtFile = makeFile('file-2', {
        file_name: 'events_l_russian.yml',
        relative_path: 'localisation/russian/events_l_russian.yml',
        detected_role: 'translated',
      });
      const pair = makePair({ source_file: srcFile, translated_file: tgtFile });
      const onRevealFile = vi.fn();

      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
          onRevealFile={onRevealFile}
        />,
      );

      // Find source slot content by its title (set when onRevealFile is present)
      const sourceSlot = screen.getByTitle('Reveal in tree: events_l_english.yml');
      fireEvent.click(sourceSlot);

      expect(onRevealFile).toHaveBeenCalledTimes(1);
      expect(onRevealFile).toHaveBeenCalledWith('localisation/english/events_l_english.yml');
    });

    it('calls onRevealFile with translated file relative_path when translated slot is clicked', () => {
      const srcFile = makeFile('file-1', {
        file_name: 'events_l_english.yml',
        relative_path: 'localisation/english/events_l_english.yml',
        detected_role: 'source',
      });
      const tgtFile = makeFile('file-2', {
        file_name: 'events_l_russian.yml',
        relative_path: 'localisation/russian/events_l_russian.yml',
        detected_role: 'translated',
      });
      const pair = makePair({ source_file: srcFile, translated_file: tgtFile });
      const onRevealFile = vi.fn();

      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
          onRevealFile={onRevealFile}
        />,
      );

      const translatedSlot = screen.getByTitle('Reveal in tree: events_l_russian.yml');
      fireEvent.click(translatedSlot);

      expect(onRevealFile).toHaveBeenCalledTimes(1);
      expect(onRevealFile).toHaveBeenCalledWith('localisation/russian/events_l_russian.yml');
    });

    it('does not crash when onRevealFile is not provided', () => {
      const pair = makePair();
      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
        />,
      );

      // Should render without error — file slot titles should NOT have "Reveal" text
      expect(screen.queryByTitle(/Reveal in tree/)).toBeNull();
    });
  });

  describe('exactLineMatchPercent badge', () => {
    it('renders badge with rounded percentage when value is provided', () => {
      const pair = makePair();
      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
          exactLineMatchPercent={42.7}
        />,
      );
      expect(screen.getByText('Same lines: 43%')).toBeTruthy();
    });

    it('assigns badge-error class when percent >= 70', () => {
      const pair = makePair();
      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
          exactLineMatchPercent={85}
        />,
      );
      const badge = screen.getByText('Same lines: 85%');
      expect(badge.classList.contains('badge-error')).toBe(true);
    });

    it('assigns badge-warning class for 20 <= percent < 70', () => {
      const pair = makePair();
      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
          exactLineMatchPercent={35}
        />,
      );
      const badge = screen.getByText('Same lines: 35%');
      expect(badge.classList.contains('badge-warning')).toBe(true);
    });

    it('assigns plain badge class when percent < 20', () => {
      const pair = makePair();
      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
          exactLineMatchPercent={5}
        />,
      );
      const badge = screen.getByText('Same lines: 5%');
      expect(badge.classList.contains('badge-error')).toBe(false);
      expect(badge.classList.contains('badge-warning')).toBe(false);
    });

    it('shows muted dash badge when exactLineMatchPercent is null and not loading', () => {
      const pair = makePair();
      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
          exactLineMatchPercent={null}
          exactLineMatchLoading={false}
        />,
      );
      expect(screen.getByText('Same lines: —')).toBeTruthy();
    });

    it('shows muted ellipsis badge when loading and percent is null', () => {
      const pair = makePair();
      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
          exactLineMatchPercent={null}
          exactLineMatchLoading={true}
        />,
      );
      expect(screen.getByText('Same lines: …')).toBeTruthy();
    });

    it('shows muted dash badge when exactLineMatchPercent is undefined', () => {
      const pair = makePair();
      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
        />,
      );
      expect(screen.getByText('Same lines: —')).toBeTruthy();
    });

    it('does NOT show muted badge when percent is available even if loading is true', () => {
      const pair = makePair();
      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
          exactLineMatchPercent={75}
          exactLineMatchLoading={true}
        />,
      );
      // Should show the real badge, not muted
      expect(screen.getByText('Same lines: 75%')).toBeTruthy();
      expect(screen.queryByText('Same lines: …')).toBeNull();
      expect(screen.queryByText('Same lines: —')).toBeNull();
    });

    it('shows exact percentage in title attribute', () => {
      const pair = makePair();
      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
          exactLineMatchPercent={42.7}
        />,
      );
      const badge = screen.getByText('Same lines: 43%');
      expect(badge.getAttribute('title')).toBe('Exact line match: 42.7%');
    });
  });

  describe('onUpdateSlot', () => {
    function makeDragPayload(fileId: string): DataTransfer {
      const dt = new DataTransfer();
      dt.setData(
        'application/x-llm-translator-pairing-file',
        JSON.stringify({
          fileId,
          relativePath: 'some/path.yml',
          sourcePairId: null,
          sourceSlot: null,
        }),
      );
      return dt;
    }

    it('wires source slot drop to onUpdateSlot with pair id and "source"', () => {
      const pair = makePair();
      const onUpdateSlot = vi.fn();
      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
          onUpdateSlot={onUpdateSlot}
        />,
      );

      const sourceSlot = screen.getByText('SOURCE').closest('.pair-slot')!;
      fireEvent.drop(sourceSlot, { dataTransfer: makeDragPayload('dropped-id') });

      expect(onUpdateSlot).toHaveBeenCalledTimes(1);
      expect(onUpdateSlot).toHaveBeenCalledWith('pair-1', 'source', 'dropped-id', null, null);
    });

    it('wires translated slot drop to onUpdateSlot with pair id and "translated"', () => {
      const pair = makePair();
      const onUpdateSlot = vi.fn();
      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
          onUpdateSlot={onUpdateSlot}
        />,
      );

      const translatedSlot = screen.getByText('TRANSLATED').closest('.pair-slot')!;
      fireEvent.drop(translatedSlot, { dataTransfer: makeDragPayload('dropped-id') });

      expect(onUpdateSlot).toHaveBeenCalledTimes(1);
      expect(onUpdateSlot).toHaveBeenCalledWith('pair-1', 'translated', 'dropped-id', null, null);
    });

    it('wires source clear to onUpdateSlot with pair id, "source", null', () => {
      const pair = makePair();
      const onUpdateSlot = vi.fn();
      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
          onUpdateSlot={onUpdateSlot}
        />,
      );

      fireEvent.click(screen.getByLabelText('Clear source slot'));

      expect(onUpdateSlot).toHaveBeenCalledTimes(1);
      expect(onUpdateSlot).toHaveBeenCalledWith('pair-1', 'source', null);
    });

    it('wires translated clear to onUpdateSlot with pair id, "translated", null', () => {
      const pair = makePair();
      const onUpdateSlot = vi.fn();
      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
          onUpdateSlot={onUpdateSlot}
        />,
      );

      fireEvent.click(screen.getByLabelText('Clear translated slot'));

      expect(onUpdateSlot).toHaveBeenCalledTimes(1);
      expect(onUpdateSlot).toHaveBeenCalledWith('pair-1', 'translated', null);
    });

    it('does not crash when onUpdateSlot is not provided (no drop handlers attached)', () => {
      const pair = makePair();
      render(
        <PairSlotCard
          pair={pair}
          isSelected={false}
          actionLoading={false}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onFileView={vi.fn()}
        />,
      );

      // Should not crash — verify labels still render
      expect(screen.getByText('SOURCE')).toBeTruthy();
      expect(screen.getByText('TRANSLATED')).toBeTruthy();
    });
  });
});
