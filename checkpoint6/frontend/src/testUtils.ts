/* ================================================================== */
/*  Test utilities for frontend tests                                   */
/*  IMPORTANT: production code must NEVER import from this file.        */
/* ================================================================== */

/**
 * Build a canonical job config for tests.
 *
 * Always includes every known field with predictable defaults.
 * Any override passed in replaces the top-level key entirely
 * (shallow merge).
 *
 * Usage:
 *   createTestJobConfig()                                    // full defaults
 *   createTestJobConfig({ protection: { strategy: 'none' } })  // override
 */
export function createTestJobConfig(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    // --- core ---
    src_lang: 'english',
    dst_lang: 'russian',
    batch_size: 50,
    use_cache: true,
    save_raw_responses: false,

    // --- runtime ---
    runtime: {
      provider: 'openai',
      model: 'gpt-4',
      temperature: 0,
      max_retries: 3,
      timeout_sec: 120,
      max_completion_tokens: 4096,
      api_key_id: 'key-1',
      api_key_ids: ['key-1'],
    },

    // --- prompt ---
    prompt: {
      profile_name: 'default',
      batch_system_prompt: '',
      batch_user_template: '',
      single_system_prompt: '',
      single_user_template: '',
      log_prompts: false,
    },

    // --- protection (includes rule_set_ids to prevent drift) ---
    protection: {
      strategy: 'strict',
      rule_set_ids: ['builtin_default_game_localisation'],
    },

    // --- validation ---
    validation: {
      validator_name: 'composite',
    },

    // --- output ---
    output: {
      output_dir: '',
      filename_suffix: '',
      preserve_relative_path: false,
      overwrite: false,
      backup: false,
    },

    ...overrides,
  };
}
