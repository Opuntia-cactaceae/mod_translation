import { describe, it, expect } from 'vitest';
import {
  flattenSettings,
  nestSettings,
  getSettingValue,
  normalizeDashboardSettings,
} from '../settings';

/* ================================================================== */
/*  Nested API settings fixture                                        */
/* ================================================================== */

const NESTED_SETTINGS = {
  paths: {
    downloaded_mods_dir: '/Users/user/Documents/Paradox/Stellaris/mod',
    stellaris_mods_dir: '/Users/user/Documents/Paradox/Stellaris/mod',
    translations_output_dir: '/Users/user/Documents/trans_mod',
    app_cache_dir: '/Users/user/.cache/translator',
    stellaris_cache_path: '/Users/user/Documents/Paradox/Stellaris/cache',
  },
  language: {
    default_src_lang: 'en',
    default_dst_lang: 'ru',
  },
  runtime_defaults: {
    default_provider: 'groq',
    default_model: 'llama-3.3-70b-versatile',
    default_timeout_sec: 60,
    default_max_retries: 3,
    default_temperature: 0.0,
  },
  translation_defaults: {
    default_batch_size: 20,
    default_game: 'stellaris',
    default_file_handler: 'stellaris_localisation',
    default_use_cache: true,
  },
  cache: {
    translation_cache_enabled: true,
  },
  game_settings: {
    stellaris: {
      downloaded_mods_dir: '/Users/user/Documents/Paradox/Stellaris/mod',
      mods_dir: '/Users/user/Documents/Paradox/Stellaris/mod',
      cache_path: '/Users/user/Documents/Paradox/Stellaris/cache',
      default_file_handler: 'stellaris_localisation',
    },
    generic: {
      root_dir: '',
      output_dir: '',
      default_file_handler: 'plain_text',
    },
  },
  schema_version: 1,
  updated_at: '2024-06-01T12:00:00Z',
};

const EMPTY_NESTED = {
  paths: {},
  language: {},
  runtime_defaults: {},
  translation_defaults: {},
  cache: {},
  game_settings: {
    stellaris: {},
    generic: {},
  },
};

/* ================================================================== */
/*  flattenSettings                                                     */
/* ================================================================== */

describe('flattenSettings', () => {
  it('maps nested paths to flat keys', () => {
    const flat = flattenSettings(NESTED_SETTINGS);
    expect(flat.downloaded_mods_dir).toBe('/Users/user/Documents/Paradox/Stellaris/mod');
    expect(flat.stellaris_mods_dir).toBe('/Users/user/Documents/Paradox/Stellaris/mod');
    expect(flat.translations_output_dir).toBe('/Users/user/Documents/trans_mod');
    expect(flat.app_cache_dir).toBe('/Users/user/.cache/translator');
    expect(flat.stellaris_cache_path).toBe('/Users/user/Documents/Paradox/Stellaris/cache');
  });

  it('maps nested language settings to flat keys', () => {
    const flat = flattenSettings(NESTED_SETTINGS);
    expect(flat.default_src_lang).toBe('en');
    expect(flat.default_dst_lang).toBe('ru');
  });

  it('maps nested runtime defaults to flat keys', () => {
    const flat = flattenSettings(NESTED_SETTINGS);
    expect(flat.default_provider).toBe('groq');
    expect(flat.default_model).toBe('llama-3.3-70b-versatile');
  });

  it('maps nested translation defaults to flat keys', () => {
    const flat = flattenSettings(NESTED_SETTINGS);
    expect(flat.default_batch_size).toBe(20);
    expect(flat.default_game).toBe('stellaris');
    expect(flat.default_file_handler).toBe('stellaris_localisation');
  });

  it('maps nested cache settings', () => {
    const flat = flattenSettings(NESTED_SETTINGS);
    expect(flat.cache_enabled).toBe(true);
  });

  it('maps nested game_settings to flat gs_ keys', () => {
    const flat = flattenSettings(NESTED_SETTINGS);
    expect(flat.gs_stellaris_downloaded_mods_dir).toBe('/Users/user/Documents/Paradox/Stellaris/mod');
    expect(flat.gs_stellaris_mods_dir).toBe('/Users/user/Documents/Paradox/Stellaris/mod');
    expect(flat.gs_generic_default_file_handler).toBe('plain_text');
  });

  it('passes through schema_version and updated_at', () => {
    const flat = flattenSettings(NESTED_SETTINGS);
    expect(flat.schema_version).toBe(1);
    expect(flat.updated_at).toBe('2024-06-01T12:00:00Z');
  });

  it('handles empty/missing sections gracefully', () => {
    const flat = flattenSettings(EMPTY_NESTED);
    expect(flat.downloaded_mods_dir).toBeUndefined();
    expect(flat.default_provider).toBeUndefined();
    expect(flat.cache_enabled).toBeUndefined();
  });

  it('returns undefined for missing values', () => {
    const flat = flattenSettings({});
    Object.values(flat).forEach(v => {
      expect(v).toBeUndefined();
    });
  });
});

/* ================================================================== */
/*  nestSettings                                                        */
/* ================================================================== */

