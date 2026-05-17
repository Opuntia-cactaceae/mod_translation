import { useState } from 'react';
import type { GameOption, FileHandlerOption, TranslationOptionsResponse } from '../../api/types';
import type { ProfileFormModel } from '../../domain';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
interface ProfileFormSectionsProps {
  form: ProfileFormModel;
  patch: (key: keyof ProfileFormModel, value: unknown) => void;
  readOnly: boolean;
  gameOptions: GameOption[];
  fileHandlers: FileHandlerOption[];
  translationOptions: TranslationOptionsResponse | null;
  /** Effective prompt templates loaded from the preset for readonly preview (TASK 5) */
  effectivePrompt?: {
    batch_system_prompt: string;
    batch_user_template: string;
    single_system_prompt: string;
    single_user_template: string;
  } | null;
  /** Called when user clicks "Load from preset" — fills the template fields (TASK 5) */
  onLoadFromPreset?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Collapsible section                                                */
/* ------------------------------------------------------------------ */
function Section({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius)',
      marginBottom: '0.5rem',
      overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          padding: '0.4rem 0.6rem',
          background: 'var(--color-surface-2)',
          border: 'none',
          cursor: 'pointer',
          fontSize: '0.75rem',
          fontWeight: 600,
          textAlign: 'left',
          color: 'var(--color-text)',
        }}
      >
        {title}
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', fontSize: '0.65rem' }}>
          &#9654;
        </span>
      </button>
      {open && (
        <div style={{ padding: '0.5rem 0.6rem' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Input field helper                                                 */
/* ------------------------------------------------------------------ */
function Field({
  label,
  value,
  onChange,
  type = 'text',
  readOnly,
  placeholder,
  mono,
  options,
}: {
  label: string;
  value: unknown;
  onChange?: (v: string) => void;
  type?: 'text' | 'number' | 'checkbox' | 'select';
  readOnly: boolean;
  placeholder?: string;
  mono?: boolean;
  options?: { value: string; label: string }[];
}) {
  const id = `field-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="form-group" style={{ marginBottom: '0.4rem' }}>
      <label htmlFor={id} style={{ fontSize: '0.7rem', marginBottom: '0.15rem' }}>{label}</label>
      {type === 'checkbox' ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: readOnly ? 'default' : 'pointer', fontSize: '0.75rem' }}>
          <input
            id={id}
            type="checkbox"
            checked={!!value}
            disabled={readOnly}
            onChange={e => onChange?.(String(e.target.checked))}
          />
          {String(value)}
        </label>
      ) : type === 'select' && options ? (
        <select
          id={id}
          className="form-control"
          value={String(value)}
          disabled={readOnly}
          onChange={e => onChange?.(e.target.value)}
          style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem' }}
        >
          <option value="">— None —</option>
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className="form-control"
          type={type}
          value={String(value ?? '')}
          disabled={readOnly}
          placeholder={placeholder}
          onChange={e => onChange?.(type === 'number' ? String(Number(e.target.value)) : e.target.value)}
          style={{
            fontSize: '0.75rem',
            padding: '0.25rem 0.4rem',
            ...(mono ? { fontFamily: 'var(--font-mono, monospace)' } : {}),
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Read-only field (preview)                                          */
/* ------------------------------------------------------------------ */
function ReadOnlyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="form-group" style={{ marginBottom: '0.4rem' }}>
      <label style={{ fontSize: '0.7rem', marginBottom: '0.15rem', color: 'var(--color-text-muted)' }}>{label}</label>
      <div style={{
        fontSize: '0.75rem',
        padding: '0.25rem 0.4rem',
        background: 'var(--color-surface-2)',
        borderRadius: 'var(--radius)',
        minHeight: '1.4rem',
        color: 'var(--color-text-muted)',
        fontFamily: mono ? 'var(--font-mono, monospace)' : undefined,
        wordBreak: 'break-all',
      }}>
        {value || '—'}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
export default function ProfileFormSections({
  form,
  patch,
  readOnly,
  gameOptions,
  fileHandlers,
  translationOptions,
  effectivePrompt,
  onLoadFromPreset,
}: ProfileFormSectionsProps) {
  const gameOpts = gameOptions.map(g => ({ value: g.id, label: g.label }));
  const handlerOpts = fileHandlers
    .filter(h => {
      const game = gameOptions.find(g => g.id === form.game);
      return game ? game.file_handlers.includes(h.id) : true;
    })
    .map(h => ({ value: h.id, label: `${h.label} (${h.extensions.join(', ')})` }));

  const providerOpts = (translationOptions?.providers ?? []).map(p => ({ value: p, label: p }));
  const promptOpts = (translationOptions?.prompt_profiles ?? []).map(p => ({ value: p, label: p }));
  const protectionOpts = (translationOptions?.protection_strategies ?? []).map(p => ({ value: p, label: p }));
  const validatorOpts = (translationOptions?.validators ?? []).map(v => ({ value: v, label: v }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Basic */}
      <Section title="Basic">
        <Field label="Name" value={form.name} onChange={v => patch('name', v)} readOnly={readOnly} placeholder="My profile" />
        <Field label="Description" value={form.description} onChange={v => patch('description', v)} readOnly={readOnly} placeholder="Optional description" />
      </Section>

      {/* Game */}
      <Section title="Game">
        <Field
          label="Game"
          value={form.game}
          onChange={v => patch('game', v)}
          readOnly={readOnly}
          type="select"
          options={gameOpts}
        />
        <Field
          label="File Handler"
          value={form.fileHandler}
          onChange={v => patch('fileHandler', v)}
          readOnly={readOnly}
          type="select"
          options={handlerOpts}
        />
      </Section>

      {/* Languages */}
      <Section title="Languages">
        <Field label="Source Language" value={form.srcLang} onChange={v => patch('srcLang', v)} readOnly={readOnly} placeholder="en" />
        <Field label="Target Language" value={form.dstLang} onChange={v => patch('dstLang', v)} readOnly={readOnly} placeholder="ru" />
      </Section>

      {/* Runtime */}
      <Section title="Runtime">
        <Field
          label="Provider"
          value={form.provider}
          onChange={v => patch('provider', v)}
          readOnly={readOnly}
          type="select"
          options={providerOpts}
        />
        <Field label="Model" value={form.model} onChange={v => patch('model', v)} readOnly={readOnly} placeholder="gpt-4" mono />
        <Field label="Temperature" value={form.temperature} onChange={v => patch('temperature', Number(v))} readOnly={readOnly} type="number" />
        <Field label="Batch Size" value={form.batchSize} onChange={v => patch('batchSize', Number(v))} readOnly={readOnly} type="number" />
        <Field label="Use Cache" value={form.useCache} onChange={v => patch('useCache', v === 'true')} readOnly={readOnly} type="checkbox" />
      </Section>

      {/* Prompt */}
      <Section title="Prompt">
        {readOnly ? (
          <ReadOnlyField label="Prompt Profile" value={form.promptProfileName} mono />
        ) : (
          <>
            <Field
              label="Prompt Profile"
              value={form.promptProfileName}
              onChange={v => patch('promptProfileName', v)}
              readOnly={readOnly}
              type="select"
              options={promptOpts}
            />
            <Field
              label="Log Prompts"
              value={form.logPrompts}
              onChange={v => patch('logPrompts', v === 'true')}
              readOnly={readOnly}
              type="checkbox"
            />
          </>
        )}

        {/* Batch prompt templates */}
        <div style={{ marginTop: '0.5rem', padding: '0.4rem', background: 'var(--color-surface-1)', borderRadius: 'var(--radius)' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.3rem' }}>Batch Prompt</div>
          <Field
            label="Batch System Prompt"
            value={form.batchSystemPrompt}
            onChange={v => patch('batchSystemPrompt', v)}
            readOnly={readOnly}
            placeholder="You are a translation engine..."
            mono
          />
          <Field
            label="Batch User Template"
            value={form.batchUserTemplate}
            onChange={v => patch('batchUserTemplate', v)}
            readOnly={readOnly}
            placeholder="{texts}"
            mono
          />
          <div style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
            Placeholders: {`{texts}`}, {`{src_lang}`}, {`{dst_lang}`}, {`{src_lang_code}`}, {`{dst_lang_code}`}
          </div>
        </div>

        {/* Single prompt templates */}
        <div style={{ marginTop: '0.3rem', padding: '0.4rem', background: 'var(--color-surface-1)', borderRadius: 'var(--radius)' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.3rem' }}>Single Prompt</div>
          <Field
            label="Single System Prompt"
            value={form.singleSystemPrompt}
            onChange={v => patch('singleSystemPrompt', v)}
            readOnly={readOnly}
            placeholder="Translate from {src_lang} to {dst_lang}..."
            mono
          />
          <Field
            label="Single User Template"
            value={form.singleUserTemplate}
            onChange={v => patch('singleUserTemplate', v)}
            readOnly={readOnly}
            placeholder="{text}"
            mono
          />
          <div style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
            Placeholders: {`{text}`}, {`{texts}`}, {`{src_lang}`}, {`{dst_lang}`}, {`{src_lang_code}`}, {`{dst_lang_code}`}
          </div>
        </div>

        {/* Effective prompt notice — profile references preset but templates are empty (TASK 5) */}
        {form.promptProfileName && !form.batchSystemPrompt && !form.batchUserTemplate && !form.singleSystemPrompt && !form.singleUserTemplate && effectivePrompt && (
          <div style={{ marginTop: '0.3rem', padding: '0.4rem', background: 'var(--color-surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 600, marginBottom: '0.3rem', color: 'var(--color-text-muted)' }}>
              Using preset templates from &ldquo;{form.promptProfileName}&rdquo; (read-only preview)
            </div>
            <ReadOnlyField label="Batch System Prompt" value={effectivePrompt.batch_system_prompt || '—'} mono />
            <ReadOnlyField label="Batch User Template" value={effectivePrompt.batch_user_template || '—'} mono />
            <ReadOnlyField label="Single System Prompt" value={effectivePrompt.single_system_prompt || '—'} mono />
            <ReadOnlyField label="Single User Template" value={effectivePrompt.single_user_template || '—'} mono />
            {!readOnly && onLoadFromPreset && (
              <button
                className="btn btn-sm"
                type="button"
                onClick={onLoadFromPreset}
                style={{ marginTop: '0.3rem', fontSize: '0.7rem' }}
              >
                Load from preset
              </button>
            )}
          </div>
        )}
      </Section>

      {/* Protection */}
      <Section title="Protection">
        {readOnly ? (
          <ReadOnlyField label="Protection Strategy" value={form.protectionStrategy} mono />
        ) : (
          <Field
            label="Strategy"
            value={form.protectionStrategy}
            onChange={v => patch('protectionStrategy', v)}
            readOnly={readOnly}
            type="select"
            options={protectionOpts}
          />
        )}
      </Section>

      {/* Validation */}
      <Section title="Validation">
        {readOnly ? (
          <ReadOnlyField label="Validator" value={form.validatorName} mono />
        ) : (
          <Field
            label="Validator"
            value={form.validatorName}
            onChange={v => patch('validatorName', v)}
            readOnly={readOnly}
            type="select"
            options={validatorOpts}
          />
        )}
      </Section>

      {/* Output */}
      <Section title="Output">
        <Field label="Filename Suffix" value={form.outputFilenameSuffix} onChange={v => patch('outputFilenameSuffix', v)} readOnly={readOnly} placeholder="_translated" />
        <Field label="Preserve Relative Path" value={form.outputPreserveRelativePath} onChange={v => patch('outputPreserveRelativePath', v === 'true')} readOnly={readOnly} type="checkbox" />
        <Field label="Overwrite Existing" value={form.outputOverwrite} onChange={v => patch('outputOverwrite', v === 'true')} readOnly={readOnly} type="checkbox" />
        <Field label="Backup Original" value={form.outputBackup} onChange={v => patch('outputBackup', v === 'true')} readOnly={readOnly} type="checkbox" />
      </Section>
    </div>
  );
}

export { Section, Field, ReadOnlyField };
