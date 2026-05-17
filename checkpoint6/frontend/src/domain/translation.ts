import type { TranslationPlanPreviewResponse } from "../api/types";

/* ------------------------------------------------------------------ */
/*  Domain models                                                      */
/* ------------------------------------------------------------------ */

export interface PendingTranslation {
  files: string[];
  sourceName?: string;
  modName?: string; // legacy alias
  gameConfig?: Record<string, unknown>;
}

export function getPendingSourceName(pending: {
  sourceName?: string;
  modName?: string;
}): string | undefined {
  return pending.sourceName ?? pending.modName;
}

export interface TranslationPreviewModel {
  totalUnits: number;
  totalTasks: number;
  batchSize: number;
  cacheHits: number;
  cacheMisses: number;
  diagnostics: unknown[];
  // --- Preflight diagnostics ---
  warnings: string[];
  errors: string[];
  unsupportedFiles: string[];
  duplicateFiles: string[];
  emptyFiles: string[];
  zeroUnitFiles: string[];
  detectedLanguages: string[];
  hasBlockingErrors: boolean;
}

/* ------------------------------------------------------------------ */
/*  DTO → Domain mapper                                                */
/* ------------------------------------------------------------------ */

export function mapTranslationPreview(
  dto: TranslationPlanPreviewResponse,
): TranslationPreviewModel {
  return {
    totalUnits: dto.total_units,
    totalTasks: dto.total_tasks,
    batchSize: dto.batch_size,
    cacheHits: dto.cache_hits,
    cacheMisses: dto.cache_misses,
    diagnostics: [...(dto.diagnostics ?? [])],
    warnings: dto.warnings ?? [],
    errors: dto.errors ?? [],
    unsupportedFiles: dto.unsupported_files ?? [],
    duplicateFiles: dto.duplicate_files ?? [],
    emptyFiles: dto.empty_files ?? [],
    zeroUnitFiles: dto.zero_unit_files ?? [],
    detectedLanguages: dto.detected_languages ?? [],
    hasBlockingErrors: dto.has_blocking_errors ?? false,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function hasBlockingDiagnostics(preview: TranslationPreviewModel): boolean {
  return preview.hasBlockingErrors;
}

export function canStartTranslation(preview: TranslationPreviewModel): boolean {
  return preview.totalUnits > 0 && !preview.hasBlockingErrors;
}

export function getPreviewProblemCount(preview: TranslationPreviewModel): number {
  return (
    (preview.warnings?.length ?? 0) +
    (preview.errors?.length ?? 0) +
    (preview.unsupportedFiles?.length ?? 0) +
    (preview.duplicateFiles?.length ?? 0) +
    (preview.emptyFiles?.length ?? 0) +
    (preview.zeroUnitFiles?.length ?? 0)
  );
}
