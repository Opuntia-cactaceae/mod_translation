/* ------------------------------------------------------------------ */
/*  Job config helpers — shared between hooks and section components   */
/* ------------------------------------------------------------------ */

// Note: getNestedValue in configFieldRegistry.ts is a functional
// duplicate of this function. Both traverse dot-separated paths
// in Record<string, unknown> objects. Keeping both to avoid
// cross-module dependency churn until a unified config accessor
// utility is introduced.

export function getConfigValue(
  config: Record<string, unknown> | undefined | null,
  path: string,
): unknown {
  if (!config) return undefined;
  const parts = path.split('.');
  let current: unknown = config;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function formatConfigValue(val: unknown): string {
  if (val === null || val === undefined) return '\u2014';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  return String(val);
}

export function renderConfigValue(
  cfg: Record<string, unknown> | undefined | null,
  path: string,
): string {
  return formatConfigValue(getConfigValue(cfg, path));
}

/* ------------------------------------------------------------------ */
/*  Typed config edit form model                                       */
/* ------------------------------------------------------------------ */

export interface JobConfigFormModel {
  model: string;
  batch_size: string;
  prompt_profile: string;
  protection_strategy: string;
  validator: string;
}

export const CONFIG_FORM_FIELDS: (keyof JobConfigFormModel)[] = [
  'model',
  'batch_size',
  'prompt_profile',
  'protection_strategy',
  'validator',
];
