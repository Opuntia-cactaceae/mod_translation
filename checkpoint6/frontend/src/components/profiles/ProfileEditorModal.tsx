import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, ApiError } from '../../App';
import type { TranslationProfile, GameOption, FileHandlerOption, TranslationOptionsResponse, ProfileDiagnostic } from '../../api/types';
import { mapProfile, isReadonlyProfile, type ProfileModel } from '../../domain';
import { useProfileForm } from '../../hooks/useProfileForm';
import { useDragSafeClose } from '../../hooks/useDragSafeClose';
import ProfileFormSections from './ProfileFormSections';
import ProfileValidationPanel from './ProfileValidationPanel';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
export interface ProfileEditorModalProps {
  open: boolean;
  mode: 'create' | 'edit' | 'view';
  profile?: TranslationProfile;
  initialConfig?: Record<string, unknown>;
  gameOptions: GameOption[];
  handlerOptions: FileHandlerOption[];
  translationOptions: TranslationOptionsResponse | null;
  onClose(): void;
  onSaved(profile: TranslationProfile): void;
}

/* ------------------------------------------------------------------ */
/*  Modal overlay styles                                               */
/* ------------------------------------------------------------------ */
const OVERLAY_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.5)',
  zIndex: 1000,
};

const MODAL_STYLE: React.CSSProperties = {
  background: 'var(--color-surface)',
  borderRadius: 'var(--radius)',
  width: '560px',
  maxWidth: '95vw',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
};

const HEADER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.75rem 1rem',
  borderBottom: '1px solid var(--color-border)',
};

const BODY_STYLE: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '0.75rem 1rem',
};

