import { useEffect } from 'react';
import { api } from '../../App';
import type { FieldSetters, DirtyFlags, DefaultsRefs } from './useCreateJobFields';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface UseCreateJobDefaultsDeps {
  fieldSetters: FieldSetters;
  dirty: DirtyFlags;
  defaultsRefs: DefaultsRefs;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Load settings from the API on mount and populate both the default refs
 * and the form fields (respecting dirty flags so user edits are not
 * overwritten on re-render / hot reload).
 */
export function useCreateJobDefaults(deps: UseCreateJobDefaultsDeps): void {
  const { fieldSetters, dirty, defaultsRefs } = deps;

  useEffect(() => {
    api.getSettings()
      .then(res => {
        const s = res.settings as Record<string, unknown>;
        const lang = s.language as Record<string, unknown> | undefined;
        const runtime = s.runtime_defaults as Record<string, unknown> | undefined;
        const trans = s.translation_defaults as Record<string, unknown> | undefined;

        if (lang?.default_src_lang) defaultsRefs.defaultSrcLangRef.current = String(lang.default_src_lang);
        if (lang?.default_dst_lang) defaultsRefs.defaultDstLangRef.current = String(lang.default_dst_lang);
        if (runtime?.default_provider) defaultsRefs.defaultProviderRef.current = String(runtime.default_provider);
        if (runtime?.default_model) defaultsRefs.defaultModelRef.current = String(runtime.default_model);
        if (trans?.default_batch_size != null) defaultsRefs.defaultBatchSizeRef.current = Number(trans.default_batch_size);
        if (trans?.default_use_cache != null) defaultsRefs.defaultUseCacheRef.current = Boolean(trans.default_use_cache);

        if (lang?.default_src_lang && !dirty.srcLangDirty) fieldSetters.setSrcLang(String(lang.default_src_lang));
        if (lang?.default_dst_lang && !dirty.dstLangDirty) fieldSetters.setDstLang(String(lang.default_dst_lang));
        if (runtime?.default_provider && !dirty.providerDirty) fieldSetters.setProvider(String(runtime.default_provider));
        if (runtime?.default_model && !dirty.modelDirty) fieldSetters.setModel(String(runtime.default_model));
        if (trans?.default_batch_size != null && !dirty.batchSizeDirty) fieldSetters.setBatchSize(Number(trans.default_batch_size));
        if (trans?.default_use_cache != null && !dirty.useCacheDirty) fieldSetters.setUseCache(Boolean(trans.default_use_cache));
      })
      .catch(() => {});
  }, []);
}
