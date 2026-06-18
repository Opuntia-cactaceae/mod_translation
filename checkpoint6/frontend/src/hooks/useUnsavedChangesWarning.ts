import { useEffect, useCallback } from 'react';

interface UseUnsavedChangesWarningOptions {
  /** Whether there are unsaved changes that should trigger a warning. */
  dirty: boolean;
  /** Custom message for the confirmation dialog. */
  message?: string;
}

/**
 * A safe navigation guard compatible with BrowserRouter.
 *
 * - Registers a `beforeunload` handler when `dirty` is true (tab close / refresh).
 * - Returns `confirmNavigation(callback)` — wraps a navigation callback with a
 *   `window.confirm` prompt when dirty, so programmatic navigate() calls can be
 *   guarded without useBlocker (which requires createBrowserRouter).
 *
 * Does NOT use useBlocker, usePrompt, or any data-router-only API.
 */
export function useUnsavedChangesWarning({
  dirty,
  message = 'You have unsaved changes. Leave anyway?',
}: UseUnsavedChangesWarningOptions) {
  // ── beforeunload guard for tab close / browser refresh ──
  useEffect(() => {
    if (!dirty) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ── Programmatic navigation guard ──
  const confirmNavigation = useCallback(
    (callback: () => void) => {
      if (dirty) {
        const ok = window.confirm(message);
        if (!ok) return;
      }
      callback();
    },
    [dirty, message],
  );

  return { confirmNavigation };
}
