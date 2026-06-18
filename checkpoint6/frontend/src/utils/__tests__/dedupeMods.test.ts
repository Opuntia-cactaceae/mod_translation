/* ------------------------------------------------------------------ */
/*  dedupeMods — unit tests                                            */
/* ------------------------------------------------------------------ */

import { describe, it, expect } from 'vitest';
import { dedupeMods } from '../dedupeMods';
import type { ModInfoSchema } from '../../api/types';

function makeMod(overrides: Partial<ModInfoSchema>): ModInfoSchema {
  return {
    name: 'Test Mod',
    mod_id: 'mod-1',
    path: '/path/to/mod',
    game_id: 'stellaris',
    version: '1.0',
    supported_version: '3.0',
    tags: [],
    is_valid: true,
    source: 'steam_workshop',
    localisation_paths: [],
    diagnostics: [],
    installed: true,
    install_action: 'none',
    install_conflict: false,
    ...overrides,
  };
}

describe('dedupeMods', () => {
  it('returns empty array for empty input', () => {
    expect(dedupeMods([])).toEqual([]);
  });

  it('keeps a single mod unchanged', () => {
    const mod = makeMod({ mod_id: 'mod-1' });
    expect(dedupeMods([mod])).toEqual([mod]);
  });

  it('deduplicates by path when mod_id collides (keeps both, different paths)', () => {
    const a = makeMod({ mod_id: 'mod-1', path: '/path/a', name: 'First' });
    const b = makeMod({ mod_id: 'mod-1', path: '/path/b', name: 'Different Path' });
    const result = dedupeMods([a, b]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('First');
    expect(result[1].name).toBe('Different Path');
  });

  it('deduplicates by exact same path (keeps first occurrence)', () => {
    const a = makeMod({ mod_id: 'mod-1', path: '/path/a', name: 'First' });
    const b = makeMod({ mod_id: 'mod-1', path: '/path/a', name: 'Duplicate' });
    const result = dedupeMods([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('First');
  });

  it('deduplicates by installed_path when path and mod_id are empty', () => {
    const a = makeMod({ mod_id: '', path: '', installed_path: '/path/a', name: 'First' });
    const b = makeMod({ mod_id: '', path: '', installed_path: '/path/a', name: 'Duplicate' });
    const c = makeMod({ mod_id: '', path: '', installed_path: '/path/b', name: 'Other' });
    const result = dedupeMods([a, b, c]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('First');
    expect(result[1].name).toBe('Other');
  });

  it('deduplicates by path when mod_id and installed_path are empty', () => {
    const a = makeMod({ mod_id: '', installed_path: '', path: '/path/a', name: 'First' });
    const b = makeMod({ mod_id: '', installed_path: '', path: '/path/a', name: 'Duplicate' });
    const result = dedupeMods([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('First');
  });

  it('uses name+version+path fallback key when all id fields are empty', () => {
    const a = makeMod({
      mod_id: '',
      installed_path: '',
      path: '',
      name: 'Mod A',
      version: '1.0',
    });
    const b = makeMod({
      mod_id: '',
      installed_path: '',
      path: '',
      name: 'Mod A',
      version: '1.0',
    });
    const c = makeMod({
      mod_id: '',
      installed_path: '',
      path: '',
      name: 'Mod A',
      version: '2.0',
    });
    const result = dedupeMods([a, b, c]);
    expect(result).toHaveLength(2);
  });

  it('handles mixed duplicates: keeps mods with different paths even if same mod_id', () => {
    const mods = [
      makeMod({ mod_id: 'id-1', path: '/path/1', name: 'A' }),
      makeMod({ mod_id: 'id-1', path: '/path/different', name: 'Same id, diff path' }),
      makeMod({ mod_id: 'id-2', path: '/path/2', name: 'B' }),
      makeMod({ mod_id: '', path: '/path/3', name: 'C' }),
      makeMod({ mod_id: '', path: '/path/3', name: 'Dup by path' }),
    ];
    const result = dedupeMods(mods);
    // A and "Same id, diff path" now both survive (different paths)
    expect(result).toHaveLength(4);
    expect(result[0].name).toBe('A');
    expect(result[1].name).toBe('Same id, diff path');
    expect(result[2].name).toBe('B');
    expect(result[3].name).toBe('C');
  });

  it('keeps mods with same mod_id and different paths when paths are unique', () => {
    const mods = [
      makeMod({ mod_id: 'shared-id', path: '/workshop/a', name: 'Workshop Copy' }),
      makeMod({ mod_id: 'shared-id', path: '/local/b', name: 'Local Copy' }),
    ];
    const result = dedupeMods(mods);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Workshop Copy');
    expect(result[1].name).toBe('Local Copy');
  });

  it('preserves order (stable, keeps first occurrence)', () => {
    const mods = [
      makeMod({ mod_id: 'id-2', path: '/path/second', name: 'Second-first' }),
      makeMod({ mod_id: 'id-1', path: '/path/first', name: 'First' }),
      makeMod({ mod_id: 'id-2', path: '/path/second', name: 'Second-dup' }),
      makeMod({ mod_id: 'id-1', path: '/path/first', name: 'First-dup' }),
    ];
    const result = dedupeMods(mods);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Second-first');
    expect(result[1].name).toBe('First');
  });
});
