/* ------------------------------------------------------------------ */
/*  Typed SettingsModel — known settings groups                        */
/* ------------------------------------------------------------------ */

export interface PathsSettings {
  downloaded_mods_dir?: string;
  stellaris_mods_dir?: string;
  translations_output_dir?: string;
  app_cache_dir?: string;
  stellaris_cache_path?: string;
  [key: string]: unknown;
}

export interface LanguageSettings {
  default_src_lang?: string;
  default_dst_lang?: string;
  [key: string]: unknown;
}

export interface RuntimeDefaults {
  default_provider?: string;
  default_model?: string;
  max_retries?: number;
  timeout_sec?: number;
  max_completion_tokens?: number;
  [key: string]: unknown;
}

export interface TranslationDefaults {
  default_batch_size?: number;
  default_game?: string;
  default_file_handler?: string;
  [key: string]: unknown;
}

export interface CacheSettings {
  translation_cache_enabled?: boolean;
  [key: string]: unknown;
}

export interface StellarisGameSettings {
  downloaded_mods_dir?: string;
  mods_dir?: string;
  cache_path?: string;
  default_file_handler?: string;
  [key: string]: unknown;
}

export interface GenericGameSettings {
  root_dir?: string;
  output_dir?: string;
  default_file_handler?: string;
  [key: string]: unknown;
}

export interface GameSettingsModel {
  stellaris?: StellarisGameSettings;
  generic?: GenericGameSettings;
  [key: string]: unknown;
}

/**
 * Typed representation of the full API settings object.
 * Each known nested group has its own typed interface.
 * Unknown / future keys are preserved via `[key: string]: unknown`.
 */
export interface SettingsModel {
  paths?: PathsSettings;
  language?: LanguageSettings;
  runtime_defaults?: RuntimeDefaults;
  translation_defaults?: TranslationDefaults;
  cache?: CacheSettings;
  game_settings?: GameSettingsModel;
  schema_version?: number;
  updated_at?: string;
  [key: string]: unknown;
}

/**
 * Map raw API settings DTO to typed SettingsModel.
 * Returns the same object but with typed known groups.
 */
export function mapSettingsResponse(dto: Record<string, unknown>): SettingsModel {
  return dto as SettingsModel;
}

/* ------------------------------------------------------------------ */
/*  Shared settings mapper: nested API DTO ↔ flat display model       */
/* ------------------------------------------------------------------ */

/** Map of flat-form keys to their nested group.key path in the API */
export const FLAT_TO_NESTED: Record<string, string> = {
  'downloaded_mods_dir': 'paths.downloaded_mods_dir',
  'stellaris_mods_dir': 'paths.stellaris_mods_dir',
  'translations_output_dir': 'paths.translations_output_dir',
  'app_cache_dir': 'paths.app_cache_dir',
  'stellaris_cache_path': 'paths.stellaris_cache_path',
  'default_src_lang': 'language.default_src_lang',
  'default_dst_lang': 'language.default_dst_lang',
  'default_provider': 'runtime_defaults.default_provider',
  'default_model': 'runtime_defaults.default_model',
  'default_batch_size': 'translation_defaults.default_batch_size',
  'cache_enabled': 'cache.translation_cache_enabled',
  // Legacy compatibility fields. New code should use game_settings and profiles.
  'default_game': 'translation_defaults.default_game',
  'default_file_handler': 'translation_defaults.default_file_handler',
  // Game settings (multi-game layer)
  'gs_stellaris_downloaded_mods_dir': 'game_settings.stellaris.downloaded_mods_dir',
  'gs_stellaris_mods_dir': 'game_settings.stellaris.mods_dir',
  'gs_stellaris_cache_path': 'game_settings.stellaris.cache_path',
  'gs_stellaris_default_file_handler': 'game_settings.stellaris.default_file_handler',
  'gs_generic_root_dir': 'game_settings.generic.root_dir',
  'gs_generic_output_dir': 'game_settings.generic.output_dir',
  'gs_generic_default_file_handler': 'game_settings.generic.default_file_handler',
};

/**
 * Normalize a nested API settings dict into a flat key-value map.
 * Both the full settings dict (paths.language.default_src_lang) and
 * the top-level app-state shape (default_src_lang at root) are handled.
 */
export function flattenSettings(nested: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [flatKey, nestedPath] of Object.entries(FLAT_TO_NESTED)) {
    const parts = nestedPath.split('.');
    let val: unknown = nested;
    for (const part of parts) {
      if (val == null || typeof val !== 'object') { val = undefined; break; }
      val = (val as Record<string, unknown>)[part];
    }
    flat[flatKey] = val;
  }
  flat.schema_version = nested.schema_version;
  flat.updated_at = nested.updated_at;
  return flat;
}

/** Convert flat form settings to nested API structure. */
export function nestSettings(flat: Record<string, unknown>): Record<string, unknown> {
  const nested: Record<string, unknown> = {};
  for (const [flatKey, nestedPath] of Object.entries(FLAT_TO_NESTED)) {
    const parts = nestedPath.split('.');
    let current: Record<string, unknown> = nested;
    for (let i = 0; i < parts.length; i++) {
      if (i === parts.length - 1) {
        if (flat[flatKey] !== undefined) {
          current[parts[i]] = flat[flatKey];
        }
      } else {
        current[parts[i]] = (current[parts[i]] as Record<string, unknown> | undefined) ?? {};
        current = current[parts[i]] as Record<string, unknown>;
      }
    }
  }
  return nested;
}

/**
 * Normalize settings for Dashboard display.
 * Handles both the nested settings dict (from GET /api/settings)
 * and the app-state shape (where settings may be mixed at root level).
 */
export function normalizeDashboardSettings(
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  // If the dict has a nested "paths" key, treat it as nested → flatten
  if (raw.paths || raw.language || raw.runtime_defaults) {
    return flattenSettings(raw);
  }
  // Otherwise it may already be flat — return as-is
  return { ...raw };
}

/**
 * Get a single setting from a (possibly nested) settings dict.
 * Tries flat access first, then falls back to nested path.
 */
export function getSettingValue(
  settings: Record<string, unknown> | undefined,
  key: string,
): unknown {
  if (!settings) return undefined;
  // Direct flat access
  if (settings[key] !== undefined) return settings[key];
  // Try nested path via FLAT_TO_NESTED
  const nestedPath = FLAT_TO_NESTED[key];
  if (nestedPath) {
    const parts = nestedPath.split('.');
    let val: unknown = settings;
    for (const part of parts) {
      if (val == null || typeof val !== 'object') return undefined;
      val = (val as Record<string, unknown>)[part];
    }
    return val;
  }
  return undefined;
}
