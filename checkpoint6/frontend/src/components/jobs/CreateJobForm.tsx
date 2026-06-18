import { useState } from 'react';
import type { TranslationOptionsResponse, TranslationProfile } from '../../api/types';
import type { DraftSelectionGroup } from '../../api/types';
import type { DraftFileMeta } from '../../contexts/DraftJobSelectionContext';
import type { CreateJobFormViewModel } from '../../hooks/jobs/useCreateJobForm';
import { FileSuggestionList, PathPicker } from '../../components';
import ModelDropdown from '../common/ModelDropdown';
import LanguageDropdown from '../common/LanguageDropdown';
import RuleSetSelector from '../common/RuleSetSelector';

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
/*  CompactDraftPreview — grouped file preview by mod metadata        */
/* ------------------------------------------------------------------ */

interface FileDisplayInfo {
  path: string;
  name: string;
  exists: boolean;
}

interface ModGroupInfo {
  modName: string;
  files: FileDisplayInfo[];
}

const MANUAL_GROUP_NAME = 'Manual / Ungrouped files';

/**
 * Build file info lookup from the backend grouped tree so we can
 * get file name + exists status for each path.
 */
function buildFileInfoMap(
  grouped: DraftSelectionGroup[],
): Record<string, { name: string; exists: boolean }> {
  const map: Record<string, { name: string; exists: boolean }> = {};
  const seen = new Set<string>();
  function walk(g: DraftSelectionGroup) {
    if (g.files) {
      for (const f of g.files) {
        if (!seen.has(f.path)) {
          seen.add(f.path);
          map[f.path] = { name: f.name, exists: f.exists };
        }
      }
    }
    if (g.children) {
      for (const child of g.children) {
        walk(child);
      }
    }
  }
  for (const g of grouped) walk(g);
  return map;
}

/**
 * Group flat draft files by mod metadata.
 * - Files with modName metadata are grouped by that name.
 * - Files without modName appear under "Manual / Ungrouped files".
 * - Order within each group preserves the original draft files order.
 */
function buildModGroups(
  draftFiles: string[],
  draftMeta: Record<string, DraftFileMeta>,
  grouped: DraftSelectionGroup[],
): ModGroupInfo[] {
  const infoMap = buildFileInfoMap(grouped);
  const groups = new Map<string, FileDisplayInfo[]>();
  const seen = new Set<string>();

  for (const path of draftFiles) {
    if (seen.has(path)) continue; // deduplicate
    seen.add(path);

    const meta = draftMeta[path];
    const modName =
      meta?.modName && meta.modName.trim() ? meta.modName.trim() : MANUAL_GROUP_NAME;
    const { name, exists } = infoMap[path] ?? {
      name: path.split('/').pop() || path,
      exists: true,
    };

    if (!groups.has(modName)) {
      groups.set(modName, []);
    }
    groups.get(modName)!.push({ path, name, exists });
  }

  const result: ModGroupInfo[] = [];

  // Named mod groups sorted by mod name
  const namedGroups: ModGroupInfo[] = [];
  for (const [modName, files] of groups) {
    if (modName !== MANUAL_GROUP_NAME) {
      namedGroups.push({ modName, files });
    }
  }
  namedGroups.sort((a, b) => a.modName.localeCompare(b.modName));
  result.push(...namedGroups);

  // Manual / Ungrouped files group goes last
  if (groups.has(MANUAL_GROUP_NAME)) {
    result.push({ modName: MANUAL_GROUP_NAME, files: groups.get(MANUAL_GROUP_NAME)! });
  }

  return result;
}

interface CompactDraftPreviewProps {
  draftFiles: string[];
  draftMeta: Record<string, DraftFileMeta>;
  grouped: DraftSelectionGroup[];
  onRemoveFile: (path: string) => Promise<void>;
  onRemoveFiles: (paths: string[]) => Promise<void>;
}

