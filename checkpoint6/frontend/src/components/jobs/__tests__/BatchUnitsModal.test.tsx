import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import BatchUnitsModal from '../BatchUnitsModal';
import type { TraceUnitModel } from '../../../domain';

afterEach(() => cleanup());

function createUnit(overrides: Partial<TraceUnitModel> = {}): TraceUnitModel {
  return {
    unitId: 'u1',
    filePath: '/path/file.yml',
    key: 'KEY_1',
    sourceText: 'Hello world',
    translatedText: 'Hola mundo',
    status: 'translated',
    errorMessage: '',
    batchIndex: 1,
    updatedAt: '2025-01-01T12:00:00Z',
    ...overrides,
  };
}

function renderModal(overrides: Partial<Parameters<typeof BatchUnitsModal>[0]> = {}) {
  const defaults = {
    jobId: 'job-1',
    batchNo: 17,
    units: [] as TraceUnitModel[],
    loading: false,
    error: null as string | null,
    onClose: vi.fn(),
    onRetry: vi.fn(),
  };
  return render(
    React.createElement(BatchUnitsModal, { ...defaults, ...overrides }),
  );
}

describe('BatchUnitsModal', () => {
  it('shows loading state with spinner', () => {
    renderModal({ loading: true });
    expect(screen.getByText(/loading batch units/i)).toBeTruthy();
    expect(document.querySelector('.spinner')).toBeTruthy();
  });

  it('shows error state with retry button', () => {
    const onRetry = vi.fn();
    renderModal({ error: 'Failed to load', onRetry });
    expect(screen.getByText(/failed to load/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when no units', () => {
    renderModal({ units: [], loading: false, error: null });
    expect(screen.getByText(/no units found/i)).toBeTruthy();
  });

  it('closes on overlay click', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(document.querySelector('.modal-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on modal content click', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(document.querySelector('.modal-content')!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on close button', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on X button', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByText('\u00D7'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows header with batch number', () => {
    renderModal({ batchNo: 17 });
    expect(screen.getByText(/batch #17/i)).toBeTruthy();
  });

  it('shows counts in header', () => {
    const units = [
      createUnit({ unitId: 'u1', status: 'translated' }),
      createUnit({ unitId: 'u2', status: 'failed' }),
      createUnit({ unitId: 'u3', status: 'cached' }),
      createUnit({ unitId: 'u4', status: 'pending' }),
      createUnit({ unitId: 'u5', status: 'sent' }),
    ];
    renderModal({ units });
    expect(screen.getByText('Total:')).toBeTruthy();
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1);
    // Use getAllByText for status labels that may appear in both header counts and table counts
    const completedElements = screen.getAllByText(/Completed:/i);
    expect(completedElements.length).toBeGreaterThanOrEqual(1);
    const failedElements = screen.getAllByText(/Failed:/i);
    expect(failedElements.length).toBeGreaterThanOrEqual(1);
    const cachedElements = screen.getAllByText(/Cached:/i);
    expect(cachedElements.length).toBeGreaterThanOrEqual(1);
    const pendingElements = screen.getAllByText(/Pending:/i);
    expect(pendingElements.length).toBeGreaterThanOrEqual(1);
    const inProgressElements = screen.getAllByText(/In progress:/i);
    expect(inProgressElements.length).toBeGreaterThanOrEqual(1);
  });

  it('shows translated unit rows with source and translation', () => {
    const units = [createUnit({
      unitId: 'u1',
      sourceText: 'Hello',
      translatedText: 'Hola',
      status: 'translated',
      key: 'KEY_1',
    })];
    renderModal({ units });

    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.getByText('Hola')).toBeTruthy();
  });

  it('shows failed unit with error message', () => {
    const units = [createUnit({
      unitId: 'u-fail',
      sourceText: 'Hello',
      status: 'failed',
      errorMessage: 'Translation error occurred',
      translatedText: '',
    })];
    renderModal({ units });

    expect(screen.getByText('Hello')).toBeTruthy();
    // Error message appears in both translation column + error column
    const errorElems = screen.getAllByText('Translation error occurred');
    expect(errorElems.length).toBe(2);
    // Failed status badges/counts: at least one occurrence
    const failedElems = screen.getAllByText('Failed');
    expect(failedElems.length).toBeGreaterThanOrEqual(1);
  });

  it('shows cached unit with translated text', () => {
    const units = [createUnit({
      unitId: 'u-cached',
      sourceText: 'Hello',
      translatedText: 'Hola',
      status: 'cached',
    })];
    renderModal({ units });

    expect(screen.getByText('Hola')).toBeTruthy();
  });

  it('shows pending unit without translation', () => {
    const units = [createUnit({
      unitId: 'u-pending',
      sourceText: 'Hello',
      translatedText: '',
      status: 'pending',
    })];
    renderModal({ units });

    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.queryByRole('cell', { name: /hola/i })).toBeNull();
  });

  it('shows sent unit status', () => {
    const units = [createUnit({
      unitId: 'u-sent',
      sourceText: 'Hello',
      translatedText: '',
      status: 'sent',
    })];
    renderModal({ units });
    expect(screen.getByText(/waiting for response/i)).toBeTruthy();
  });

  it('shows translated status badge as "Translated"', () => {
    const units = [createUnit({ status: 'translated', sourceText: 'Hello' })];
    renderModal({ units });
    expect(screen.getByText('Translated')).toBeTruthy();
  });

  it('shows failed status badge', () => {
    const units = [createUnit({ status: 'failed', sourceText: 'Hello' })];
    renderModal({ units });
    // "Failed" appears in both the status badge and the counts section
    const failedElements = screen.getAllByText('Failed');
    expect(failedElements.length).toBeGreaterThanOrEqual(1);
  });

  it('shows all statuses properly in the table', () => {
    const units = [
      createUnit({ unitId: 'u1', status: 'translated', sourceText: 'A_src_txt', translatedText: 'A-tr' }),
      createUnit({ unitId: 'u2', status: 'cached', sourceText: 'B_src_txt', translatedText: 'B-tr' }),
      createUnit({ unitId: 'u3', status: 'failed', sourceText: 'C_src_txt', errorMessage: 'API error msg' }),
      createUnit({ unitId: 'u4', status: 'pending', sourceText: 'D_src_txt' }),
      createUnit({ unitId: 'u5', status: 'sent', sourceText: 'E_src_txt' }),
    ];
    renderModal({ units });

    // Source texts should be present
    expect(screen.getByText('A_src_txt')).toBeTruthy();
    expect(screen.getByText('B_src_txt')).toBeTruthy();
    expect(screen.getByText('C_src_txt')).toBeTruthy();
    expect(screen.getByText('D_src_txt')).toBeTruthy();
    expect(screen.getByText('E_src_txt')).toBeTruthy();

    // Translated text for successful ones
    expect(screen.getByText('A-tr')).toBeTruthy();
    expect(screen.getByText('B-tr')).toBeTruthy();

    // Error message appears in both translation column + error column
    expect(screen.getAllByText('API error msg').length).toBe(2);

    expect(screen.getByText('Waiting for response...')).toBeTruthy();

    // All status badges should be present
    expect(screen.getAllByText('Translated').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Cached').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Sent').length).toBeGreaterThanOrEqual(1);
  });

  it('shows file path column when units have file paths', () => {
    const units = [createUnit({
      unitId: 'u1',
      filePath: '/path/to/my_file.yml',
      sourceText: 'Hello',
      status: 'translated',
    })];
    renderModal({ units });
    expect(screen.getByText('my_file.yml')).toBeTruthy();
  });
});
