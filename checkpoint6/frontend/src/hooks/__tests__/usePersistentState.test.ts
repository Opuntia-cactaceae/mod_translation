import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistentState } from '../usePersistentState';

/* ================================================================== */
/*  Note: these tests use the REAL usePersistentState (not mocked)     */
/*  to verify localStorage save/restore behaviour.                     */
/* ================================================================== */

const TEST_KEY = 'stellaris_translator.__test__expandedMods';

afterEach(() => {
  localStorage.removeItem(TEST_KEY);
});

describe('usePersistentState — localStorage save/restore', () => {
  it('initialises from defaultValue when localStorage is empty', () => {
    const { result } = renderHook(() =>
      usePersistentState<Record<string, boolean>>(TEST_KEY, {}),
    );
    expect(result.current[0]).toEqual({});
  });

  it('persists value to localStorage on change', () => {
    const { result } = renderHook(() =>
      usePersistentState<Record<string, boolean>>(TEST_KEY, {}),
    );

    act(() => {
      result.current[1]({ 'mod-1': true });
    });

    // Check localStorage directly
    const raw = localStorage.getItem(TEST_KEY);
    expect(raw).toBe(JSON.stringify({ 'mod-1': true }));
    // Hook value matches
    expect(result.current[0]).toEqual({ 'mod-1': true });
  });

  it('restores previously persisted value on remount', () => {
    // Seed localStorage
    localStorage.setItem(TEST_KEY, JSON.stringify({ 'mod-1': true, 'mod-2': false }));

    const { result } = renderHook(() =>
      usePersistentState<Record<string, boolean>>(TEST_KEY, {}),
    );

    expect(result.current[0]).toEqual({ 'mod-1': true, 'mod-2': false });
  });

  it('overwrites previous localStorage value on new change', () => {
    // Seed localStorage with expanded state
    localStorage.setItem(TEST_KEY, JSON.stringify({ 'mod-1': true }));

    const { result } = renderHook(() =>
      usePersistentState<Record<string, boolean>>(TEST_KEY, {}),
    );

    // Collapse mod-1
    act(() => {
      result.current[1]({ 'mod-1': false });
    });

    // localStorage should now have false
    const raw = localStorage.getItem(TEST_KEY);
    expect(JSON.parse(raw!)).toEqual({ 'mod-1': false });
    expect(result.current[0]).toEqual({ 'mod-1': false });
  });

  it('does not lose other keys when updating one key', () => {
    localStorage.setItem(TEST_KEY, JSON.stringify({ 'mod-1': true, 'mod-2': true }));

    const { result } = renderHook(() =>
      usePersistentState<Record<string, boolean>>(TEST_KEY, {}),
    );

    act(() => {
      result.current[1](prev => ({ ...prev, 'mod-1': false }));
    });

    expect(result.current[0]).toEqual({ 'mod-1': false, 'mod-2': true });
    const raw = localStorage.getItem(TEST_KEY);
    expect(JSON.parse(raw!)).toEqual({ 'mod-1': false, 'mod-2': true });
  });

  it('returns reset function that resets state to defaultValue and persists it', () => {
    localStorage.setItem(TEST_KEY, JSON.stringify({ 'mod-1': true }));

    const { result } = renderHook(() =>
      usePersistentState<Record<string, boolean>>(TEST_KEY, {}),
    );

    expect(result.current[0]).toEqual({ 'mod-1': true });

    act(() => {
      result.current[2](); // reset
    });

    // State is reset to defaultValue
    expect(result.current[0]).toEqual({});
    // The useEffect persist hook writes defaultValue back to localStorage,
    // so the key still exists with the default value
    expect(JSON.parse(localStorage.getItem(TEST_KEY)!)).toEqual({});
  });

  it('handles invalid JSON in localStorage gracefully', () => {
    localStorage.setItem(TEST_KEY, '{invalid json}');

    const { result } = renderHook(() =>
      usePersistentState<Record<string, boolean>>(TEST_KEY, {}),
    );

    // Falls back to defaultValue
    expect(result.current[0]).toEqual({});
  });

  it('migrates legacy key when new key is empty', () => {
    const legacyKey = `${TEST_KEY}_legacy`;
    localStorage.setItem(legacyKey, JSON.stringify({ 'mod-old': true }));

    const { result } = renderHook(() =>
      usePersistentState<Record<string, boolean>>(TEST_KEY, {}, {
        legacyKeys: [legacyKey],
      }),
    );

    // Should read from legacy key, migrate to new key
    expect(result.current[0]).toEqual({ 'mod-old': true });

    // New key should have the migrated data
    const newRaw = localStorage.getItem(TEST_KEY);
    expect(JSON.parse(newRaw!)).toEqual({ 'mod-old': true });
    // Legacy key should be removed
    expect(localStorage.getItem(legacyKey)).toBeNull();
  });
});

describe('usePersistentState — non-module persistence', () => {
  it('handles multiple independent keys without collision', () => {
    const keyA = `${TEST_KEY}.A`;
    const keyB = `${TEST_KEY}.B`;

    const { result: hookA } = renderHook(() =>
      usePersistentState<Record<string, boolean>>(keyA, {}),
    );
    const { result: hookB } = renderHook(() =>
      usePersistentState<Record<string, boolean>>(keyB, {}),
    );

    act(() => {
      hookA.current[1]({ x: true });
      hookB.current[1]({ y: false });
    });

    expect(JSON.parse(localStorage.getItem(keyA)!)).toEqual({ x: true });
    expect(JSON.parse(localStorage.getItem(keyB)!)).toEqual({ y: false });

    localStorage.removeItem(keyA);
    localStorage.removeItem(keyB);
  });

  it('survives full remount cycle', () => {
    // Simulate: mount → set state → unmount → remount → verify

    const key = TEST_KEY;

    // First mount
    const { result: mount1, unmount } = renderHook(() =>
      usePersistentState<Record<string, boolean>>(key, {}),
    );
    act(() => {
      mount1.current[1]({ mod: true });
    });
    expect(mount1.current[0]).toEqual({ mod: true });
    unmount();

    // Second mount (simulates navigating away and back)
    const { result: mount2 } = renderHook(() =>
      usePersistentState<Record<string, boolean>>(key, {}),
    );
    expect(mount2.current[0]).toEqual({ mod: true });

    // Change and verify
    act(() => {
      mount2.current[1]({ mod: false });
    });
    expect(mount2.current[0]).toEqual({ mod: false });
  });
});
