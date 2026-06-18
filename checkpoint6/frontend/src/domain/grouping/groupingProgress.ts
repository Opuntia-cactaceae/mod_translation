/* ------------------------------------------------------------------ */
/*  Shared grouping domain — group progress utilities                  */
/*                                                                      */
/*  Computes per-group progress (how many files are already in draft)   */
/*  for displaying badges on group headers.                             */
/* ------------------------------------------------------------------ */

export interface GroupProgress {
  totalFiles: number;
  addedFiles: number;
  allAdded: boolean;
  partialAdded: boolean;
  fractionLabel: string;
}

/**
 * Compute progress for a group's files against a set of draft paths.
 *
 * @param groupFiles - The files in the group.
 * @param draftPathSet - Normalised set of file paths already in the draft.
 * @param normalizeFn - Function to normalise file paths for comparison.
 */
export function computeGroupProgress(
  groupFiles: string[],
  draftPathSet: Set<string>,
  normalizeFn: (path: string) => string,
): GroupProgress {
  const totalFiles = groupFiles.length;
  const addedFiles = groupFiles.filter(f => draftPathSet.has(normalizeFn(f))).length;

  return {
    totalFiles,
    addedFiles,
    allAdded: addedFiles === totalFiles && totalFiles > 0,
    partialAdded: addedFiles > 0 && addedFiles < totalFiles,
    fractionLabel: `${addedFiles}/${totalFiles}`,
  };
}
