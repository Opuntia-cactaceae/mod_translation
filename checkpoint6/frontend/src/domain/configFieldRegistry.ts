/* ------------------------------------------------------------------ */
/*  Config Field Registry — source-of-truth for field mappings         */
/*                                                                      */
/*  Every config field that flows through job config, profile save,     */
/*  profile apply, and backend override should be registered here.      */
/*                                                                      */
/*  Each entry describes:                                               */
/*    - formKey:       camelCase key used in frontend form models       */
/*    - configPaths:   ordered list of config keys to try when reading. */
/*                     The first entry is the canonical write path.     */
/*    - category:      logical grouping                                 */
/*    - type:          value type hint                                  */
/*    - defaultValue:  fallback when the field is absent                */
/* ------------------------------------------------------------------ */

export interface ConfigFieldEntry {
  /** CamelCase form key (e.g. "srcLang", "maxRetries") */
  formKey: string;
  /**
   * Config paths to try when reading. The first is the canonical
   * write path. Additional entries are legacy aliases.
   *
   * Examples:
   *   ["output.output_dir", "output.dir"]
   *   ["runtime.provider"]
   */
  configPaths: string[];
  /** Logical section */
  category: 'core' | 'runtime' | 'prompt' | 'protection' | 'validation' | 'output';
  /** Value type */
  type: 'string' | 'number' | 'boolean' | 'string[]';
  /** Default when absent */
  defaultValue: unknown;
}

