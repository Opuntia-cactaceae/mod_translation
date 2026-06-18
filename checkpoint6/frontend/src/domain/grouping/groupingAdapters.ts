/* ------------------------------------------------------------------ */
/*  Shared grouping domain — adapters between unified and legacy modes  */
/*                                                                      */
/*  Provides bidirectional conversion between the unified GroupingMode  */
/*  and each consumer's native format (generic, pairing workspace).      */
/* ------------------------------------------------------------------ */

import type { GroupingMode } from './groupingTypes';

/* ---- Mappings ---- */

const GENERIC_TO_UNIFIED: Record<string, GroupingMode> = {
  folder: 'directory',
  filename: 'filename',
  language_marker: 'language',
  smart: 'smart',
};

const UNIFIED_TO_GENERIC: Record<GroupingMode, string> = {
  flat: 'flat',
  directory: 'folder',
  filename: 'filename',
  language: 'language_marker',
  smart: 'smart',
};

const UNIFIED_TO_PAIRING: Record<GroupingMode, string> = {
  flat: 'flat',
  directory: 'by_directory',
  filename: 'by_filename',
  language: 'by_language_marker',
  smart: 'by_filename',
};

const PAIRING_TO_UNIFIED: Record<string, GroupingMode> = {
  flat: 'flat',
  by_directory: 'directory',
  by_filename: 'filename',
  by_language_marker: 'language',
};

const UNIFIED_LABELS: Record<GroupingMode, string> = {
  flat: 'Flat (no grouping)',
  directory: 'Directory',
  filename: 'File name',
  language: 'Language marker',
  smart: 'Smart (filename families)',
};

/* ---- Adapter functions ---- */

/**
 * Convert any legacy mode string to the unified GroupingMode.
 * Falls back to 'smart' for unknown values.
 */
export function toUnifiedMode(mode: string): GroupingMode {
  if (mode in GENERIC_TO_UNIFIED) return GENERIC_TO_UNIFIED[mode];
  if (mode in PAIRING_TO_UNIFIED) return PAIRING_TO_UNIFIED[mode];
  return 'smart';
}

/**
 * Convert unified GroupingMode to generic file grouping mode string.
 */
export function fromUnifiedForGeneric(mode: GroupingMode): string {
  return UNIFIED_TO_GENERIC[mode] ?? 'smart';
}

/**
 * Convert unified GroupingMode to pairing workspace mode string.
 */
export function fromUnifiedForPairing(mode: GroupingMode): string {
  return UNIFIED_TO_PAIRING[mode] ?? 'by_filename';
}

/**
 * Human-readable label for a unified GroupingMode.
 */
export function groupingModeLabel(mode: GroupingMode): string {
  return UNIFIED_LABELS[mode];
}

/**
 * All GroupingMode values in display order.
 */
export function allGroupingModes(): GroupingMode[] {
  return ['flat', 'directory', 'filename', 'language', 'smart'];
}
