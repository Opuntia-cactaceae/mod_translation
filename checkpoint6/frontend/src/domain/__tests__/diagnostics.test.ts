import { describe, it, expect } from 'vitest';
import { mapDiagnosticItem, mapDiagnosticItems } from '../diagnostics';

/* ================================================================== */
/*  mapDiagnosticItem                                                   */
/* ================================================================== */

describe('mapDiagnosticItem', () => {
  it('returns a DiagnosticItem for a valid object', () => {
    const result = mapDiagnosticItem({ level: 'warning', message: 'Some warning' });
    expect(result).toEqual({ level: 'warning', message: 'Some warning', code: undefined });
  });

  it('includes code when present', () => {
    const result = mapDiagnosticItem({ level: 'error', message: 'Bad things', code: 'ERR_001' });
    expect(result).toEqual({ level: 'error', message: 'Bad things', code: 'ERR_001' });
  });

  it('returns null for null', () => {
    expect(mapDiagnosticItem(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(mapDiagnosticItem(undefined)).toBeNull();
  });

  it('returns null for a number', () => {
    expect(mapDiagnosticItem(42)).toBeNull();
  });

  it('returns null for a string', () => {
    expect(mapDiagnosticItem('hello')).toBeNull();
  });

  it('returns null when level is missing', () => {
    expect(mapDiagnosticItem({ message: 'msg' })).toBeNull();
  });

  it('returns null when message is missing', () => {
    expect(mapDiagnosticItem({ level: 'info' })).toBeNull();
  });

  it('returns null when level is not a string', () => {
    expect(mapDiagnosticItem({ level: 123, message: 'msg' })).toBeNull();
  });

  it('handles extra fields gracefully', () => {
    const result = mapDiagnosticItem({ level: 'info', message: 'OK', code: 'INF_01', batch_index: 5, details: { foo: 'bar' } });
    expect(result).toEqual({ level: 'info', message: 'OK', code: 'INF_01' });
  });
});

/* ================================================================== */
/*  mapDiagnosticItems                                                  */
/* ================================================================== */

describe('mapDiagnosticItems', () => {
  it('returns empty array for null', () => {
    expect(mapDiagnosticItems(null as unknown as unknown[])).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(mapDiagnosticItems(undefined as unknown as unknown[])).toEqual([]);
  });

  it('returns empty array for empty array', () => {
    expect(mapDiagnosticItems([])).toEqual([]);
  });

  it('maps valid items and filters out invalid ones', () => {
    const input = [
      { level: 'error', message: 'Err 1' },
      null,
      { level: 'warning', message: 'Warn 1', code: 'W_01' },
      'not an object',
      { level: 'info', message: 'Info 1' },
    ];
    const result = mapDiagnosticItems(input);
    expect(result).toEqual([
      { level: 'error', message: 'Err 1', code: undefined },
      { level: 'warning', message: 'Warn 1', code: 'W_01' },
      { level: 'info', message: 'Info 1', code: undefined },
    ]);
  });

  it('filters out all invalid items', () => {
    const input = [null, 'bad', 42, { level: 'info' }, { message: 'no level' }];
    expect(mapDiagnosticItems(input)).toEqual([]);
  });
});
