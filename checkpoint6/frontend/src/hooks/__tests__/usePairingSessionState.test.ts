import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePairingSessionState } from '../usePairingSessionState';

const TEST_KEY = 'test_pairing_session_key';

describe('usePairingSessionState', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('returns the default value when sessionStorage is empty', () => {
    const { result } = renderHook(() =>
      usePairingSessionState(TEST_KEY, 'default'),
    );
    expect(result.current[0]).toBe('default');
  });

  it('persists value to sessionStorage on set', () => {
    const { result } = renderHook(() =>
      usePairingSessionState(TEST_KEY, 'default'),
    );
    act(() => {
      result.current[1]('new-value');
    });
    expect(sessionStorage.getItem(TEST_KEY)).toBe('"new-value"');
    expect(result.current[0]).toBe('new-value');
  });

  it('restores value from sessionStorage on init', () => {
    sessionStorage.setItem(TEST_KEY, '"stored-value"');
    const { result } = renderHook(() =>
      usePairingSessionState(TEST_KEY, 'default'),
    );
    expect(result.current[0]).toBe('stored-value');
  });

  it('supports functional updates', () => {
    const { result } = renderHook(() =>
      usePairingSessionState<number>(TEST_KEY, 0),
    );
    act(() => {
      result.current[1]((prev) => prev + 1);
    });
    expect(result.current[0]).toBe(1);
    expect(sessionStorage.getItem(TEST_KEY)).toBe('1');
  });

  it('falls back to default when sessionStorage has invalid JSON', () => {
    sessionStorage.setItem(TEST_KEY, '{invalid');
    const { result } = renderHook(() =>
      usePairingSessionState(TEST_KEY, 'fallback'),
    );
    expect(result.current[0]).toBe('fallback');
  });

  it('survives sessionStorage quota error', () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    const { result } = renderHook(() =>
      usePairingSessionState(TEST_KEY, 'default'),
    );
    act(() => {
      result.current[1]('value');
    });
    expect(result.current[0]).toBe('value');
    setItemSpy.mockRestore();
  });
});
