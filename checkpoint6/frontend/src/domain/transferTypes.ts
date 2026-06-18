/* ------------------------------------------------------------------ */
/*  Import / Export Transfer types                                     */
/* ------------------------------------------------------------------ */

export interface ExportOptionItem {
  id: string;
  name: string;
  description: string;
}

export interface ExportOptionsResponse {
  rule_sets: ExportOptionItem[];
  translation_profiles: ExportOptionItem[];
  total: number;
}

export interface CreateExportPackageRequest {
  rule_set_ids: string[];
  profile_ids: string[];
}

export interface ImportPreviewRequest {
  package: Record<string, unknown>;
  conflict_policy: 'skip_existing' | 'overwrite_existing' | 'import_as_copy';
}

export interface ImportApplyRequest {
  package: Record<string, unknown>;
  conflict_policy: 'skip_existing' | 'overwrite_existing' | 'import_as_copy';
}

export interface ImportPreviewItem {
  original_id: string;
  name: string;
  kind: 'rule_set' | 'translation_profile';
  action: 'create' | 'skip' | 'overwrite' | 'import_as_copy';
  new_id?: string | null;
  new_name?: string | null;
  warning?: string | null;
  diagnostics: Array<{
    level: string;
    code: string;
    message: string;
  }>;
}

export interface ImportPreviewResponse {
  items: ImportPreviewItem[];
  total: number;
  create_count: number;
  skip_count: number;
  overwrite_count: number;
  import_as_copy_count: number;
  warnings: string[];
  errors: string[];
  rule_set_id_map: Record<string, string>;
}

export interface ImportApplyResponse {
  success: boolean;
  imported: number;
  skipped: number;
  overwritten: number;
  imported_as_copy: number;
  errors: string[];
  warnings: string[];
  rule_set_id_map: Record<string, string>;
}
