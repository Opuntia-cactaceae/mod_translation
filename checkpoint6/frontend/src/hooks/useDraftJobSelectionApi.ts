/* ------------------------------------------------------------------ */
/*  Hook: useDraftJobSelectionApi                                      */
/*                                                                     */
/*  Thin wrapper over the shared DraftJobSelectionContext.             */
/*  Exists for backward compatibility — new code should use             */
/*  useDraftJobSelection from contexts/DraftJobSelectionContext.        */
/*                                                                     */
/*  Single source of truth for the "draft job" file selection state    */
/*  — the backend owns the state, the shared context provides a        */
/*  reactive read/write interface via the REST API.                    */
/*                                                                     */
/*  All consumers share the SAME state instance through the context    */
/*  provider mounted at the app root, eliminating cross-component      */
/*  desync bugs.                                                       */
/* ------------------------------------------------------------------ */

import type { DraftFileMeta, DraftJobSelectionContextType } from '../contexts/DraftJobSelectionContext';
import { useDraftJobSelection } from '../contexts/DraftJobSelectionContext';

export type { DraftFileMeta };
export type { DraftJobSelectionContextType as UseDraftJobSelectionApiReturn };

/**
 * Hook providing the draft job selection API.
 *
 * This now delegates to the shared DraftJobSelectionContext so that
 * ALL consumers (ModListSection, CreateJobForm, etc.) see the same
 * state.  The backend is the source of truth; every mutation calls
 * the REST API and updates the shared context state from the response.
 */
export function useDraftJobSelectionApi(): DraftJobSelectionContextType {
  return useDraftJobSelection();
}