function CompactDraftPreview({
  draftFiles,
  draftMeta,
  grouped,
  onRemoveFile,
  onRemoveFiles,
}: CompactDraftPreviewProps) {
  if (draftFiles.length === 0) return null;

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const groups = buildModGroups(draftFiles, draftMeta, grouped);

  const toggleGroup = (modName: string) => {
    setExpandedGroups(prev => ({ ...prev, [modName]: !prev[modName] }));
  };

  return (
    <div style={{ marginTop: '0.6rem' }}>
      {groups.map(group => {
        const isExpanded = expandedGroups[group.modName] ?? false;

        return (
          <div
            key={group.modName}
            className="file-group-accordion"
            style={{
              marginBottom: '0.5rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
            }}
          >
            {/* Group header — clickable to toggle */}
            <div
              className="file-group-header"
              data-testid={`file-group-header-${group.modName.replace(/[\s/]+/g, '_')}`}
              onClick={() => toggleGroup(group.modName)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.25rem 0.5rem',
                background: 'var(--color-surface-2)',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <span className={`file-group-arrow${isExpanded ? ' open' : ''}`}>&#9654;</span>
                {group.modName} ({group.files.length})
              </span>
              <button
                className="btn btn-sm"
                onClick={e => {
                  e.stopPropagation();
                  onRemoveFiles(group.files.map(f => f.path));
                }}
                type="button"
                style={{
                  padding: '0.05rem 0.3rem',
                  fontSize: '0.6rem',
                  color: 'var(--color-text-muted)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
                title="Remove all files in this group"
              >
                Remove group
              </button>
            </div>

            {/* File list — only rendered when expanded */}
            {isExpanded && (
              <div style={{ padding: '0.25rem 0.5rem 0.25rem 1rem' }}>
                {group.files.map(f => (
                  <div
                    key={f.path}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.15rem 0',
                      fontSize: '0.7rem',
                      fontStyle: f.exists ? 'normal' : 'italic',
                      opacity: f.exists ? 1 : 0.7,
                    }}
                  >
                    <span title={f.path} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name}
                    </span>
                    <button
                      onClick={() => onRemoveFile(f.path)}
                      type="button"
                      style={{
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        padding: '0 0.1rem',
                        fontSize: '0.7rem',
                        color: 'var(--color-text-muted)',
                        lineHeight: 1,
                        marginLeft: '0.4rem',
                        flexShrink: 0,
                      }}
                      title="Remove file"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
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
  return (
    <>
    <div className="card">
      <div className="card-title">Create Job</div>

      {/* Game filter */}
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
        {!vm.selectedGameId && (
          <div style={{
            fontSize: '0.75rem',
            color: 'var(--color-text-muted)',
            marginTop: '0.25rem',
          }}>
            Select a game above to view available mods.
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/*  Input files — collapsible section with all file input modes    */}
      {/* ================================================================ */}
      <details style={{ marginBottom: '1rem' }} open>
        <summary style={{
          cursor: 'pointer',
          fontSize: '0.9rem',
          fontWeight: 600,
          padding: '0.25rem 0',
          color: 'var(--color-text)',
        }}>
          Input files
          {vm.draftFileCount > 0 && (
            <span style={{
              marginLeft: '0.5rem',
              fontSize: '0.75rem',
              color: 'var(--color-text-muted)',
              fontWeight: 400,
            }}>
              ({vm.draftFileCount} file{vm.draftFileCount !== 1 ? 's' : ''} selected)
            </span>
          )}
          {vm.draftLoading && (
            <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              loading...
            </span>
          )}
        </summary>
        <div style={{ paddingLeft: '0.5rem', borderLeft: '2px solid var(--color-surface-2)', marginTop: '0.5rem' }}>

          {/* --- Add from mods (multi-select) --- */}
          {vm.filteredMods.length > 0 && (
            <div className="form-group">
              <label>Add from mods</label>
              <div style={{
                maxHeight: '160px',
                overflowY: 'auto',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                padding: '0.25rem 0.5rem',
                marginBottom: '0.4rem',
              }}>
                {vm.filteredMods.map(m => (
                  <label key={m.path} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.2rem 0',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}>
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={vm.selectedModPaths.includes(m.path)}
                      onChange={() => {
                        if (vm.selectedModPaths.includes(m.path)) {
                          vm.setSelectedModPaths(vm.selectedModPaths.filter(p => p !== m.path));
                        } else {
                          vm.setSelectedModPaths([...vm.selectedModPaths, m.path]);
                        }
                      }}
                    />
                    <span>{m.name}{m.version ? ` (v${m.version})` : ''}</span>
                  </label>
                ))}
              </div>
              <button
                className="btn btn-sm btn-primary"
                onClick={vm.handleAddModFiles}
                disabled={vm.selectedModPaths.length === 0}
                type="button"
              >
                Add selected mods ({vm.selectedModPaths.length})
              </button>
            </div>
          )}

          {/* --- Search localisation files --- */}
          <div className="form-group">
            <label>Search localisation files</label>
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
            <div className="form-row" style={{ gap: '0.5rem' }}>
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

          {/* --- Add file path (manual/browse) --- */}
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

          {/* --- Selected translation files: textarea + compact preview --- */}
          <div className="form-group">
            <label style={{ marginBottom: '0.4rem' }}>
              File paths (one per line)
              {vm.draftFileCount > 0 && (
                <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, fontSize: '0.7rem', marginLeft: '0.4rem' }}>
                  ({vm.draftFileCount} file{vm.draftFileCount !== 1 ? 's' : ''})
                </span>
              )}
            </label>
            <textarea
              className="form-control"
              rows={5}
              placeholder={"/path/to/mod/localisation/english/example_l_english.yml"}
              value={vm.form.filePaths}
              onChange={e => vm.setFormField('filePaths', e.target.value)}
            />

            {/* Compact preview chips — grouped by mod */}
            <CompactDraftPreview
              draftFiles={vm.draftFiles}
              draftMeta={vm.draftMeta}
              grouped={vm.draftGrouped}
              onRemoveFile={vm.handleRemoveDraftFile}
              onRemoveFiles={vm.handleRemoveDraftFiles}
            />

            {/* Diagnostics */}
            {vm.draftDiagnostics.length > 0 && (
              <div style={{ padding: '0.25rem 0.5rem', marginTop: '0.25rem' }}>
                {vm.draftDiagnostics.map((d, i) => (
                  <div key={i} style={{
                    fontSize: '0.7rem',
                    color: d.level === 'error' ? 'var(--color-error)' : 'var(--color-warning, #e6a817)',
                    padding: '0.15rem 0',
                  }}>
                    {d.message}
                  </div>
                ))}
              </div>
            )}

            {vm.draftError && (
              <div style={{
                padding: '0.3rem 0.5rem',
                marginTop: '0.25rem',
                fontSize: '0.75rem',
                color: 'var(--color-error)',
                background: 'var(--color-surface-1)',
                borderRadius: 'var(--radius)',
              }}>
                Draft error: {vm.draftError}
              </div>
            )}
          </div>
        </div>
      </details>

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
          <LanguageDropdown
            value={vm.form.srcLang}
            onChange={v => vm.setFormField('srcLang', v)}
            placeholder="Source language"
            allowCustom
          />
        </div>
        <div className="form-group">
          <label>Target Language</label>
          <LanguageDropdown
            value={vm.form.dstLang}
            onChange={v => vm.setFormField('dstLang', v)}
            placeholder="Target language"
            allowCustom
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
          <ModelDropdown
            provider={vm.form.provider}
            value={vm.form.model}
            onChange={v => vm.setFormField('model', v)}
            placeholder="e.g. gpt-4"
            className="form-control"
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
                    className="form-checkbox"
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
              className="form-checkbox"
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
              className="form-checkbox"
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
                className="form-checkbox"
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
                  className="form-control"
                  value={vm.previewPromptMode}
                  onChange={e => vm.setPreviewPromptMode(e.target.value as 'batch' | 'single')}
                  style={{ width: 'auto', marginLeft: '0.3rem', fontSize: '0.7rem', padding: '0.1rem 0.2rem' }}
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
              <div className="subsection-title-muted">
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
              <div className="subsection-title">Batch System Prompt</div>
              <div style={{ fontSize: '0.7rem', padding: '0.25rem 0.4rem', background: 'var(--color-surface-2)', borderRadius: '3px', marginBottom: '0.3rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '60px', overflowY: 'auto', fontFamily: 'monospace' }}>
                {vm.effectivePrompt.batch_system_prompt || <em style={{ color: 'var(--color-text-muted)' }}>empty</em>}
              </div>
              <div className="subsection-title">Batch User Template</div>
              <div style={{ fontSize: '0.7rem', padding: '0.25rem 0.4rem', background: 'var(--color-surface-2)', borderRadius: '3px', marginBottom: '0.3rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '60px', overflowY: 'auto', fontFamily: 'monospace' }}>
                {vm.effectivePrompt.batch_user_template || <em style={{ color: 'var(--color-text-muted)' }}>empty</em>}
              </div>
              <div className="subsection-title">Single System Prompt</div>
              <div style={{ fontSize: '0.7rem', padding: '0.25rem 0.4rem', background: 'var(--color-surface-2)', borderRadius: '3px', marginBottom: '0.3rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '60px', overflowY: 'auto', fontFamily: 'monospace' }}>
                {vm.effectivePrompt.single_system_prompt || <em style={{ color: 'var(--color-text-muted)' }}>empty</em>}
              </div>
              <div className="subsection-title">Single User Template</div>
              <div style={{ fontSize: '0.7rem', padding: '0.25rem 0.4rem', background: 'var(--color-surface-2)', borderRadius: '3px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '60px', overflowY: 'auto', fontFamily: 'monospace' }}>
                {vm.effectivePrompt.single_user_template || <em style={{ color: 'var(--color-text-muted)' }}>empty</em>}
              </div>
            </div>
          )}

          {vm.form.promptOverrideEnabled && (
            <div style={{ padding: '0.4rem', marginBottom: '0.5rem', background: 'var(--color-surface-1)', borderRadius: 'var(--radius)' }}>
              <div className="subsection-title">Batch Templates</div>
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

              <div className="subsection-title">Single Templates</div>
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
                    className="form-checkbox"
                    checked={vm.form.logPrompts}
                    onChange={e => vm.setFormField('logPrompts', e.target.checked)}
                  />
                  Log prompts (includes full messages)
                </label>
              </div>
            </div>
          )}

          {/* Protection Rule Sets */}
          <div className="form-group">
            <label>Protection Rule Sets</label>
            <RuleSetSelector
              ruleSets={options?.rule_sets ?? []}
              selectedIds={vm.form.ruleSetIds}
              onChange={ids => {
                vm.setFormField('ruleSetIds', ids);
                // Auto-set protection strategy based on whether rule sets are selected
                vm.setFormField('protectionStrategy', ids.length > 0 ? 'rule_set' : '');
              }}
            />
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
                  className="form-checkbox"
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
                  className="form-checkbox"
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
                  className="form-checkbox"
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
              <button className="modal-close" onClick={vm.cancelProfileConfirm} aria-label="Close">&times;</button>
            </div>
            <div className="modal-body" style={{ minHeight: 'auto', fontSize: '0.85rem' }}>
              {vm.profileConfirmType === 'apply' ? (
                <>
                  <p style={{ margin: 0, lineHeight: 1.5 }}>
                    This will replace current translation settings with values from the selected profile. Selected files and mod selection will stay unchanged.
                  </p>
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
              <button className="modal-close" onClick={vm.closePreviewPrompt} aria-label="Close">&times;</button>
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
