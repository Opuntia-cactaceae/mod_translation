import { useState, useEffect, useCallback } from 'react';

interface UsePersistentStateOptions<T> {
  /**
   * Legacy key names to check during initialisation.
   * If the new key has no data but a legacy key does,
   * the value will be migrated: written under the new key
   * and the legacy key will be removed.
   */
  legacyKeys?: string[];
  /**
   * Transform the value during migration from a legacy key.
   * Useful when the value format has changed (e.g. adding prefixes to keys).
   */
  migrateLegacy?: (old: T) => T;
}

/**
 * A drop-in replacement for `useState` that persists the value
 * to `localStorage` under the given `key`.
 *
 * - Reads from `localStorage` on mount (lazy initializer).
 * - Falls back to `defaultValue` if JSON is malformed or the key is missing.
 * - Writes to `localStorage` on every change.
 * - Returns a third `reset` function that clears the stored value
 *   and resets state to `defaultValue`.
 * - Never throws if `localStorage` is unavailable (SSR, quota, etc.).
 */
export function usePersistentState<T>(
  key: string,
  defaultValue: T,
  options?: UsePersistentStateOptions<T>,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        return JSON.parse(raw) as T;
      }

      // Try legacy keys and migrate
      if (options?.legacyKeys) {
        for (const legacyKey of options.legacyKeys) {
          const legacyRaw = localStorage.getItem(legacyKey);
          if (legacyRaw !== null) {
            const parsed = JSON.parse(legacyRaw) as T;
            const migrated = options.migrateLegacy ? options.migrateLegacy(parsed) : parsed;
            // Migrate: write to new key, remove legacy
            localStorage.setItem(key, JSON.stringify(migrated));
            localStorage.removeItem(legacyKey);
            return migrated;
          }
        }
      }
    } catch {
      /* ignore parse/storage errors -> fall through to defaultValue */
    }
    return defaultValue;
  });

  // Persist to localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full / unavailable -> silently ignore */
    }
  }, [key, value]);

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    setValue(defaultValue);
  }, [key, defaultValue]);

  return [value, setValue, reset];
}
