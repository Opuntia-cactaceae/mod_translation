import type { ReactNode } from 'react';
import { useDragSafeClose } from '../../hooks/useDragSafeClose';

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  confirmClass?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title = 'Confirm action',
  message,
  confirmLabel = 'Confirm',
  confirmClass = 'btn btn-primary',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { handleOverlayPointerDown, handleOverlayClick } = useDragSafeClose(onCancel);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onPointerDown={handleOverlayPointerDown}
      onClick={handleOverlayClick}
    >
      <div className="modal-content confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{title}</span>
          <button className="modal-close" onClick={onCancel} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="modal-body">
          <p>{message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={confirmClass} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