const FOOTER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '0.5rem',
  padding: '0.75rem 1rem',
  borderTop: '1px solid var(--color-border)',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function ProfileEditorModal({
  open,
  mode,
  profile,
  initialConfig,
  gameOptions,
  handlerOptions,
  translationOptions,
  onClose,
  onSaved,
}: ProfileEditorModalProps) {
  /* Convert DTO to domain model at boundary */
  const domainProfile: ProfileModel | null = useMemo(
    () => profile ? mapProfile(profile) : null,
    [profile],
  );

  const { form, patch, isDirty, buildConfig, buildCreatePayload, buildUpdatePayload } = useProfileForm(domainProfile, initialConfig);

  // --- Effective prompt loading for prompt section (TASK 5) ---
  const [effectivePrompt, setEffectivePrompt] = useState<{
    batch_system_prompt: string;
    batch_user_template: string;
    single_system_prompt: string;
    single_user_template: string;
  } | null>(null);

  useEffect(() => {
    if (!form.promptProfileName) {
      setEffectivePrompt(null);
      return;
    }
    let cancelled = false;
    api.effectivePrompt({
      prompt: { profile_name: form.promptProfileName },
      src_lang: form.srcLang || 'en',
      dst_lang: form.dstLang || 'ru',
    }).then(resp => {
      if (!cancelled) setEffectivePrompt(resp);
    }).catch(() => {
      if (!cancelled) setEffectivePrompt(null);
    });
    return () => { cancelled = true; };
  }, [form.promptProfileName, form.srcLang, form.dstLang]);

  const handleLoadFromPreset = useCallback(() => {
    if (!effectivePrompt) return;
    patch('batchSystemPrompt', effectivePrompt.batch_system_prompt);
    patch('batchUserTemplate', effectivePrompt.batch_user_template);
    patch('singleSystemPrompt', effectivePrompt.single_system_prompt);
    patch('singleUserTemplate', effectivePrompt.single_user_template);
  }, [effectivePrompt, patch]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<ProfileDiagnostic[]>([]);
  const [isValid, setIsValid] = useState(true);
  const [validating, setValidating] = useState(false);

  // Client-side validation for required text fields.
  // This catches empty values that the API may skip when they arrive as undefined.
  const clientDiags = useMemo<ProfileDiagnostic[]>(() => {
    const diags: ProfileDiagnostic[] = [];
    if (!form.name.trim()) {
      diags.push({ field: 'name', message: 'Profile name is required', level: 'error', code: 'required' });
    }
    if (!form.provider) {
      diags.push({ field: 'provider', message: 'Provider is required', level: 'error', code: 'required' });
    }
    if (!form.model) {
      diags.push({ field: 'model', message: 'Model is required', level: 'error', code: 'required' });
    }
    return diags;
  }, [form.name, form.provider, form.model]);

  // Only surface client-side errors once the user has touched the form
  // so a fresh create modal doesn't light up with errors immediately.
  const combinedDiagnostics = isDirty ? [...clientDiags, ...diagnostics] : diagnostics;
  const combinedValid = isDirty ? (clientDiags.length === 0 && isValid) : isValid;
  /** When viewing a system profile, user can click "Copy to editable profile"
   *  which switches the modal to create mode with the profile's config cloned. */
  const [clonedForEdit, setClonedForEdit] = useState(false);

  const effectiveMode = (domainProfile && isReadonlyProfile(domainProfile) && !clonedForEdit) ? 'view' : mode;

  // Reset validation when form changes
  useEffect(() => {
    if (diagnostics.length > 0) {
      setDiagnostics([]);
      setIsValid(true);
    }
  }, [form]);

  // Validate on each save attempt - run validation as user types
  const runValidation = useCallback(async () => {
    setValidating(true);
    try {
      const config = buildConfig();
      const res = await api.validateProfile({
        name: form.name || undefined,
        game: form.game,
        file_handler: form.fileHandler || undefined,
        config,
      });
      setDiagnostics(res.diagnostics);
      setIsValid(res.is_valid);
      return res.is_valid;
    } catch {
      // If validation endpoint fails, allow save anyway
      setDiagnostics([]);
      setIsValid(true);
      return true;
    } finally {
      setValidating(false);
    }
  }, [form]);

  // Run validation with debounce on form changes
  useEffect(() => {
    if (!isDirty || effectiveMode === 'view') return;
    const timer = setTimeout(() => {
      runValidation();
    }, 500);
    return () => clearTimeout(timer);
  }, [form, isDirty, effectiveMode, runValidation]);

  async function handleSave() {
    if (effectiveMode === 'view') return;
    setSaving(true);
    setSaveError(null);

    // Run final validation
    const valid = await runValidation();
    if (!valid) {
      setSaving(false);
      return;
    }

    try {
      if (effectiveMode === 'edit' && profile) {
        const updated = await api.updateProfile(profile.id, buildUpdatePayload());
        onSaved(updated);
      } else {
        const created = await api.createProfile(buildCreatePayload());
        onSaved(created);
      }
    } catch (err) {
      if (err instanceof ApiError) setSaveError(err.message);
      else setSaveError('Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  function handleCopyAndEdit() {
    if (!profile) return;
    // Switch to create mode with cloned config: update name to "{original} Copy"
    patch('name', `${profile.name} Copy`);
    setClonedForEdit(true);
  }

  function handleClose() {
    if (isDirty) {
      if (!confirm('Discard unsaved changes?')) return;
    }
    onClose();
  }

  // Click outside to close (drag-safe)
  const { handleOverlayPointerDown, handleOverlayClick } = useDragSafeClose(handleClose);

  if (!open) return null;

  const isReadOnly = effectiveMode === 'view' && !clonedForEdit;
  const modeLabel = clonedForEdit
    ? `Create Profile (cloned from ${profile?.name ?? 'system'})`
    : (domainProfile && isReadonlyProfile(domainProfile))
      ? 'View System Profile'
      : effectiveMode === 'create'
        ? 'Create Profile'
        : 'Edit Profile';

  const canSave = effectiveMode !== 'view' && !saving && combinedValid && form.name.trim().length > 0 && isDirty;

  return (
    <div style={OVERLAY_STYLE} onPointerDown={handleOverlayPointerDown} onClick={handleOverlayClick}>
      <div style={MODAL_STYLE}>
        {/* Header */}
        <div style={HEADER_STYLE}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{modeLabel}</span>
            {domainProfile && isReadonlyProfile(domainProfile) && (
              <span className="badge badge-info" style={{ fontSize: '0.6rem' }}>
                System profile (read-only)
              </span>
            )}
          </div>
          <button className="btn btn-sm" onClick={handleClose} type="button" style={{ fontSize: '0.7rem' }}>
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={BODY_STYLE}>
          <ProfileFormSections
            form={form}
            patch={patch}
            readOnly={isReadOnly}
            gameOptions={gameOptions}
            fileHandlers={handlerOptions}
            translationOptions={translationOptions}
            effectivePrompt={effectivePrompt}
            onLoadFromPreset={handleLoadFromPreset}
          />

          {/* Validation panel: client-side + API diagnostics merged */}
          {(combinedDiagnostics.length > 0 || validating) && (
            <ProfileValidationPanel
              diagnostics={combinedDiagnostics}
              isValid={combinedValid}
              validating={validating}
            />
          )}

          {/* Save error */}
          {saveError && (
            <div className="alert alert-error" style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
              {saveError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={FOOTER_STYLE}>
          {domainProfile && isReadonlyProfile(domainProfile) && !clonedForEdit ? (
            <button className="btn btn-primary btn-sm" onClick={handleCopyAndEdit} disabled={saving} style={{ fontSize: '0.75rem' }}>
              Copy to editable profile
            </button>
          ) : effectiveMode !== 'view' ? (
            <>
              <button className="btn btn-sm" onClick={handleClose} type="button" disabled={saving} style={{ fontSize: '0.75rem' }}>
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSave}
                disabled={!canSave}
                style={{ fontSize: '0.75rem' }}
              >
                {saving ? 'Saving...' : effectiveMode === 'create' ? 'Create Profile' : 'Save Changes'}
              </button>
            </>
          ) : (
            <button className="btn btn-sm" onClick={handleClose} type="button" style={{ fontSize: '0.75rem' }}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
