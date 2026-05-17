import { useNavigate, Link } from 'react-router-dom';
import type { TranslationOptionsResponse, TranslationProfile } from '../../api/types';
import type { CreateJobFormViewModel } from '../../hooks/jobs/useCreateJobForm';
import { FileSuggestionList, AddedFilesChips, PathPicker } from '../../components';
import { displayNameForLanguage } from '../../utils/localisationLanguage';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface CreateJobFormProps {
  /** View model from useCreateJobForm hook */
  vm: CreateJobFormViewModel;
  /** Translation options (providers list) — loaded by page, shared */
  options: TranslationOptionsResponse | null;
  /** Profiles list — loaded by page, shared with ProfileEditorModal */
  profiles: TranslationProfile[];
  /** Open the profile editor modal with pre-filled config */
  onOpenProfileEditor: (config: Record<string, unknown>) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CreateJobForm({
  vm,
  options,
  profiles,
  onOpenProfileEditor,
}: CreateJobFormProps) {
  const navigate = useNavigate();

  return (
    <>
    <div className="card">
      <div className="card-title">Create Job</div>

      {/* Game filter + Mod selection */}
      <div className="form-group">
        <label>Game</label>
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <select
              className="form-control"
              value={vm.selectedGameId}
              onChange={e => vm.handleGameChange(e.target.value)}
            >
              <option value="">
                {vm.gamesLoading ? 'Loading games...' : '\u2014 Select a game \u2014'}
              </option>
              {vm.gamesWithMods.map(g => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {vm.selectedGameId ? (
        <div className="form-group">
          <label>Select mod</label>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <select
                className="form-control"
                value={vm.selectedMod?.mod_id ?? ''}
                onChange={e => {
                  const mod = vm.mods.find(m => m.mod_id === e.target.value);
                  if (mod) vm.handleSelectMod(mod);
                }}
              >
                <option value="">
                  {vm.modsLoading ? 'Loading mods...' : '\u2014 No mod selected \u2014'}
                </option>
                {vm.filteredMods.map(m => (
                  <option key={m.mod_id} value={m.mod_id}>
                    {m.name} {m.version ? `(v${m.version})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {vm.filteredMods.length === 0 && !vm.modsLoading && (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
              No mods discovered yet. <Link to="/games/stellaris">Open Stellaris</Link> and run Discover/Refresh first.
            </div>
          )}
        </div>
      ) : (
        <div style={{
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
          marginBottom: '0.75rem',
          padding: '0.5rem 0',
        }}>
          Select a game above to view available mods.
        </div>
      )}

      {/* Selected mod info */}
      {vm.selectedMod && (
        <div style={{
          padding: '0.5rem 0.75rem',
          background: 'var(--color-surface-2)',
          borderRadius: 'var(--radius)',
          marginBottom: '0.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}>
          <div style={{ fontSize: '0.8rem' }}>
            <strong>Using files from mod:</strong> {vm.selectedMod.name}
            {vm.selectedMod.localisation_paths.length > 0 && (
              <span style={{ color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
                ({vm.selectedMod.localisation_paths.length} files)
              </span>
            )}
          </div>
          <button className="btn btn-sm" onClick={vm.handleClearSelection} type="button">Clear selection</button>
        </div>
      )}

      {/* Language filter — only when a mod is selected */}
      {vm.selectedMod && vm.availableLanguages.length > 1 && (
        <div className="form-group">
          <label>Source language files</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>

            {/* Language selector */}
            <select
              className="form-control"
              value={vm.selectedLanguage}
              onChange={e => vm.setSelectedLanguage(e.target.value)}
              style={{ maxWidth: '200px' }}
            >
              {vm.availableLanguages.map(lang => (
                <option key={lang} value={lang}>
                  {displayNameForLanguage(lang)}
                </option>
              ))}
            </select>

            {/* Toggle: only selected language */}
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              cursor: 'pointer',
              userSelect: 'none',
              whiteSpace: 'nowrap',
              fontSize: '0.8rem',
            }}>
              <input
                type="checkbox"
                checked={vm.showOnlySelectedLanguage}
                onChange={e => vm.setShowOnlySelectedLanguage(e.target.checked)}
              />
              <span>Only selected language</span>
            </label>

            {/* Advanced mode warning */}
            {!vm.showOnlySelectedLanguage && (
              <span style={{
                color: 'var(--color-warning, #e6a817)',
                fontSize: '0.7rem',
                fontStyle: 'italic',
              }}>
                [&thinsp;!&thinsp;] Mixed languages selected
              </span>
            )}
          </div>
        </div>
      )}

      {/* Active mod banner (files passed from Mods page) */}
      {vm.modFromQuery && !vm.selectedMod && (
        <div style={{
          padding: '0.5rem 0.75rem',
          background: 'var(--color-surface-2)',
          borderRadius: 'var(--radius)',
          marginBottom: '0.75rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}>
          <div style={{ fontSize: '0.8rem' }}>
            <strong>Working with mod:</strong> {vm.modFromQuery}
          </div>
          <button className="btn btn-sm" onClick={() => navigate('/games/stellaris')} type="button">
            Back to mod
          </button>
        </div>
      )}

      {/* Active game config banner (files passed from OtherGame page) */}
      {vm.gameConfig && (
        <div style={{
          padding: '0.5rem 0.75rem',
          background: 'var(--color-surface-2)',
          borderRadius: 'var(--radius)',
          marginBottom: '0.75rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}>
          <div style={{ fontSize: '0.8rem' }}>
            <strong>Other Game files</strong>
            <span style={{ color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
              (handler: {String(vm.gameConfig.file_handler || '\u2014')})
            </span>
          </div>
          <button className="btn btn-sm" onClick={() => navigate('/games/generic')} type="button">
            Back to Other Game
          </button>
        </div>
      )}

      {/* File search */}
      <div className="form-group">
        <label>Add search root path</label>
        <div className="form-row" style={{ gap: '0.5rem' }}>
          <div style={{ flex: 1 }}>
            <PathPicker
              value={vm.pickSearchPath}
              onChange={vm.setPickSearchPath}
              mode="directory"
              placeholder="Pick a root directory to search"
            />
          </div>
          <button
            className="btn"
            onClick={() => {
              if (vm.pickSearchPath.trim()) {
                vm.setSearchQuery(vm.searchQuery + (vm.searchQuery ? '\n' : '') + vm.pickSearchPath.trim());
                vm.setPickSearchPath('');
              }
            }}
            type="button"
            style={{ alignSelf: 'flex-end', marginBottom: '0.85rem' }}
          >
            Add Search Path
          </button>
        </div>
      </div>

      <div className="form-group">
        <label>Search localisation files</label>
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <textarea
              className="form-control"
              rows={2}
              placeholder={"Enter mod directory path(s) to search for localisation files\n/Users/me/paradox/mods/my_mod"}
              value={vm.searchQuery}
              onChange={e => vm.setSearchQuery(e.target.value)}
            />
          </div>
          <div className="form-group" style={{ flex: 0, display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn btn-primary" onClick={vm.handleSearch} disabled={vm.searching}>
              {vm.searching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
        {vm.searchError && (
          <div className="alert alert-error" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
            {vm.searchError}
          </div>
        )}
      </div>

      <FileSuggestionList
        files={vm.foundFiles}
        addedPaths={vm.addedPaths}
        onAdd={f => vm.addPath(f.path)}
        onAddAll={vm.handleAddAll}
        onRemove={f => vm.removePath(f)}
      />

      <div className="form-group">
        <label>Add file path</label>
        <div className="form-row" style={{ gap: '0.5rem' }}>
          <div style={{ flex: 1 }}>
            <PathPicker
              value={vm.pickFilePath}
              onChange={vm.setPickFilePath}
              mode="file"
              extensions={['.yml', '.yaml']}
              placeholder="Pick a .yml/.yaml file"
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (vm.pickFilePath.trim()) {
                vm.addPath(vm.pickFilePath.trim());
                vm.setPickFilePath('');
              }
            }}
            type="button"
            style={{ alignSelf: 'flex-end', marginBottom: '0.85rem' }}
          >
            Add File
          </button>
        </div>
      </div>

      <div className="form-group">
        <label>File paths (one per line)</label>
        <textarea
          className="form-control"
          rows={3}
          placeholder={"/path/to/mod/localisation/english/example_l_english.yml"}
          value={vm.form.filePaths}
          onChange={e => vm.setFormField('filePaths', e.target.value)}
        />
      </div>

      <AddedFilesChips paths={vm.form.filePathList} onRemove={vm.removePath} />

      <div className="form-row">
        <div className="form-group">
          <label>Job Name</label>
          <input
            className="form-control"
            placeholder="Optional"
            value={vm.form.jobName}
            onChange={e => vm.setFormField('jobName', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label>Source Language</label>
          <input
            className="form-control"
            value={vm.form.srcLang}
            onChange={e => vm.setFormField('srcLang', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label>Target Language</label>
          <input
            className="form-control"
            value={vm.form.dstLang}
            onChange={e => vm.setFormField('dstLang', e.target.value)}
          />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Provider</label>
          <select
            className="form-control"
            value={vm.form.provider}
            onChange={e => {
              vm.setFormField('provider', e.target.value);
              // Clear selected keys when provider changes (they may not match)
              vm.setFormField('apiKeyIds', []);
            }}
          >
            <option value="">Default</option>
            {options?.providers.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Model</label>
          <input
            className="form-control"
            placeholder="e.g. gpt-4"
            value={vm.form.model}
            onChange={e => vm.setFormField('model', e.target.value)}
          />
        </div>
      </div>

      {/* API Keys selector */}
      <div className="form-group">
        <label>
          API Keys{vm.form.provider ? ` \u2014 ${vm.form.provider}` : ''}
        </label>
        {vm.apiKeysLoading ? (
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', padding: '0.25rem 0' }}>
            Loading API keys...
          </div>
        ) : vm.filteredApiKeys.length === 0 ? (
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', padding: '0.25rem 0' }}>
            {vm.form.provider
              ? 'No API keys configured for this provider. Go to Settings to add one.'
              : 'No API keys found. Select a provider or go to Settings to add API keys.'}
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
            padding: '0.35rem 0',
          }}>
            {vm.filteredApiKeys.map(key => {
              const isChecked = vm.form.apiKeyIds.includes(key.id);
              return (
                <label
                  key={key.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.3rem 0.5rem',
                    borderRadius: 'var(--radius)',
                    background: isChecked ? 'var(--color-surface-2)' : 'transparent',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    userSelect: 'none',
                    transition: 'background 0.15s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {
                      const newIds = isChecked
                        ? vm.form.apiKeyIds.filter(id => id !== key.id)
                        : [...vm.form.apiKeyIds, key.id];
                      vm.setFormField('apiKeyIds', newIds);
                    }}
                  />
                  <span style={{ fontWeight: isChecked ? 600 : 400 }}>
                    {key.label || key.provider}
                  </span>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>
                    ({key.masked_value})
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Translation Profile selector */}
      <div className="form-group">
        <label>Translation Profile</label>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <select
            className="form-control"
            value={vm.profileSelectValue}
            onChange={e => vm.handleProfileSelect(e.target.value)}
            style={{ flex: 1 }}
          >
            <option value="">— No profile —</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.is_system ? ' (system)' : ''} &mdash; {p.game}
              </option>
            ))}
          </select>
          <button
            className="btn btn-sm btn-primary"
            type="button"
            onClick={() => {
              onOpenProfileEditor({
                src_lang: vm.form.srcLang,
                dst_lang: vm.form.dstLang,
                batch_size: vm.form.batchSize,
                use_cache: vm.form.useCache,
                save_raw_responses: vm.form.saveRawResponses,
                runtime: {
                  provider: vm.form.provider,
                  model: vm.form.model,
                  temperature: vm.form.temperature,
                },
                prompt: {
                  profile_name: vm.form.promptProfileName,
                },
                protection: {
                  strategy: vm.form.protectionStrategy,
                },
                validation: {
                  validator_name: vm.form.validatorName,
                },
                output: {
                  dir: vm.form.outputDir,
                  filename_suffix: vm.form.outputFilenameSuffix,
                  preserve_relative_path: vm.form.outputPreserveRelativePath,
                  overwrite: vm.form.outputOverwrite,
                  backup: vm.form.outputBackup,
                },
                ...(vm.gameConfig || {}),
              });
            }}
            style={{ fontSize: '0.7rem', whiteSpace: 'nowrap', flexShrink: 0 }}
            title="Save current configuration as a new profile"
          >
            Save as profile
          </button>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Batch Size</label>
          <input
            className="form-control"
            type="number"
            value={vm.form.batchSize}
            onChange={e => vm.setFormField('batchSize', Number(e.target.value))}
          />
        </div>
        <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '0.45rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={vm.form.useCache}
              onChange={e => vm.setFormField('useCache', e.target.checked)}
            />
            Use Cache
          </label>
        </div>
        <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '0.45rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={vm.form.saveRawResponses}
              onChange={e => vm.setFormField('saveRawResponses', e.target.checked)}
            />
            Save Raw Responses
          </label>
        </div>
      </div>

      {vm.selectedProfileId && (
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: '0.15rem', marginBottom: '0.5rem' }}>
          Profile selected. Settings can be overridden below.
        </div>
      )}

      {/* Advanced config — collapsible */}
      <details style={{ marginBottom: '0.5rem' }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, padding: '0.25rem 0' }}>
          Advanced config
        </summary>
        <div style={{ padding: '0.5rem 0 0.25rem 0', borderTop: '1px solid var(--color-border)', marginTop: '0.25rem' }}>
          {/* Prompt Profile */}
          <div className="form-group">
            <label>Prompt Profile</label>
            <select
              className="form-control"
              value={vm.form.promptProfileName}
              onChange={e => vm.setFormField('promptProfileName', e.target.value)}
            >
              <option value="">— None —</option>
              {options?.prompt_profiles.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* Prompt template override (TASK 2 + TASK 7) */}
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.8rem' }}>
              <input
                type="checkbox"
                checked={vm.form.promptOverrideEnabled}
                onChange={e => {
                  vm.setFormField('promptOverrideEnabled', e.target.checked);
                  // When enabling override, prefill from effective templates
                  if (e.target.checked && vm.effectivePrompt) {
                    vm.setFormField('batchSystemPrompt', vm.effectivePrompt.batch_system_prompt);
                    vm.setFormField('batchUserTemplate', vm.effectivePrompt.batch_user_template);
                    vm.setFormField('singleSystemPrompt', vm.effectivePrompt.single_system_prompt);
                    vm.setFormField('singleUserTemplate', vm.effectivePrompt.single_user_template);
                  }
                }}
              />
              Override prompt templates
            </label>
          </div>

          {/* Preview effective prompt button (always visible when profile selected) */}
          {(vm.form.promptProfileName || vm.effectivePrompt) && (
            <div style={{ marginBottom: '0.5rem' }}>
              <button
                className="btn btn-sm"
                onClick={vm.handlePreviewPrompt}
                disabled={vm.previewPromptLoading}
                style={{ fontSize: '0.75rem' }}
              >
                {vm.previewPromptLoading ? 'Building preview...' : 'Preview effective prompt'}
              </button>
              <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                Mode:
                <select
                  value={vm.previewPromptMode}
                  onChange={e => vm.setPreviewPromptMode(e.target.value as 'batch' | 'single')}
                  style={{ marginLeft: '0.3rem', fontSize: '0.7rem', padding: '0.1rem 0.2rem' }}
                >
                  <option value="batch">Batch</option>
                  <option value="single">Single</option>
                </select>
              </span>
            </div>
          )}

          {/* Effective prompt templates (read-only, shown when override is OFF) */}
          {!vm.form.promptOverrideEnabled && vm.effectivePrompt && (
            <div style={{ padding: '0.4rem', marginBottom: '0.5rem', background: 'var(--color-surface-1)', borderRadius: 'var(--radius)', opacity: 0.85 }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.3rem', color: 'var(--color-text-muted)' }}>
                Effective prompt templates (read-only)
                {vm.effectivePrompt.source && (
                  <span style={{ marginLeft: '0.4rem', fontWeight: 400, fontStyle: 'italic' }}>
                    — source: {vm.effectivePrompt.source}
                  </span>
                )}
              </div>
              {vm.effectivePrompt.warnings.length > 0 && (
                <div style={{ fontSize: '0.65rem', color: 'var(--color-warning)', marginBottom: '0.3rem' }}>
                  {vm.effectivePrompt.warnings.join('; ')}
                </div>
              )}
              <div style={{ fontSize: '0.65rem', fontWeight: 600, marginBottom: '0.2rem' }}>Batch System Prompt</div>
              <div style={{ fontSize: '0.7rem', padding: '0.25rem 0.4rem', background: 'var(--color-surface-2)', borderRadius: '3px', marginBottom: '0.3rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '60px', overflowY: 'auto', fontFamily: 'monospace' }}>
                {vm.effectivePrompt.batch_system_prompt || <em style={{ color: 'var(--color-text-muted)' }}>empty</em>}
              </div>
              <div style={{ fontSize: '0.65rem', fontWeight: 600, marginBottom: '0.2rem' }}>Batch User Template</div>
              <div style={{ fontSize: '0.7rem', padding: '0.25rem 0.4rem', background: 'var(--color-surface-2)', borderRadius: '3px', marginBottom: '0.3rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '60px', overflowY: 'auto', fontFamily: 'monospace' }}>
                {vm.effectivePrompt.batch_user_template || <em style={{ color: 'var(--color-text-muted)' }}>empty</em>}
              </div>
              <div style={{ fontSize: '0.65rem', fontWeight: 600, marginBottom: '0.2rem' }}>Single System Prompt</div>
              <div style={{ fontSize: '0.7rem', padding: '0.25rem 0.4rem', background: 'var(--color-surface-2)', borderRadius: '3px', marginBottom: '0.3rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '60px', overflowY: 'auto', fontFamily: 'monospace' }}>
                {vm.effectivePrompt.single_system_prompt || <em style={{ color: 'var(--color-text-muted)' }}>empty</em>}
              </div>
              <div style={{ fontSize: '0.65rem', fontWeight: 600, marginBottom: '0.2rem' }}>Single User Template</div>
              <div style={{ fontSize: '0.7rem', padding: '0.25rem 0.4rem', background: 'var(--color-surface-2)', borderRadius: '3px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '60px', overflowY: 'auto', fontFamily: 'monospace' }}>
                {vm.effectivePrompt.single_user_template || <em style={{ color: 'var(--color-text-muted)' }}>empty</em>}
              </div>
            </div>
          )}

          {vm.form.promptOverrideEnabled && (
            <div style={{ padding: '0.4rem', marginBottom: '0.5rem', background: 'var(--color-surface-1)', borderRadius: 'var(--radius)' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.3rem' }}>Batch Templates</div>
              <div className="form-group">
                <label>Batch System Prompt</label>
                <input
                  className="form-control"
                  placeholder="You are a translation engine..."
                  value={vm.form.batchSystemPrompt}
                  onChange={e => vm.setFormField('batchSystemPrompt', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Batch User Template</label>
                <input
                  className="form-control"
                  placeholder={"{texts}"}
                  value={vm.form.batchUserTemplate}
                  onChange={e => vm.setFormField('batchUserTemplate', e.target.value)}
                />
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', marginBottom: '0.4rem' }}>
                Placeholders: {`{texts}`}, {`{src_lang}`}, {`{dst_lang}`}, {`{src_lang_code}`}, {`{dst_lang_code}`}
              </div>

              <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.3rem' }}>Single Templates</div>
              <div className="form-group">
                <label>Single System Prompt</label>
                <input
                  className="form-control"
                  placeholder="Translate from {src_lang} to {dst_lang}..."
                  value={vm.form.singleSystemPrompt}
                  onChange={e => vm.setFormField('singleSystemPrompt', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Single User Template</label>
                <input
                  className="form-control"
                  placeholder="{text}"
                  value={vm.form.singleUserTemplate}
                  onChange={e => vm.setFormField('singleUserTemplate', e.target.value)}
                />
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', marginBottom: '0.4rem' }}>
                Placeholders: {`{text}`}, {`{texts}`}, {`{src_lang}`}, {`{dst_lang}`}, {`{src_lang_code}`}, {`{dst_lang_code}`}
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.75rem' }}>
                  <input
                    type="checkbox"
                    checked={vm.form.logPrompts}
                    onChange={e => vm.setFormField('logPrompts', e.target.checked)}
                  />
                  Log prompts (includes full messages)
                </label>
              </div>
            </div>
          )}

          {/* Protection Strategy */}
          <div className="form-group">
            <label>Protection Strategy</label>
            <select
              className="form-control"
              value={vm.form.protectionStrategy}
              onChange={e => vm.setFormField('protectionStrategy', e.target.value)}
            >
              <option value="">— None —</option>
              {options?.protection_strategies.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Validator */}
          <div className="form-group">
            <label>Validator</label>
            <select
              className="form-control"
              value={vm.form.validatorName}
              onChange={e => vm.setFormField('validatorName', e.target.value)}
            >
              <option value="">— None —</option>
              {options?.validators.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>

          {/* Output settings */}
          <div className="form-group">
            <label>Output Directory</label>
            <input
              className="form-control"
              placeholder="Optional"
              value={vm.form.outputDir}
              onChange={e => vm.setFormField('outputDir', e.target.value)}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Filename Suffix</label>
              <input
                className="form-control"
                placeholder="e.g. _translated"
                value={vm.form.outputFilenameSuffix}
                onChange={e => vm.setFormField('outputFilenameSuffix', e.target.value)}
              />
            </div>
          </div>

          <div className="form-row" style={{ gap: '1rem', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '0.45rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.8rem' }}>
                <input
                  type="checkbox"
                  checked={vm.form.outputPreserveRelativePath}
                  onChange={e => vm.setFormField('outputPreserveRelativePath', e.target.checked)}
                />
                Preserve Relative Paths
              </label>
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '0.45rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.8rem' }}>
                <input
                  type="checkbox"
                  checked={vm.form.outputOverwrite}
                  onChange={e => vm.setFormField('outputOverwrite', e.target.checked)}
                />
                Overwrite
              </label>
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '0.45rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.8rem' }}>
                <input
                  type="checkbox"
                  checked={vm.form.outputBackup}
                  onChange={e => vm.setFormField('outputBackup', e.target.checked)}
                />
                Backup
              </label>
            </div>
          </div>

          {/* Runtime advanced fields */}
          <div className="form-row">
            <div className="form-group">
              <label>Temperature</label>
              <input
                className="form-control"
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={vm.form.temperature}
                onChange={e => vm.setFormField('temperature', Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label>Max Retries</label>
              <input
                className="form-control"
                type="number"
                min="0"
                value={vm.form.maxRetries}
                onChange={e => vm.setFormField('maxRetries', Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label>Timeout Sec</label>
              <input
                className="form-control"
                type="number"
                min="0"
                value={vm.form.timeoutSec}
                onChange={e => vm.setFormField('timeoutSec', Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label>Max Completion Tokens</label>
              <input
                className="form-control"
                type="number"
                min="0"
                value={vm.form.maxCompletionTokens}
                onChange={e => vm.setFormField('maxCompletionTokens', Number(e.target.value))}
              />
            </div>
          </div>
        </div>
      </details>

      {/* Validation errors */}
      {vm.validationErrors.length > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          {vm.validationErrors.map((err, i) => (
            <div
              key={i}
              className="alert alert-warning"
              style={{
                fontSize: '0.75rem',
                padding: '0.3rem 0.5rem',
                marginBottom: '0.2rem',
              }}
            >
              {err}
            </div>
          ))}
        </div>
      )}

      <div className="form-actions">
        <button className="btn" onClick={vm.handlePreviewPlan} disabled={vm.previewLoading || vm.validationErrors.length > 0}>
          {vm.previewLoading ? 'Preparing...' : 'Preview Plan'}
        </button>
        <button className="btn btn-primary" onClick={vm.handleCreateJob} disabled={vm.creatingJob || vm.validationErrors.length > 0}>
          {vm.creatingJob ? 'Creating...' : 'Create Job'}
        </button>
        <button className="btn" onClick={vm.handleResetDefaults} type="button" style={{ marginLeft: 'auto' }}>
          Reset to defaults
        </button>
      </div>

      {vm.previewData && (
        <div style={{
          marginTop: '1rem',
          padding: '0.75rem',
          background: 'var(--color-surface-2)',
          borderRadius: 'var(--radius)',
          fontSize: '0.8rem',
        }}>
          <strong>Plan Preview</strong>
          <div style={{ marginTop: '0.3rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <span>Units: {vm.previewData.totalUnits}</span>
            <span>Tasks: {vm.previewData.totalTasks}</span>
            <span>Batch size: {vm.previewData.batchSize}</span>
            <span>Cache hits: {vm.previewData.cacheHits}</span>
            <span>Cache misses: {vm.previewData.cacheMisses}</span>
          </div>

          {/* Diagnostics inline */}
          {(vm.previewData.hasBlockingErrors ||
            (vm.previewData.warnings && vm.previewData.warnings.length > 0) ||
            (vm.previewData.errors && vm.previewData.errors.length > 0)) && (
            <div style={{
              marginTop: '0.5rem',
              borderTop: '1px solid var(--color-border)',
              paddingTop: '0.4rem',
            }}>
              {vm.previewData.hasBlockingErrors && (
                <div className="alert alert-error" style={{
                  padding: '0.3rem 0.5rem',
                  fontSize: '0.75rem',
                  marginBottom: '0.25rem',
                }}>
                  <strong>Some files cannot be processed. Translation cannot be started.</strong>
                </div>
              )}
              {vm.previewData.warnings?.map((w, i) => (
                <div key={i} className="alert alert-warning" style={{
                  padding: '0.3rem 0.5rem',
                  fontSize: '0.75rem',
                  marginBottom: '0.25rem',
                }}>
                  {w}
                </div>
              ))}
              {(vm.previewData.errors ?? []).length > 0 && (
                <details style={{ marginTop: '0.25rem' }}>
                  <summary style={{ fontSize: '0.75rem', cursor: 'pointer', color: 'var(--color-error)' }}>
                    Parse errors ({(vm.previewData.errors ?? []).length})
                  </summary>
                  <div style={{ marginTop: '0.25rem', maxHeight: '150px', overflowY: 'auto' }}>
                    {(vm.previewData.errors ?? []).map((e, i) => (
                      <div key={i} style={{
                        fontSize: '0.7rem',
                        padding: '0.15rem 0',
                        wordBreak: 'break-all',
                        fontFamily: 'monospace',
                      }}>
                        {e}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>

      {/* Profile confirmation modal */}
      {vm.showProfileConfirm && (
        <div
          className="modal-overlay"
          onClick={vm.cancelProfileConfirm}
        >
          <div className="modal-content" style={{ width: '420px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>
                {vm.profileConfirmType === 'apply'
                  ? 'Apply translation profile?'
                  : 'Clear selected profile?'}
              </span>
              <button className="btn btn-sm" onClick={vm.cancelProfileConfirm}>&times;</button>
            </div>
            <div className="modal-body" style={{ minHeight: 'auto', fontSize: '0.85rem' }}>
              {vm.profileConfirmType === 'apply' ? (
                <>
                  <p style={{ margin: 0, lineHeight: 1.5 }}>
                    This will replace current translation settings with values from the selected profile. Selected files and mod selection will stay unchanged.
                  </p>
                  {vm.profileGameWarning && (
                    <div
                      className="alert alert-info"
                      style={{
                        marginTop: '10px',
                        padding: '8px 10px',
                        fontSize: '0.8rem',
                        lineHeight: 1.4,
                      }}
                    >
                      {vm.profileGameWarning}
                    </div>
                  )}
                </>
              ) : (
                <p style={{ margin: 0, lineHeight: 1.5 }}>
                  This will unlink the current profile. Form field values will not be changed.
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={vm.cancelProfileConfirm}>Cancel</button>
              <button className="btn btn-primary" onClick={vm.confirmProfileApply}>
                {vm.profileConfirmType === 'apply' ? 'Apply profile' : 'Clear profile'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview prompt modal (TASK 7) */}
      {vm.previewPromptData && (
        <div className="modal-overlay" onClick={vm.closePreviewPrompt}>
          <div className="modal-content" style={{ width: '600px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>Prompt Preview ({vm.previewPromptMode})</span>
              <button className="btn btn-sm" onClick={vm.closePreviewPrompt}>&times;</button>
            </div>
            <div className="modal-body" style={{ minHeight: 'auto', fontSize: '0.8rem' }}>
              {vm.previewPromptData.errors.length > 0 && (
                <div style={{ marginBottom: '0.5rem' }}>
                  {vm.previewPromptData.errors.map((err, i) => (
                    <div key={i} className="alert alert-error" style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', marginBottom: '0.2rem' }}>{err}</div>
                  ))}
                </div>
              )}
              {vm.previewPromptData.warnings.length > 0 && (
                <div style={{ marginBottom: '0.5rem' }}>
                  {vm.previewPromptData.warnings.map((w, i) => (
                    <div key={i} className="alert alert-warning" style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', marginBottom: '0.2rem' }}>{w}</div>
                  ))}
                </div>
              )}
              <div style={{ marginBottom: '0.5rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.75rem', marginBottom: '0.2rem' }}>System Message</div>
                <pre style={{
                  fontSize: '0.7rem',
                  padding: '0.5rem',
                  background: 'var(--color-surface-2)',
                  borderRadius: '3px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '200px',
                  overflowY: 'auto',
                  margin: 0,
                }}>{vm.previewPromptData.system_message || <em style={{ color: 'var(--color-text-muted)' }}>empty</em>}</pre>
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.75rem', marginBottom: '0.2rem' }}>User Message</div>
                <pre style={{
                  fontSize: '0.7rem',
                  padding: '0.5rem',
                  background: 'var(--color-surface-2)',
                  borderRadius: '3px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '200px',
                  overflowY: 'auto',
                  margin: 0,
                }}>{vm.previewPromptData.user_message || <em style={{ color: 'var(--color-text-muted)' }}>empty</em>}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </>

  );
}
