import { useRef, useCallback } from 'react';

/**
 * Prevents modal from closing when the user drag-selects text inside
 * the modal content and releases the mouse button on the overlay.
 *
 * Tracks where `pointerdown` originated.  Only closes on `click` when the
 * pointer both went **down** and **up** on the overlay itself – NOT when
 * the drag started on the modal content.
 *
 * Usage:
 *   const { handleOverlayPointerDown, handleOverlayClick } = useDragSafeClose(onClose);
 *   <div className="modal-overlay"
 *        onPointerDown={handleOverlayPointerDown}
 *        onClick={handleOverlayClick}>
 *     <div className="modal-content" onClick={e => e.stopPropagation()}>
 *       ...
 *     </div>
 *   </div>
 */
export function useDragSafeClose(onClose: () => void) {
  const pointerDownOnOverlay = useRef(false);

  const handleOverlayPointerDown = useCallback((e: React.PointerEvent) => {
    pointerDownOnOverlay.current = e.target === e.currentTarget;
  }, []);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (pointerDownOnOverlay.current && e.target === e.currentTarget) {
      onClose();
    }
    pointerDownOnOverlay.current = false;
  }, [onClose]);

  return { handleOverlayPointerDown, handleOverlayClick };
}