describe('nestSettings', () => {
  it('reconstructs nested structure from flat keys', () => {
    const flat = flattenSettings(NESTED_SETTINGS);
    const nested = nestSettings(flat) as Record<string, Record<string, unknown>>;

    expect((nested.paths?.downloaded_mods_dir as string)).toBe('/Users/user/Documents/Paradox/Stellaris/mod');
    expect((nested.language?.default_src_lang as string)).toBe('en');
    expect((nested.runtime_defaults?.default_provider as string)).toBe('groq');
    expect((nested.translation_defaults?.default_batch_size as number)).toBe(20);
    expect((nested.cache?.translation_cache_enabled as boolean)).toBe(true);
  });

  it('only includes keys that were present in flat', () => {
    const nested = nestSettings({ default_src_lang: 'fr' }) as Record<string, Record<string, unknown>>;
    expect((nested.language?.default_src_lang as string)).toBe('fr');
    // Other sections should not have keys set
    expect((nested.paths?.downloaded_mods_dir as string | undefined)).toBeUndefined();
  });

  it('handles empty flat', () => {
    const nested = nestSettings({}) as Record<string, Record<string, unknown>>;
    expect(typeof nested.paths).toBe('object');
    expect(typeof nested.language).toBe('object');
  });
});

/* ================================================================== */
/*  getSettingValue                                                     */
/* ================================================================== */

describe('getSettingValue', () => {
  it('reads flat keys directly', () => {
    const val = getSettingValue({ downloaded_mods_dir: '/custom/path' }, 'downloaded_mods_dir');
    expect(val).toBe('/custom/path');
  });

  it('reads nested keys via FLAT_TO_NESTED mapping', () => {
    const val = getSettingValue(NESTED_SETTINGS, 'downloaded_mods_dir');
    expect(val).toBe('/Users/user/Documents/Paradox/Stellaris/mod');
  });

  it('reads language keys from nested structure', () => {
    expect(getSettingValue(NESTED_SETTINGS, 'default_src_lang')).toBe('en');
    expect(getSettingValue(NESTED_SETTINGS, 'default_dst_lang')).toBe('ru');
  });

  it('reads provider from nested structure', () => {
    expect(getSettingValue(NESTED_SETTINGS, 'default_provider')).toBe('groq');
  });

  it('returns undefined for missing key', () => {
    expect(getSettingValue(NESTED_SETTINGS, 'nonexistent_key')).toBeUndefined();
  });

  it('returns undefined for null/undefined settings', () => {
    expect(getSettingValue(undefined, 'downloaded_mods_dir')).toBeUndefined();
    expect(getSettingValue(null as any, 'downloaded_mods_dir')).toBeUndefined();
  });

  it('prefers flat key over nested when both exist', () => {
    const mixed = {
      ...NESTED_SETTINGS,
      downloaded_mods_dir: '/flat/path',
    };
    expect(getSettingValue(mixed, 'downloaded_mods_dir')).toBe('/flat/path');
  });
});

/* ================================================================== */
/*  normalizeDashboardSettings                                          */
/* ================================================================== */

describe('normalizeDashboardSettings', () => {
  it('flattens nested settings when paths key exists', () => {
    const flat = normalizeDashboardSettings(NESTED_SETTINGS);
    expect(flat.downloaded_mods_dir).toBe('/Users/user/Documents/Paradox/Stellaris/mod');
    expect(flat.default_src_lang).toBe('en');
  });

  it('passes through already-flat settings', () => {
    const flat = normalizeDashboardSettings({ downloaded_mods_dir: '/path' });
    expect(flat.downloaded_mods_dir).toBe('/path');
  });

  it('returns empty object for undefined', () => {
    expect(normalizeDashboardSettings(undefined)).toEqual({});
  });
});

/* ================================================================== */
/*  Dashboard display scenarios                                        */
/* ================================================================== */

describe('Dashboard display scenarios', () => {
  it('displays downloaded_mods_dir, stellaris_mods_dir, translations_output_dir', () => {
    const flat = flattenSettings(NESTED_SETTINGS);
    expect(flat.downloaded_mods_dir).toBeTruthy();
    expect(flat.stellaris_mods_dir).toBeTruthy();
    expect(flat.translations_output_dir).toBeTruthy();
  });

  it('displays default_src_lang, default_dst_lang, default_provider', () => {
    const flat = flattenSettings(NESTED_SETTINGS);
    expect(flat.default_src_lang).toBe('en');
    expect(flat.default_dst_lang).toBe('ru');
    expect(flat.default_provider).toBe('groq');
  });

  it('displays missing/null values as undefined (caller renders "Not set")', () => {
    const flat = flattenSettings(EMPTY_NESTED);
    expect(flat.downloaded_mods_dir).toBeUndefined();
    expect(flat.default_src_lang).toBeUndefined();
    expect(flat.default_provider).toBeUndefined();
  });

  it('Settings save/reload roundtrip preserves values', () => {
    const flat = flattenSettings(NESTED_SETTINGS);
    const nested = nestSettings(flat);
    const flatAgain = flattenSettings(nested);

    expect(flatAgain.downloaded_mods_dir).toBe(flat.downloaded_mods_dir);
    expect(flatAgain.default_src_lang).toBe(flat.default_src_lang);
    expect(flatAgain.default_provider).toBe(flat.default_provider);
    expect(flatAgain.default_batch_size).toBe(flat.default_batch_size);
    expect(flatAgain.cache_enabled).toBe(flat.cache_enabled);
  });
});
