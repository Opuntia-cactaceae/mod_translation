import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePairingStaleGuard } from '../usePairingStaleGuard';

describe('usePairingStaleGuard', () => {
  it('returns mountedRef.current = true initially', () => {
    const { result } = renderHook(() => usePairingStaleGuard());
    expect(result.current.mountedRef.current).toBe(true);
  });

  it('sets mountedRef.current = false on unmount', () => {
    const { result, unmount } = renderHook(() => usePairingStaleGuard());
    expect(result.current.mountedRef.current).toBe(true);
    unmount();
    expect(result.current.mountedRef.current).toBe(false);
  });

  it('nextRequestId increments', () => {
    const { result } = renderHook(() => usePairingStaleGuard());
    const id1 = result.current.nextRequestId();
    const id2 = result.current.nextRequestId();
    expect(id2).toBe(id1 + 1);
  });

  it('isLatest returns true for current request ID', () => {
    const { result } = renderHook(() => usePairingStaleGuard());
    const id = result.current.nextRequestId();
    expect(result.current.isLatest(id)).toBe(true);
  });

  it('isLatest returns false for stale request IDs', () => {
    const { result } = renderHook(() => usePairingStaleGuard());
    const oldId = result.current.nextRequestId();
    result.current.nextRequestId(); // create a newer ID
    expect(result.current.isLatest(oldId)).toBe(false);
  });

  it('reset clears the request ID counter', () => {
    const { result } = renderHook(() => usePairingStaleGuard());
    result.current.nextRequestId();
    result.current.nextRequestId();
    result.current.reset();
    expect(result.current.currentRequestId()).toBe(0);
  });

  it('mountedRef is false after unmount and isLatest still works', () => {
    const { result, unmount } = renderHook(() => usePairingStaleGuard());
    const id = result.current.nextRequestId();
    unmount();
    expect(result.current.mountedRef.current).toBe(false);
    expect(result.current.isLatest(id)).toBe(true);
  });
});
