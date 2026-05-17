/* ------------------------------------------------------------------ */
/*  Domain model                                                       */
/* ------------------------------------------------------------------ */

export interface TraceModel {
  jobId: string;
  status: string;
  currentBatchIndex: number;
  totalBatches: number;
  processedUnits: number;
  totalUnits: number;
  currentActivity?: string;
  recentEvents: TraceEventModel[];
  stats?: TraceStatsModel;
}

export interface TraceEventModel {
  id: string;
  jobId?: string;
  eventType: string;
  timestamp: string;
  severity?: 'info' | 'warn' | 'error' | 'debug';
  message?: string;
  data?: unknown;
  batchIndex?: number;
}

export interface TraceStatsModel {
  totalEvents: number;
  unitTranslated: number;
  retries: number;
  fallbacks: number;
  errors: number;
  failedUnits?: number;
  cacheHits?: number;
}

export interface TraceUnitModel {
  unitId: string;
  filePath: string;
  key: string;
  sourceText: string;
  translatedText: string;
  status: 'pending' | 'sent' | 'translated' | 'failed' | 'cached';
  errorMessage: string;
  batchIndex: number;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/*  DTO → Domain mappers                                               */
/* ------------------------------------------------------------------ */

import type { TraceSnapshot, TraceEvent, TraceStats, TraceUnitResponse } from "../api/types";

export function mapTraceSnapshot(dto: TraceSnapshot): TraceModel {
  return {
    jobId: dto.job_id,
    status: dto.status,
    currentBatchIndex: dto.current_batch_index,
    totalBatches: dto.total_batches,
    processedUnits: dto.processed_units,
    totalUnits: dto.total_units,
    currentActivity: dto.current_activity || undefined,
    recentEvents: (dto.recent_events ?? []).map(e => mapTraceEvent(e)),
    stats: dto.stats ? mapTraceStats(dto.stats) : undefined,
  };
}

export function mapTraceEvent(dto: TraceEvent): TraceEventModel {
  return {
    id: dto.id,
    jobId: dto.job_id || undefined,
    eventType: dto.event_type,
    timestamp: dto.timestamp,
    severity: dto.severity || undefined,
    message: dto.message || undefined,
    data: dto.data ?? undefined,
    batchIndex: dto.batch_index ?? undefined,
  };
}

export function mapTraceStats(dto: TraceStats): TraceStatsModel {
  return {
    totalEvents: dto.total_events,
    unitTranslated: dto.unit_translated,
    retries: dto.retries,
    fallbacks: dto.fallbacks,
    errors: dto.errors,
    failedUnits: dto.failed_units ?? 0,
    cacheHits: dto.cache_hits ?? 0,
  };
}

export function mapTraceUnitResponse(dto: TraceUnitResponse): TraceUnitModel {
  return {
    unitId: dto.unit_id,
    filePath: dto.file_path,
    key: dto.key,
    sourceText: dto.source_text,
    translatedText: dto.translated_text,
    status: dto.status,
    errorMessage: dto.error_message,
    batchIndex: dto.batch_index,
    updatedAt: dto.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function isTraceActive(trace: TraceModel): boolean {
  return trace.status === "running" || trace.status === "paused";
}

export function getTraceStatus(trace: TraceModel): string {
  return trace.status;
}

export function getTraceEventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    'job_started': 'Job started',
    'job_completed': 'Job completed',
    'job_failed': 'Job failed',
    'batch_started': 'Batch started',
    'batch_completed': 'Batch completed',
    'batch_failed': 'Batch failed',
    'retry_attempt': 'Retry',
    'fallback_started': 'Fallback started',
    'fallback_completed': 'Fallback completed',
    'prompt_built': 'Prompt built',
    'runtime_request_started': 'API request',
    'runtime_response_received': 'API response',
    'response_parsed': 'Response parsed',
    'unit_translated': 'Unit translated',
    'unit_failed': 'Unit failed',
    'cache_hit': 'Cache hit',
    'cache_miss': 'Cache miss',
  };
  return labels[eventType] || eventType;
}

export function getTraceEventBadgeClass(eventType: string): string {
  switch (eventType) {
    case 'job_started': case 'batch_started': case 'batch_completed':
      return 'badge-info';
    case 'retry_attempt': case 'batch_failed':
      return 'badge-warning';
    case 'job_failed': case 'unit_failed':
      return 'badge-error';
    case 'job_completed':
      return 'badge-success';
    case 'cache_hit':
      return 'badge-info';
    default:
      return 'badge-muted';
  }
}

export function getTraceCurrentActivity(trace: TraceModel): string {
  const activity = trace.currentActivity;
  if (!activity) return 'Processing...';
  return activity;
}

export function getTraceUnitBadgeClass(status: string): string {
  switch (status) {
    case 'translated': return 'badge-success';
    case 'failed':     return 'badge-error';
    case 'cached':     return 'badge-info';
    case 'sent':       return 'badge-warning';
    default:           return 'badge-muted';
  }
}

export function getTraceUnitStatusLabel(status: string): string {
  switch (status) {
    case 'translated': return 'Translated';
    case 'failed':     return 'Failed';
    case 'cached':     return 'Cached';
    case 'sent':       return 'Sent';
    default:           return 'Pending';
  }
}

/* ------------------------------------------------------------------ */
/*  Runtime status log helpers                                          */
/* ------------------------------------------------------------------ */

/** CSS badge class for the severity of a runtime event. */
export function getSeverityBadgeClass(severity?: string): string {
  switch (severity) {
    case 'error': return 'badge-error';
    case 'warn':  return 'badge-warning';
    case 'debug': return 'badge-muted';
    default:      return 'badge-info';
  }
}

/** Human-readable label for a severity level. */
export function getSeverityLabel(severity?: string): string {
  switch (severity) {
    case 'error': return 'ERROR';
    case 'warn':  return 'WARN';
    case 'debug': return 'DEBUG';
    default:      return 'INFO';
  }
}

/** Check whether a BATCH_COMPLETED event is clickable (has a detectable batch number). */
export function isClickableBatchEvent(ev: TraceEventModel): boolean {
  return ev.eventType === 'batch_completed' && extractBatchNo(ev) !== null;
}

/** Try to extract a batch number from a BATCH_COMPLETED event.
 *
 *  First checks the event-level ``batchIndex`` field (mapped from the
 *  backend ``TranslationTraceEvent.batch_index``), then falls back to
 *  scanning ``data`` for ``batch_index``, ``batch_no``, or ``batchIndex``
 *  (legacy backends that embed it in data).
 */
export function extractBatchNo(ev: TraceEventModel): number | null {
  if (ev.eventType !== 'batch_completed') return null;
  // Prefer the event-level batchIndex (mapped from backend model field)
  if (ev.batchIndex != null && typeof ev.batchIndex === 'number') return ev.batchIndex;
  // Fallback: scan data dict (legacy backends)
  const d = ev.data as Record<string, unknown> | undefined;
  if (d) {
    if (typeof d.batch_index === 'number') return d.batch_index;
    if (typeof d.batch_no === 'number') return d.batch_no;
    if (typeof d.batchIndex === 'number') return d.batchIndex;
  }
  return null;
}

/** @deprecated Use isClickableBatchEvent instead. */
export function isBatchCompletedEvent(ev: TraceEventModel): boolean {
  return isClickableBatchEvent(ev);
}

/** @deprecated Use extractBatchNo instead. */
export function getBatchNoFromEvent(ev: TraceEventModel): number | null {
  return extractBatchNo(ev);
}

/** Extract http_status from event data for runtime events. */
export function getHttpStatusFromEvent(ev: TraceEventModel): number | null {
  if (!ev.data || typeof ev.data !== 'object') return null;
  const d = ev.data as Record<string, unknown>;
  if (typeof d.http_status === 'number') return d.http_status;
  return null;
}

/** Extract retry_reason from event data. */
export function getRetryReasonFromEvent(ev: TraceEventModel): string | null {
  if (!ev.data || typeof ev.data !== 'object') return null;
  const d = ev.data as Record<string, unknown>;
  if (typeof d.retry_reason === 'string') return d.retry_reason;
  return null;
}

/** Get the event_type for runtime-event-specific badge coloring. */
export function getRuntimeEventBadgeClass(eventType: string): string {
  switch (eventType) {
    case 'runtime_request_started':   return 'badge-info';
    case 'runtime_response_received': return 'badge-info';
    case 'retry_attempt':             return 'badge-warning';
    case 'fallback_started':          return 'badge-warning';
    case 'fallback_completed':        return 'badge-info';
    case 'cache_hit':                 return 'badge-success';
    case 'cache_miss':                return 'badge-muted';
    default:                          return 'badge-muted';
  }
}
