import { useState, useEffect, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * useState + sessionStorage persistence.
 *
 * Mirrors the sessionStorage pattern used in PairingProjects.tsx for
 * persisting workspace preferences (groupingMode, fileFilter,
 * activeProjectId) across page reloads.
 *
 * @param key   sessionStorage key
 * @param defaultValue  Fallback when the key is absent or cannot be parsed.
 *
 * @returns [value, setValue]  Identical to useState, except writes are
 *          automatically persisted to sessionStorage on every change.
 */
export function usePairingSessionState<T>(
  key: string,
  defaultValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw !== null) {
        return JSON.parse(raw) as T;
      }
    } catch {
      // Ignore parse errors — fall through to defaultValue
    }
    return defaultValue;
  });

  /* Persist to sessionStorage on every value change */
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // sessionStorage may throw in private browsing / quota-exceeded scenarios
    }
  }, [key, value]);

  /* Functional update support — identical to React's useState updater */
  const setAndPersist = useCallback(
    (updater: T | ((prev: T) => T)) => {
      setValue(updater);
    },
    [],
  );

  return [value, setAndPersist];
}
