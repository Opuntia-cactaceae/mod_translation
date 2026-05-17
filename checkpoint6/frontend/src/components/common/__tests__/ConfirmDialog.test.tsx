import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConfirmDialog } from '../ConfirmDialog';

afterEach(() => cleanup());

function createProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    message: 'Are you sure?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe('ConfirmDialog', () => {
  it('renders nothing when open is false', () => {
    const props = createProps({ open: false });
    const { container } = render(<ConfirmDialog {...props} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the message text', () => {
    render(<ConfirmDialog {...createProps()} />);
    expect(screen.getByText('Are you sure?')).toBeTruthy();
  });

  it('renders default title', () => {
    render(<ConfirmDialog {...createProps()} />);
    expect(screen.getByText('Confirm action')).toBeTruthy();
  });

  it('renders custom title', () => {
    render(<ConfirmDialog {...createProps({ title: 'Pause Job' })} />);
    expect(screen.getByText('Pause Job')).toBeTruthy();
  });

  it('calls onConfirm when Confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...createProps({ onConfirm })} />);
    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...createProps({ onCancel })} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when close button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...createProps({ onCancel })} />);
    const closeBtn = screen.getByLabelText('Close');
    fireEvent.click(closeBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('uses custom confirm label', () => {
    render(<ConfirmDialog {...createProps({ confirmLabel: 'Yes, pause' })} />);
    expect(screen.getByText('Yes, pause')).toBeTruthy();
  });

  it('uses custom cancel label', () => {
    render(<ConfirmDialog {...createProps({ cancelLabel: 'No, go back' })} />);
    expect(screen.getByText('No, go back')).toBeTruthy();
  });

  it('applies confirmClass to the confirm button', () => {
    render(<ConfirmDialog {...createProps({ confirmClass: 'btn btn-danger' })} />);
    const btn = screen.getByText('Confirm');
    expect(btn.className).toContain('btn-danger');
  });

  it('calls onCancel when overlay is clicked with drag-safe pattern', () => {
    const onCancel = vi.fn();
    const { container } = render(<ConfirmDialog {...createProps({ onCancel })} />);
    const overlay = container.querySelector('.modal-overlay')!;
    // Simulate drag-safe click: pointerDown + click on same target
    fireEvent.pointerDown(overlay, { target: overlay, currentTarget: overlay });
    fireEvent.click(overlay, { target: overlay, currentTarget: overlay });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not call onCancel when overlay click starts on modal content', () => {
    const onCancel = vi.fn();
    const { container } = render(<ConfirmDialog {...createProps({ onCancel })} />);
    const overlay = container.querySelector('.modal-overlay')!;
    const content = container.querySelector('.modal-content')!;
    // Simulate pointer down on content, click on overlay — use fake composedPath
    fireEvent.pointerDown(content);
    fireEvent.click(overlay);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
