import { describe, it, expect } from 'vitest';
import {
  mapTraceUnitResponse,
  mapTraceEvent,
  getTraceUnitBadgeClass,
  getTraceUnitStatusLabel,
  isClickableBatchEvent,
  extractBatchNo,
  isBatchCompletedEvent,
  getBatchNoFromEvent,
  type TraceEventModel,
  type TraceUnitModel,
} from '../trace';
import type { TraceUnitResponse, TraceEvent } from '../../api/types';

describe('mapTraceUnitResponse', () => {
  it('maps a valid TraceUnitResponse to TraceUnitModel', () => {
    const dto: TraceUnitResponse = {
      unit_id: 'u1',
      file_path: '/path/file.yml',
      key: 'KEY_1',
      source_text: 'Hello',
      translated_text: 'Hola',
      status: 'translated',
      error_message: '',
      batch_index: 1,
      updated_at: '2025-01-01T12:00:00Z',
    };

    const model = mapTraceUnitResponse(dto);
    expect(model.unitId).toBe('u1');
    expect(model.filePath).toBe('/path/file.yml');
    expect(model.key).toBe('KEY_1');
    expect(model.sourceText).toBe('Hello');
    expect(model.translatedText).toBe('Hola');
    expect(model.status).toBe('translated');
    expect(model.errorMessage).toBe('');
    expect(model.batchIndex).toBe(1);
    expect(model.updatedAt).toBe('2025-01-01T12:00:00Z');
  });

  it('handles empty strings', () => {
    const dto: TraceUnitResponse = {
      unit_id: '',
      file_path: '',
      key: '',
      source_text: '',
      translated_text: '',
      status: 'pending',
      error_message: '',
      batch_index: 0,
      updated_at: '',
    };

    const model = mapTraceUnitResponse(dto);
    expect(model.unitId).toBe('');
    expect(model.sourceText).toBe('');
    expect(model.status).toBe('pending');
  });

  it('maps failed status with error message', () => {
    const dto: TraceUnitResponse = {
      unit_id: 'u-fail',
      file_path: '',
      key: '',
      source_text: 'Hello',
      translated_text: '',
      status: 'failed',
      error_message: 'Translation failed',
      batch_index: 1,
      updated_at: '2025-01-01T12:00:00Z',
    };

    const model = mapTraceUnitResponse(dto);
    expect(model.status).toBe('failed');
    expect(model.errorMessage).toBe('Translation failed');
  });

  it('maps cached status', () => {
    const dto: TraceUnitResponse = {
      unit_id: 'u-cached',
      file_path: '',
      key: '',
      source_text: 'Hello',
      translated_text: 'Hola',
      status: 'cached',
      error_message: '',
      batch_index: 0,
      updated_at: '2025-01-01T12:00:00Z',
    };

    const model = mapTraceUnitResponse(dto);
    expect(model.status).toBe('cached');
    expect(model.translatedText).toBe('Hola');
  });

  it('maps sent status', () => {
    const dto: TraceUnitResponse = {
      unit_id: 'u-sent',
      file_path: '',
      key: '',
      source_text: 'Hello',
      translated_text: '',
      status: 'sent',
      error_message: '',
      batch_index: 1,
      updated_at: '2025-01-01T12:00:00Z',
    };

    const model = mapTraceUnitResponse(dto);
    expect(model.status).toBe('sent');
    expect(model.translatedText).toBe('');
  });
});

