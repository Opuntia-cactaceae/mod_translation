import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCreateJobFields } from '../useCreateJobFields';

/* ================================================================== */
/*  useCreateJobFields                                                  */
/* ================================================================== */

describe('useCreateJobFields', () => {
  /* ------------------------------------------------------------------ */
  /*  Initial scalar field values                                        */
  /* ------------------------------------------------------------------ */

  describe('initial scalar field values', () => {
    it('jobName starts empty', () => {
      const { result } = renderHook(() => useCreateJobFields());
      expect(result.current.jobName).toBe('');
    });

    it('srcLang defaults to english', () => {
      const { result } = renderHook(() => useCreateJobFields());
      expect(result.current.srcLang).toBe('english');
    });

    it('dstLang defaults to russian', () => {
      const { result } = renderHook(() => useCreateJobFields());
      expect(result.current.dstLang).toBe('russian');
    });

    it('batchSize defaults to 50', () => {
      const { result } = renderHook(() => useCreateJobFields());
      expect(result.current.batchSize).toBe(50);
    });

    it('useCache defaults to true', () => {
      const { result } = renderHook(() => useCreateJobFields());
      expect(result.current.useCache).toBe(true);
    });

    it('provider starts empty', () => {
      const { result } = renderHook(() => useCreateJobFields());
      expect(result.current.provider).toBe('');
    });

    it('model starts empty', () => {
      const { result } = renderHook(() => useCreateJobFields());
      expect(result.current.model).toBe('');
    });

    it('apiKeyId starts empty', () => {
      const { result } = renderHook(() => useCreateJobFields());
      expect(result.current.apiKeyId).toBe('');
    });

    it('apiKeyIds starts empty', () => {
      const { result } = renderHook(() => useCreateJobFields());
      expect(result.current.apiKeyIds).toEqual([]);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  setFormField for scalar fields                                      */
  /* ------------------------------------------------------------------ */

  describe('setFormField for scalar fields', () => {
    it('updates jobName', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('jobName', 'My Job'));
      expect(result.current.jobName).toBe('My Job');
    });

    it('updates srcLang', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('srcLang', 'french'));
      expect(result.current.srcLang).toBe('french');
    });

    it('updates dstLang', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('dstLang', 'german'));
      expect(result.current.dstLang).toBe('german');
    });

    it('updates batchSize', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('batchSize', 100));
      expect(result.current.batchSize).toBe(100);
    });

    it('updates useCache', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('useCache', false));
      expect(result.current.useCache).toBe(false);
    });

    it('updates provider', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('provider', 'openai'));
      expect(result.current.provider).toBe('openai');
    });

    it('updates model', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('model', 'gpt-4'));
      expect(result.current.model).toBe('gpt-4');
    });

    it('updates apiKeyId', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('apiKeyId', 'key-123'));
      expect(result.current.apiKeyId).toBe('key-123');
    });

    it('updates apiKeyIds', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('apiKeyIds', ['key-a', 'key-b']));
      expect(result.current.apiKeyIds).toEqual(['key-a', 'key-b']);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Dirty flag behavior                                                 */
  /* ------------------------------------------------------------------ */

  describe('dirty flag behavior', () => {
    it('all dirty flags start false', () => {
      const { result } = renderHook(() => useCreateJobFields());
      expect(result.current.dirty).toEqual({
        srcLangDirty: false,
        dstLangDirty: false,
        batchSizeDirty: false,
        useCacheDirty: false,
        providerDirty: false,
        modelDirty: false,
        promptProfileNameDirty: false,
        protectionStrategyDirty: false,
        ruleSetIdsDirty: false,
        validatorNameDirty: false,
        outputDirDirty: false,
        outputFilenameSuffixDirty: false,
        outputPreserveRelativePathDirty: false,
        outputOverwriteDirty: false,
        outputBackupDirty: false,
        temperatureDirty: false,
        maxRetriesDirty: false,
        timeoutSecDirty: false,
        maxCompletionTokensDirty: false,
        saveRawResponsesDirty: false,
      });
    });

    it('sets srcLangDirty after setFormField("srcLang", ...)', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('srcLang', 'french'));
      expect(result.current.dirty.srcLangDirty).toBe(true);
    });

    it('sets dstLangDirty after setFormField("dstLang", ...)', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('dstLang', 'german'));
      expect(result.current.dirty.dstLangDirty).toBe(true);
    });

    it('sets batchSizeDirty after setFormField("batchSize", ...)', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('batchSize', 75));
      expect(result.current.dirty.batchSizeDirty).toBe(true);
    });

    it('sets useCacheDirty after setFormField("useCache", ...)', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('useCache', false));
      expect(result.current.dirty.useCacheDirty).toBe(true);
    });

    it('sets providerDirty after setFormField("provider", ...)', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('provider', 'openai'));
      expect(result.current.dirty.providerDirty).toBe(true);
    });

    it('sets modelDirty after setFormField("model", ...)', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('model', 'gpt-4'));
      expect(result.current.dirty.modelDirty).toBe(true);
    });

    it('does NOT set dirty for jobName changes', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('jobName', 'My Job'));
      expect(result.current.dirty.srcLangDirty).toBe(false);
      expect(result.current.dirty.dstLangDirty).toBe(false);
    });

    it('does NOT set dirty for apiKeyId changes', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.setFormField('apiKeyId', 'key-1'));
      expect(result.current.dirty.srcLangDirty).toBe(false);
      expect(result.current.dirty.dstLangDirty).toBe(false);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Apply defaults without overwriting dirty fields                     */
  /* ------------------------------------------------------------------ */

  describe('defaultsRefs without overwriting dirty fields', () => {
    it('defaultsRefs start with expected default values', () => {
      const { result } = renderHook(() => useCreateJobFields());
      expect(result.current.defaultsRefs.defaultSrcLangRef.current).toBe('english');
      expect(result.current.defaultsRefs.defaultDstLangRef.current).toBe('russian');
      expect(result.current.defaultsRefs.defaultBatchSizeRef.current).toBe(50);
      expect(result.current.defaultsRefs.defaultUseCacheRef.current).toBe(true);
      expect(result.current.defaultsRefs.defaultProviderRef.current).toBe('');
      expect(result.current.defaultsRefs.defaultModelRef.current).toBe('');
    });

    it('defaultsRefs can be mutated externally (simulating API load)', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => {
        result.current.defaultsRefs.defaultSrcLangRef.current = 'french';
        result.current.defaultsRefs.defaultBatchSizeRef.current = 100;
      });
      expect(result.current.defaultsRefs.defaultSrcLangRef.current).toBe('french');
      expect(result.current.defaultsRefs.defaultBatchSizeRef.current).toBe(100);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  resetFormFields                                                     */
  /* ------------------------------------------------------------------ */

  describe('resetFormFields', () => {
    it('resets all fields to default ref values and clears dirty flags', () => {
      const { result } = renderHook(() => useCreateJobFields());

      act(() => {
        result.current.setFormField('srcLang', 'german');
        result.current.setFormField('dstLang', 'french');
        result.current.setFormField('batchSize', 200);
        result.current.setFormField('useCache', false);
        result.current.setFormField('provider', 'anthropic');
        result.current.setFormField('model', 'claude-3');
      });

      act(() => result.current.resetFormFields());

      expect(result.current.srcLang).toBe('english');
      expect(result.current.dstLang).toBe('russian');
      expect(result.current.batchSize).toBe(50);
      expect(result.current.useCache).toBe(true);
      expect(result.current.provider).toBe('');
      expect(result.current.model).toBe('');
      expect(result.current.dirty.srcLangDirty).toBe(false);
      expect(result.current.dirty.dstLangDirty).toBe(false);
      expect(result.current.dirty.batchSizeDirty).toBe(false);
      expect(result.current.dirty.useCacheDirty).toBe(false);
      expect(result.current.dirty.providerDirty).toBe(false);
      expect(result.current.dirty.modelDirty).toBe(false);
    });

    it('resets to mutated default refs', () => {
      const { result } = renderHook(() => useCreateJobFields());

      act(() => {
        result.current.defaultsRefs.defaultSrcLangRef.current = 'german';
        result.current.defaultsRefs.defaultDstLangRef.current = 'french';
      });

      act(() => result.current.setFormField('srcLang', 'spanish'));
      act(() => result.current.resetFormFields());

      expect(result.current.srcLang).toBe('german');
      expect(result.current.dstLang).toBe('french');
      expect(result.current.dirty.srcLangDirty).toBe(false);
    });

    it('does not reset jobName or apiKeyId (they have no default refs)', () => {
      const { result } = renderHook(() => useCreateJobFields());

      act(() => {
        result.current.setFormField('jobName', 'Persistent');
        result.current.setFormField('apiKeyId', 'key-999');
      });

      act(() => result.current.resetFormFields());

      // jobName and apiKeyId are not managed by resetFormFields
      expect(result.current.jobName).toBe('Persistent');
      expect(result.current.apiKeyId).toBe('key-999');
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Типовая смена provider/model/batchSize/useCache                     */
  /* ------------------------------------------------------------------ */

  describe('typical provider/model/batchSize/useCache changes', () => {
    it('changes provider and model together', () => {
      const { result } = renderHook(() => useCreateJobFields());

      act(() => result.current.setFormField('provider', 'azure'));
      act(() => result.current.setFormField('model', 'gpt-35-turbo'));

      expect(result.current.provider).toBe('azure');
      expect(result.current.model).toBe('gpt-35-turbo');
      expect(result.current.dirty.providerDirty).toBe(true);
      expect(result.current.dirty.modelDirty).toBe(true);
    });

    it('toggles useCache from true to false and back', () => {
      const { result } = renderHook(() => useCreateJobFields());

      expect(result.current.useCache).toBe(true);
      act(() => result.current.setFormField('useCache', false));
      expect(result.current.useCache).toBe(false);
      act(() => result.current.setFormField('useCache', true));
      expect(result.current.useCache).toBe(true);
    });

    it('changes batchSize multiple times', () => {
      const { result } = renderHook(() => useCreateJobFields());

      act(() => result.current.setFormField('batchSize', 10));
      expect(result.current.batchSize).toBe(10);
      act(() => result.current.setFormField('batchSize', 500));
      expect(result.current.batchSize).toBe(500);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  fieldSetters (raw setters that skip dirty)                          */
  /* ------------------------------------------------------------------ */

  describe('fieldSetters (raw setters that skip dirty)', () => {
    it('setSrcLang updates srcLang without marking dirty', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.fieldSetters.setSrcLang('french'));
      expect(result.current.srcLang).toBe('french');
      expect(result.current.dirty.srcLangDirty).toBe(false);
    });

    it('setDstLang updates dstLang without marking dirty', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.fieldSetters.setDstLang('german'));
      expect(result.current.dstLang).toBe('german');
      expect(result.current.dirty.dstLangDirty).toBe(false);
    });

    it('setBatchSize updates batchSize without marking dirty', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.fieldSetters.setBatchSize(200));
      expect(result.current.batchSize).toBe(200);
      expect(result.current.dirty.batchSizeDirty).toBe(false);
    });

    it('setUseCache updates useCache without marking dirty', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.fieldSetters.setUseCache(false));
      expect(result.current.useCache).toBe(false);
      expect(result.current.dirty.useCacheDirty).toBe(false);
    });

    it('setProvider updates provider without marking dirty', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.fieldSetters.setProvider('openai'));
      expect(result.current.provider).toBe('openai');
      expect(result.current.dirty.providerDirty).toBe(false);
    });

    it('setModel updates model without marking dirty', () => {
      const { result } = renderHook(() => useCreateJobFields());
      act(() => result.current.fieldSetters.setModel('gpt-4'));
      expect(result.current.model).toBe('gpt-4');
      expect(result.current.dirty.modelDirty).toBe(false);
    });
  });
});
