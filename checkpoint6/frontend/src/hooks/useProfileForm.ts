import { useState, useCallback, useRef, useEffect } from 'react';
import type { ProfileModel } from '../domain';
import {
  type ProfileFormModel,
  profileToForm,
  formToProfileConfig,
  formToCreateProfilePayload,
  formToUpdateProfilePayload,
} from '../domain';

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useProfileForm(
  profile?: ProfileModel | null,
  initialConfig?: Record<string, unknown>,
) {
  const initialState = profileToForm(profile ?? undefined, initialConfig);
  const initialRef = useRef<ProfileFormModel>(initialState);
  const [form, setForm] = useState<ProfileFormModel>(initialState);

  // Reset when profile/config changes
  useEffect(() => {
    const next = profileToForm(profile ?? undefined, initialConfig);
    initialRef.current = next;
    setForm(next);
  }, [profile?.id, initialConfig]);

  /** Set a single camelCase field on the form model. */
  const patch = useCallback((key: keyof ProfileFormModel, value: unknown) => {
    setForm(prev => ({ ...prev, [key]: value as never }));
  }, []);

  const isDirty = !isEqual(form, initialRef.current);

  const buildConfig = useCallback(() => formToProfileConfig(form), [form]);
  const buildCreatePayload = useCallback(() => formToCreateProfilePayload(form), [form]);
  const buildUpdatePayload = useCallback(() => formToUpdateProfilePayload(form), [form]);

  const reset = useCallback(() => {
    setForm({ ...initialRef.current });
  }, []);

  return {
    form,
    setForm,
    patch,
    reset,
    isDirty,
    buildConfig,
    buildCreatePayload,
    buildUpdatePayload,
    initial: initialRef.current,
  };
}

/* ------------------------------------------------------------------ */
/*  Deep equality helper (internal)                                    */
/* ------------------------------------------------------------------ */

function isEqual(a: ProfileFormModel, b: ProfileFormModel): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.game === b.game &&
    a.fileHandler === b.fileHandler &&
    a.srcLang === b.srcLang &&
    a.dstLang === b.dstLang &&
    a.provider === b.provider &&
    a.model === b.model &&
    a.temperature === b.temperature &&
    a.batchSize === b.batchSize &&
    a.useCache === b.useCache &&
    a.apiKeyId === b.apiKeyId &&
    JSON.stringify(a.apiKeyIds) === JSON.stringify(b.apiKeyIds) &&
    a.maxRetries === b.maxRetries &&
    a.timeoutSec === b.timeoutSec &&
    a.maxCompletionTokens === b.maxCompletionTokens &&
    a.saveRawResponses === b.saveRawResponses &&
    a.promptProfileName === b.promptProfileName &&
    a.batchSystemPrompt === b.batchSystemPrompt &&
    a.batchUserTemplate === b.batchUserTemplate &&
    a.singleSystemPrompt === b.singleSystemPrompt &&
    a.singleUserTemplate === b.singleUserTemplate &&
    a.logPrompts === b.logPrompts &&
    a.protectionStrategy === b.protectionStrategy &&
    JSON.stringify(a.ruleSetIds) === JSON.stringify(b.ruleSetIds) &&
    a.validatorName === b.validatorName &&
    a.outputDir === b.outputDir &&
    a.outputRootDir === b.outputRootDir &&
    a.outputFilenameSuffix === b.outputFilenameSuffix &&
    a.outputPreserveRelativePath === b.outputPreserveRelativePath &&
    a.outputOverwrite === b.outputOverwrite &&
    a.outputBackup === b.outputBackup
  );
}