describe('mapTraceEvent', () => {
  it('maps all fields including batch_index', () => {
    const dto: TraceEvent = {
      id: 'evt-1',
      job_id: 'job-1',
      event_type: 'batch_completed',
      timestamp: '2025-01-01T12:00:00Z',
      severity: 'info',
      message: 'Batch completed',
      data: { completed: 5, failed: 0 },
      batch_index: 17,
    };

    const model = mapTraceEvent(dto);
    expect(model.id).toBe('evt-1');
    expect(model.jobId).toBe('job-1');
    expect(model.eventType).toBe('batch_completed');
    expect(model.severity).toBe('info');
    expect(model.message).toBe('Batch completed');
    expect(model.batchIndex).toBe(17);
    expect(model.data).toEqual({ completed: 5, failed: 0 });
  });

  it('handles undefined batch_index', () => {
    const dto: TraceEvent = {
      id: 'evt-2',
      event_type: 'job_started',
      timestamp: '2025-01-01T12:00:00Z',
    };

    const model = mapTraceEvent(dto);
    expect(model.batchIndex).toBeUndefined();
  });

  it('handles batch_index = 0', () => {
    const dto: TraceEvent = {
      id: 'evt-3',
      event_type: 'batch_completed',
      timestamp: '2025-01-01T12:00:00Z',
      batch_index: 0,
    };

    const model = mapTraceEvent(dto);
    expect(model.batchIndex).toBe(0);
  });
});

describe('getTraceUnitBadgeClass', () => {
  it('returns badge-success for translated', () => {
    expect(getTraceUnitBadgeClass('translated')).toBe('badge-success');
  });

  it('returns badge-error for failed', () => {
    expect(getTraceUnitBadgeClass('failed')).toBe('badge-error');
  });

  it('returns badge-info for cached', () => {
    expect(getTraceUnitBadgeClass('cached')).toBe('badge-info');
  });

  it('returns badge-warning for sent', () => {
    expect(getTraceUnitBadgeClass('sent')).toBe('badge-warning');
  });

  it('returns badge-muted for pending', () => {
    expect(getTraceUnitBadgeClass('pending')).toBe('badge-muted');
  });

  it('returns badge-muted for unknown status', () => {
    expect(getTraceUnitBadgeClass('unknown')).toBe('badge-muted');
  });
});

describe('getTraceUnitStatusLabel', () => {
  it('returns "Translated" for translated', () => {
    expect(getTraceUnitStatusLabel('translated')).toBe('Translated');
  });

  it('returns "Failed" for failed', () => {
    expect(getTraceUnitStatusLabel('failed')).toBe('Failed');
  });

  it('returns "Cached" for cached', () => {
    expect(getTraceUnitStatusLabel('cached')).toBe('Cached');
  });

  it('returns "Sent" for sent', () => {
    expect(getTraceUnitStatusLabel('sent')).toBe('Sent');
  });

  it('returns "Pending" for pending', () => {
    expect(getTraceUnitStatusLabel('pending')).toBe('Pending');
  });

  it('returns "Pending" for unknown status', () => {
    expect(getTraceUnitStatusLabel('unknown')).toBe('Pending');
  });
});

describe('extractBatchNo', () => {
  it('extracts batch_index from event-level batchIndex field', () => {
    const ev: TraceEventModel = {
      id: 'e0', eventType: 'batch_completed', timestamp: '2025-01-01T12:00:00Z',
      batchIndex: 42,
    };
    expect(extractBatchNo(ev)).toBe(42);
  });

  it('prefers event-level batchIndex over data.batch_index', () => {
    const ev: TraceEventModel = {
      id: 'e0p', eventType: 'batch_completed', timestamp: '2025-01-01T12:00:00Z',
      batchIndex: 42,
      data: { batch_index: 1 },
    };
    expect(extractBatchNo(ev)).toBe(42);
  });

  it('extracts batch_index from event data (fallback)', () => {
    const ev: TraceEventModel = {
      id: 'e1', eventType: 'batch_completed', timestamp: '2025-01-01T12:00:00Z',
      data: { batch_index: 3 },
    };
    expect(extractBatchNo(ev)).toBe(3);
  });

  it('extracts batch_no from event data', () => {
    const ev: TraceEventModel = {
      id: 'e2', eventType: 'batch_completed', timestamp: '2025-01-01T12:00:00Z',
      data: { batch_no: 5 },
    };
    expect(extractBatchNo(ev)).toBe(5);
  });

  it('extracts batchIndex from event data (camelCase)', () => {
    const ev: TraceEventModel = {
      id: 'e3', eventType: 'batch_completed', timestamp: '2025-01-01T12:00:00Z',
      data: { batchIndex: 7 },
    };
    expect(extractBatchNo(ev)).toBe(7);
  });

  it('prefers batch_index in data over batch_no', () => {
    const ev: TraceEventModel = {
      id: 'e4', eventType: 'batch_completed', timestamp: '2025-01-01T12:00:00Z',
      data: { batch_index: 1, batch_no: 2, batchIndex: 3 },
    };
    expect(extractBatchNo(ev)).toBe(1);
  });

  it('returns null for non-batch_completed events', () => {
    const ev: TraceEventModel = {
      id: 'e5', eventType: 'job_started', timestamp: '2025-01-01T12:00:00Z',
    };
    expect(extractBatchNo(ev)).toBeNull();
  });

  it('returns null when data is undefined', () => {
    const ev: TraceEventModel = {
      id: 'e6', eventType: 'batch_completed', timestamp: '2025-01-01T12:00:00Z',
    };
    expect(extractBatchNo(ev)).toBeNull();
  });

  it('returns null when batch field is not a number', () => {
    const ev: TraceEventModel = {
      id: 'e7', eventType: 'batch_completed', timestamp: '2025-01-01T12:00:00Z',
      data: { batch_index: 'three' },
    };
    expect(extractBatchNo(ev)).toBeNull();
  });

  it('returns null when data has no batch field', () => {
    const ev: TraceEventModel = {
      id: 'e8', eventType: 'batch_completed', timestamp: '2025-01-01T12:00:00Z',
      data: { http_status: 200 },
    };
    expect(extractBatchNo(ev)).toBeNull();
  });
});

