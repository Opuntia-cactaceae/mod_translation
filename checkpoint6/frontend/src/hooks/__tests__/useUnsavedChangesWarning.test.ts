import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUnsavedChangesWarning } from '../useUnsavedChangesWarning';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useUnsavedChangesWarning', () => {
  describe('beforeunload', () => {
    beforeEach(() => {
      // Suppress the "preventDefault" warning in jsdom
      vi.spyOn(window, 'addEventListener');
      vi.spyOn(window, 'removeEventListener');
    });

    it('registers beforeunload when dirty is true', () => {
      renderHook(() => useUnsavedChangesWarning({ dirty: true }));
      expect(window.addEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });

    it('does not register beforeunload when dirty is false', () => {
      renderHook(() => useUnsavedChangesWarning({ dirty: false }));
      expect(window.addEventListener).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });

    it('removes beforeunload when dirty becomes false', () => {
      const { rerender } = renderHook(
        ({ dirty }) => useUnsavedChangesWarning({ dirty }),
        { initialProps: { dirty: true } },
      );
      expect(window.addEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));

      rerender({ dirty: false });
      expect(window.removeEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });
  });

  describe('confirmNavigation', () => {
    beforeEach(() => {
      vi.spyOn(window, 'confirm');
    });

    it('calls callback when dirty is false (no confirm needed)', () => {
      const { result } = renderHook(() => useUnsavedChangesWarning({ dirty: false }));
      const callback = vi.fn();

      act(() => {
        result.current.confirmNavigation(callback);
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(window.confirm).not.toHaveBeenCalled();
    });

    it('calls callback after confirm when dirty is true and user confirms', () => {
      vi.mocked(window.confirm).mockReturnValue(true);
      const { result } = renderHook(() => useUnsavedChangesWarning({ dirty: true }));
      const callback = vi.fn();

      act(() => {
        result.current.confirmNavigation(callback);
      });

      expect(window.confirm).toHaveBeenCalledTimes(1);
      expect(window.confirm).toHaveBeenCalledWith('You have unsaved changes. Leave anyway?');
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does not call callback when dirty is true and user cancels', () => {
      vi.mocked(window.confirm).mockReturnValue(false);
      const { result } = renderHook(() => useUnsavedChangesWarning({ dirty: true }));
      const callback = vi.fn();

      act(() => {
        result.current.confirmNavigation(callback);
      });

      expect(window.confirm).toHaveBeenCalledTimes(1);
      expect(callback).not.toHaveBeenCalled();
    });

    it('uses custom message when provided', () => {
      vi.mocked(window.confirm).mockReturnValue(false);
      const { result } = renderHook(() =>
        useUnsavedChangesWarning({ dirty: true, message: 'Custom message?' }),
      );

      act(() => {
        result.current.confirmNavigation(() => {});
      });

      expect(window.confirm).toHaveBeenCalledWith('Custom message?');
    });
  });
});