export const CONFIG_FIELD_REGISTRY: ConfigFieldEntry[] = [
  // ================================================================
  // Core
  // ================================================================
  {
    formKey: 'srcLang',
    configPaths: ['src_lang'],
    category: 'core',
    type: 'string',
    defaultValue: '',
  },
  {
    formKey: 'dstLang',
    configPaths: ['dst_lang'],
    category: 'core',
    type: 'string',
    defaultValue: '',
  },
  {
    formKey: 'batchSize',
    configPaths: ['batch_size'],
    category: 'core',
    type: 'number',
    defaultValue: 10,
  },
  {
    formKey: 'useCache',
    configPaths: ['use_cache'],
    category: 'core',
    type: 'boolean',
    defaultValue: true,
  },
  {
    formKey: 'saveRawResponses',
    configPaths: ['save_raw_responses'],
    category: 'core',
    type: 'boolean',
    defaultValue: false,
  },
  {
    formKey: 'selectedProfileId',
    configPaths: ['translation_profile_id'],
    category: 'core',
    type: 'string',
    defaultValue: '',
  },

  // ================================================================
  // Runtime
  // ================================================================
  {
    formKey: 'provider',
    configPaths: ['runtime.provider', 'provider'],
    category: 'runtime',
    type: 'string',
    defaultValue: '',
  },
  {
    formKey: 'model',
    configPaths: ['runtime.model', 'model'],
    category: 'runtime',
    type: 'string',
    defaultValue: '',
  },
  {
    formKey: 'apiKeyId',
    configPaths: ['runtime.api_key_id', 'api_key_id'],
    category: 'runtime',
    type: 'string',
    defaultValue: '',
  },
  {
    formKey: 'apiKeyIds',
    configPaths: ['runtime.api_key_ids', 'api_key_ids'],
    category: 'runtime',
    type: 'string[]',
    defaultValue: [],
  },
  {
    formKey: 'temperature',
    configPaths: ['runtime.temperature', 'temperature'],
    category: 'runtime',
    type: 'number',
    defaultValue: 0,
  },
  {
    formKey: 'maxRetries',
    configPaths: ['runtime.max_retries', 'max_retries'],
    category: 'runtime',
    type: 'number',
    defaultValue: 3,
  },
  {
    formKey: 'timeoutSec',
    configPaths: ['runtime.timeout_sec', 'timeout_sec'],
    category: 'runtime',
    type: 'number',
    defaultValue: 0,
  },
  {
    formKey: 'maxCompletionTokens',
    configPaths: ['runtime.max_completion_tokens', 'max_completion_tokens'],
    category: 'runtime',
    type: 'number',
    defaultValue: 0,
  },

  // ================================================================
  // Prompt
  // ================================================================
  {
    formKey: 'promptProfileName',
    configPaths: ['prompt.profile_name'],
    category: 'prompt',
    type: 'string',
    defaultValue: '',
  },
  {
    formKey: 'batchSystemPrompt',
    configPaths: ['prompt.batch_system_prompt'],
    category: 'prompt',
    type: 'string',
    defaultValue: '',
  },
  {
    formKey: 'batchUserTemplate',
    configPaths: ['prompt.batch_user_template'],
    category: 'prompt',
    type: 'string',
    defaultValue: '',
  },
  {
    formKey: 'singleSystemPrompt',
    configPaths: ['prompt.single_system_prompt'],
    category: 'prompt',
    type: 'string',
    defaultValue: '',
  },
  {
    formKey: 'singleUserTemplate',
    configPaths: ['prompt.single_user_template'],
    category: 'prompt',
    type: 'string',
    defaultValue: '',
  },
  {
    formKey: 'logPrompts',
    configPaths: ['prompt.log_prompts'],
    category: 'prompt',
    type: 'boolean',
    defaultValue: false,
  },

  // ================================================================
  // Protection
  // ================================================================
  {
    formKey: 'protectionStrategy',
    configPaths: ['protection.strategy', 'protection_strategy'],
    category: 'protection',
    type: 'string',
    defaultValue: '',
  },

  // ================================================================
  // Validation
  // ================================================================
  {
    formKey: 'validatorName',
    configPaths: ['validation.validator_name', 'validator_name'],
    category: 'validation',
    type: 'string',
    defaultValue: '',
  },

  // ================================================================
  // Output
  // ================================================================
  {
    formKey: 'outputDir',
    configPaths: ['output.output_dir', 'output.dir'],
    category: 'output',
    type: 'string',
    defaultValue: '',
  },
  {
    formKey: 'outputFilenameSuffix',
    configPaths: ['output.filename_suffix'],
    category: 'output',
    type: 'string',
    defaultValue: '',
  },
  {
    formKey: 'outputPreserveRelativePath',
    configPaths: ['output.preserve_relative_path'],
    category: 'output',
    type: 'boolean',
    defaultValue: false,
  },
  {
    formKey: 'outputOverwrite',
    configPaths: ['output.overwrite'],
    category: 'output',
    type: 'boolean',
    defaultValue: false,
  },
  {
    formKey: 'outputBackup',
    configPaths: ['output.backup'],
    category: 'output',
    type: 'boolean',
    defaultValue: false,
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Read a value from a nested config object using a dot-separated path.
 */
export function getNestedValue(
  config: Record<string, unknown> | undefined | null,
  path: string,
): unknown {
  if (!config) return undefined;
  const parts = path.split('.');
  let current: unknown = config;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Set a value on a target object using a dot-separated path,
 * creating intermediate objects as needed.
 */
export function setNestedValue(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split('.');
  let current = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  current[last] = value;
}

/**
 * Read a config value trying all alias paths in order.
 * Returns the first non-null/non-undefined value found.
 */
export function readConfigAliases(
  config: Record<string, unknown> | undefined | null,
  paths: string[],
): unknown {
  for (const path of paths) {
    const val = getNestedValue(config, path);
    if (val !== undefined && val !== null) {
      return val;
    }
  }
  return undefined;
}

/**
 * Build a map of formKey → value from a config object using the registry.
 * Only includes fields whose value is non-null/non-undefined.
 */
export function readAllFromConfig(
  config: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!config) return result;
  for (const entry of CONFIG_FIELD_REGISTRY) {
    const val = readConfigAliases(config, entry.configPaths);
    if (val !== undefined && val !== null) {
      result[entry.formKey] = val;
    }
  }
  return result;
}
