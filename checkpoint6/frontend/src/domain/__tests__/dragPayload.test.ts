/* ------------------------------------------------------------------ */
/*  Tests: dragPayload helpers                                         */
/* ------------------------------------------------------------------ */

import { describe, it, expect } from 'vitest';
import {
  PAIRING_FILE_DRAG_TYPE,
  setDragFilePayload,
  getDragFilePayload,
} from '../dragPayload';

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function createDataTransfer(): DataTransfer {
  return new DataTransfer();
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('setDragFilePayload / getDragFilePayload', () => {
  it('serializes and deserializes a valid payload', () => {
    const dt = createDataTransfer();
    const payload = {
      fileId: 'file-123',
      relativePath: 'localisation/english/events.yml',
      fileName: 'events.yml',
      detectedRole: 'source',
      sourcePairId: null as null,
      sourceSlot: null as null,
    };

    setDragFilePayload(dt, payload);

    const result = getDragFilePayload(dt);
    expect(result).not.toBeNull();
    expect(result!.fileId).toBe('file-123');
    expect(result!.relativePath).toBe('localisation/english/events.yml');
    expect(result!.fileName).toBe('events.yml');
    expect(result!.detectedRole).toBe('source');
    expect(result!.sourcePairId).toBeNull();
    expect(result!.sourceSlot).toBeNull();
  });

  it('serializes payload without optional fields', () => {
    const dt = createDataTransfer();
    const payload = {
      fileId: 'file-456',
      relativePath: 'locale/french/common.yml',
      sourcePairId: null as null,
      sourceSlot: null as null,
    };

    setDragFilePayload(dt, payload);

    const result = getDragFilePayload(dt);
    expect(result).not.toBeNull();
    expect(result!.fileId).toBe('file-456');
    expect(result!.relativePath).toBe('locale/french/common.yml');
    expect(result!.fileName).toBeUndefined();
    expect(result!.detectedRole).toBeNull();
  });

  it('returns null when no data is set', () => {
    const dt = createDataTransfer();
    expect(getDragFilePayload(dt)).toBeNull();
  });

  it('returns null for data set with a different type', () => {
    const dt = createDataTransfer();
    dt.setData('text/plain', 'hello');
    expect(getDragFilePayload(dt)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const dt = createDataTransfer();
    // Manually set invalid JSON
    dt.setData(PAIRING_FILE_DRAG_TYPE, '{invalid json}');
    expect(getDragFilePayload(dt)).toBeNull();
  });

  it('returns null when required fileId field is missing', () => {
    const dt = createDataTransfer();
    dt.setData(PAIRING_FILE_DRAG_TYPE, JSON.stringify({ relativePath: 'foo.txt' }));
    expect(getDragFilePayload(dt)).toBeNull();
  });

  it('returns null when required relativePath field is missing', () => {
    const dt = createDataTransfer();
    dt.setData(PAIRING_FILE_DRAG_TYPE, JSON.stringify({ fileId: 'f1' }));
    expect(getDragFilePayload(dt)).toBeNull();
  });

  it('returns null when fileId is not a string', () => {
    const dt = createDataTransfer();
    dt.setData(PAIRING_FILE_DRAG_TYPE, JSON.stringify({ fileId: 123, relativePath: 'foo' }));
    expect(getDragFilePayload(dt)).toBeNull();
  });
});