describe('isClickableBatchEvent', () => {
  it('returns true for batch_completed with batchIndex field', () => {
    const ev: TraceEventModel = {
      id: 'e0', eventType: 'batch_completed', timestamp: '2025-01-01T12:00:00Z',
      batchIndex: 17,
    };
    expect(isClickableBatchEvent(ev)).toBe(true);
  });

  it('returns true for batch_completed with batch_index in data', () => {
    const ev: TraceEventModel = {
      id: 'e1', eventType: 'batch_completed', timestamp: '2025-01-01T12:00:00Z',
      data: { batch_index: 2 },
    };
    expect(isClickableBatchEvent(ev)).toBe(true);
  });

  it('returns true for batch_completed with batch_no', () => {
    const ev: TraceEventModel = {
      id: 'e2', eventType: 'batch_completed', timestamp: '2025-01-01T12:00:00Z',
      data: { batch_no: 4 },
    };
    expect(isClickableBatchEvent(ev)).toBe(true);
  });

  it('returns false for non-batch_completed event', () => {
    const ev: TraceEventModel = {
      id: 'e3', eventType: 'job_started', timestamp: '2025-01-01T12:00:00Z',
    };
    expect(isClickableBatchEvent(ev)).toBe(false);
  });

  it('returns false for batch_completed without batch number in data', () => {
    const ev: TraceEventModel = {
      id: 'e4', eventType: 'batch_completed', timestamp: '2025-01-01T12:00:00Z',
      data: { http_status: 200 },
    };
    expect(isClickableBatchEvent(ev)).toBe(false);
  });

  it('returns false for batch_completed with undefined data', () => {
    const ev: TraceEventModel = {
      id: 'e5', eventType: 'batch_completed', timestamp: '2025-01-01T12:00:00Z',
    };
    expect(isClickableBatchEvent(ev)).toBe(false);
  });
});

describe('isBatchCompletedEvent (deprecated alias)', () => {
  it('delegates to isClickableBatchEvent', () => {
    const ev: TraceEventModel = {
      id: 'e1', eventType: 'batch_completed', timestamp: '2025-01-01T12:00:00Z',
      data: { batch_index: 2 },
    };
    expect(isBatchCompletedEvent(ev)).toBe(true);
  });
});

describe('getBatchNoFromEvent (deprecated alias)', () => {
  it('delegates to extractBatchNo', () => {
    const ev: TraceEventModel = {
      id: 'e1', eventType: 'batch_completed', timestamp: '2025-01-01T12:00:00Z',
      data: { batch_index: 3 },
    };
    expect(getBatchNoFromEvent(ev)).toBe(3);
  });
});
