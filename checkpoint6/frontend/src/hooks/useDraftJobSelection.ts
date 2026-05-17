/**
 * @deprecated Use `useDraftJobSelectionApi` from `./useDraftJobSelectionApi` instead.
 *
 * This legacy hook now delegates to the backend API-driven hook.
 * The source of truth is the backend, not localStorage.
 *
 * Kept for backward compatibility with callers that haven't been
 * migrated yet, and for test code that references this name.
 */

import { useDraftJobSelectionApi } from './useDraftJobSelectionApi';

export function useDraftJobSelection() {
  return useDraftJobSelectionApi();
}
