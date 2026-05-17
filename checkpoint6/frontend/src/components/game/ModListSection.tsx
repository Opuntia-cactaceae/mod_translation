import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, useToast } from '../../App';
import { mapSettingsResponse } from '../../domain/settings';
import { PathPicker } from '..';
import { groupLocalisationFiles, detectLanguageFromPath } from '../../utils/localisationGrouping';
import type { LocalisationGroup } from '../../utils/localisationGrouping';
import {
  filterFilesByLanguage,
  groupFilesByLanguage,
  displayNameForLanguage,
  getLanguageBadge,
  normaliseLocalisationLanguage,
  detectLocalisationLanguage,
} from '../../utils/localisationLanguage';
import { usePersistentState } from '../../hooks/usePersistentState';
import { STORAGE_KEYS } from '../../utils/storageKeys';
import { useDraftJobSelectionApi } from '../../hooks/useDraftJobSelectionApi';
import { TranslationPreviewModal } from './TranslationPreviewModal';
import { useDragSafeClose } from '../../hooks/useDragSafeClose';
import {
  getModKey,
  canTranslateMod,
  getInstallButtonLabel,
  getLocalisationPaths,
  hasInstallConflict,
  getDescriptorPath,
  getInstalledPath,
  getModStatusLabel,
  getSupportedVersion,
  mapTranslationPreview,
  type ModModel,
  type TranslationPreviewModel,
} from '../../domain';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getCommonParentDir(paths: string[]): string | null {
  if (paths.length === 0) return null;
  if (paths.length === 1) {
    return paths[0].substring(0, paths[0].lastIndexOf('/')) || paths[0];
  }
  let prefix = paths[0];
  for (const p of paths.slice(1)) {
    while (!p.startsWith(prefix)) {
      prefix = prefix.substring(0, prefix.lastIndexOf('/'));
      if (!prefix) return null;
    }
  }
  return prefix;
}

/**
 * Determine the default source language for a mod.
 * Prefers "en" if English files exist, otherwise returns the
 * first language in sorted order.
 */
function getDefaultLangForMod(localisationPaths: string[]): string {
  const grouped = groupFilesByLanguage(localisationPaths);
  const langs = Object.keys(grouped).filter(l => l !== 'unknown').sort();
  if (langs.length === 0) return 'en';
  if (langs.includes('en')) return 'en';
  return langs[0];
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ModListSectionProps {
  mods: ModModel[];
  onRefreshMods: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ModListSection({ mods, onRefreshMods }: ModListSectionProps) {
  const toast = useToast();
  const navigate = useNavigate();

  // Expanded/collapsed state for each mod
  const [expandedMods, setExpandedMods] = usePersistentState<Record<string, boolean>>(
    STORAGE_KEYS.expandedMods,
    {},
  );

  // Expanded/collapsed state for each group within a mod
  const [expandedGroups, setExpandedGroups] = usePersistentState<Record<string, boolean>>(
    STORAGE_KEYS.expandedLocalisationGroups,
    {},
  );

  // Visible file count per group for Load more
  const [visibleFilesByGroup, setVisibleFilesByGroup] = useState<Record<string, number>>({});

  // Selected source language per mod (persistent)
  const [selectedLanguageByMod, setSelectedLanguageByMod] = usePersistentState<Record<string, string>>(
    STORAGE_KEYS.selectedLanguageByMod,
    {},
  );

  // Toggle: show only selected language files, or all localisation files
  const [showOnlySelected, setShowOnlySelected] = usePersistentState<boolean>(
    STORAGE_KEYS.showOnlySelectedLanguage,
    true,
  );

  // Advanced action confirmation state
  const [advancedConfirmAction, setAdvancedConfirmAction] = useState<{
    type: 'add_all_visible' | 'translate_all_visible';
    mod: ModModel;
    visibleFiles: string[];
    languages: string[];
  } | null>(null);
  const advancedConfirmClose = useDragSafeClose(
    useCallback(() => setAdvancedConfirmAction(null), []),
  );

  // Translation preview state
  const [previewState, setPreviewState] = useState<{
    show: boolean;
    name: string;
    filePaths: string[];
    config: Record<string, unknown>;
  }>({ show: false, name: '', filePaths: [], config: {} });
  const [previewData, setPreviewData] = useState<TranslationPreviewModel | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // Draft job file selection (Part 2: Add to job UX)
  const draftApi = useDraftJobSelectionApi();
  const { draftFiles, addFile: draftAddFile, addFiles: draftAddFiles, removeFile: draftRemoveFile, isFileAdded } = draftApi;

  // Descriptor
  const [descriptorPath, setDescriptorPath] = useState('');
  const [descriptorText, setDescriptorText] = useState<string | null>(null);
  const [descriptorLoading, setDescriptorLoading] = useState(false);

  // Install
  const [installSource, setInstallSource] = useState('');
  const [installTarget, setInstallTarget] = useState('');
  const [installTargetDirty, setInstallTargetDirty] = useState(false);
  const [installTargetDefault, setInstallTargetDefault] = useState<string | null>(null);
  const [installResult, setInstallResult] = useState<{ success: boolean; message: string } | null>(null);
  const [installing, setInstalling] = useState(false);

  // Stellaris cache
  const [cachePreview, setCachePreview] = useState<{ items_to_delete: any[]; total_size_bytes: number } | null>(null);
  const [cacheCleaning, setCacheCleaning] = useState(false);
  const [cacheResult, setCacheResult] = useState<{ success: boolean; message: string } | null>(null);

  // Load settings on mount for install target default
  useEffect(() => {
    api.getSettings()
      .then(res => {
        const model = mapSettingsResponse(res.settings);
        const stellarisGs = model.game_settings?.stellaris;
        // Prefer game_settings.stellaris.mods_dir, fallback to paths.stellaris_mods_dir
        const stellarisModsDir = stellarisGs?.mods_dir || model.paths?.stellaris_mods_dir;
        if (stellarisModsDir && typeof stellarisModsDir === 'string' && stellarisModsDir.trim()) {
          const dir = stellarisModsDir.trim();
          setInstallTargetDefault(dir);
          if (!installTarget.trim() && !installTargetDirty) {
            setInstallTarget(dir);
          }
        }
      })
      .catch(() => { /* silent */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Handlers ---- */

  async function handleReadDescriptor(path: string) {
    setDescriptorLoading(true);
    setDescriptorPath(path);
    setDescriptorText(null);
    try {
      const res = await api.readDescriptor({ path });
      setDescriptorText(res.descriptor_text);
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to read descriptor', 'error');
    } finally {
      setDescriptorLoading(false);
    }
  }

  async function handleInstall(sourcePath: string, action: string) {
    if (!installTarget.trim()) {
      toast.showToast('Enter target directory', 'error');
      return;
    }
    setInstalling(true);
    setInstallResult(null);
    try {
      const opts: { source_path: string; target_dir: string; overwrite?: boolean; backup_on_overwrite?: boolean } = {
        source_path: sourcePath,
        target_dir: installTarget.trim(),
      };
      if (action === 'reinstall') {
        opts.overwrite = true;
        opts.backup_on_overwrite = true;
      }
      const res = await api.installMod(opts);
      if (res.success) {
        const parts = [`${res.files_copied} files copied`];
        if (res.backup_path) parts.push(`backup: ${res.backup_path}`);
        setInstallResult({ success: true, message: parts.join('; ') });
        toast.showToast(action === 'reinstall' ? 'Mod reinstalled' : 'Mod installed');
        onRefreshMods();
      } else {
        setInstallResult({ success: false, message: res.errors?.join(', ') || 'Install failed' });
      }
    } catch (err) {
      if (err instanceof ApiError) setInstallResult({ success: false, message: err.message });
      else setInstallResult({ success: false, message: 'Install error' });
    } finally {
      setInstalling(false);
    }
  }

  async function handleRevealPath(path: string) {
    try {
      const res = await api.revealPath({ path });
      if (!res.success) {
        toast.showToast(res.message, 'error');
      }
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to open folder', 'error');
    }
  }

  /* ---- Preview & Translate flow ---- */

  async function openTranslatePreview(filePaths: string[], name: string) {
    if (filePaths.length === 0) {
      toast.showToast('No localisation files to translate', 'error');
      return;
    }
    setPreviewState({ show: true, name, filePaths, config: {} });
    setPreviewData(null);
    setPreviewError(null);
    setPreviewLoading(true);

    try {
      const settingsRes = await api.getSettings();
      const model = mapSettingsResponse(settingsRes.settings);
      const lang = model.language;
      const runtime = model.runtime_defaults;
      const trans = model.translation_defaults;

      let srcLang = lang?.default_src_lang || 'en';
      const langMatch = filePaths[0]?.match(/l_(\w+)\.yml$/);
      if (langMatch) {
        const langMap: Record<string, string> = {
          english: 'en', french: 'fr', german: 'de', russian: 'ru',
          spanish: 'es', polish: 'pl', japanese: 'ja', korean: 'ko',
          simp_chinese: 'zh', brazilian: 'pt-BR', portuguese: 'pt',
          italian: 'it', dutch: 'nl', swedish: 'sv', czech: 'cs',
          hungarian: 'hu', turkish: 'tr', arabic: 'ar',
        };
        const detected = langMap[langMatch[1]];
        if (detected) srcLang = detected;
      }

      const config: Record<string, unknown> = {
        src_lang: srcLang,
        dst_lang: lang?.default_dst_lang || 'ru',
        provider: runtime?.default_provider || '',
        model: runtime?.default_model || '',
        batch_size: trans?.default_batch_size ?? 10,
        use_cache: trans?.default_use_cache ?? true,
      };

      setPreviewState(prev => ({ ...prev, config }));

      const res = await api.previewTranslationPlan({
        file_paths: filePaths,
        config,
      });
      setPreviewData(mapTranslationPreview(res));
    } catch (err) {
      if (err instanceof ApiError) setPreviewError(err.message);
      else setPreviewError('Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function confirmTranslatePreview() {
    if (!previewState.filePaths.length) return;
    setConfirmLoading(true);
    try {
      const newJob = await api.createJob({
        file_paths: previewState.filePaths,
        name: previewState.name,
        config: previewState.config,
      });

      await api.startJob(newJob.id);

      toast.showToast(`Translation job created and started: "${previewState.name}"`);
      setPreviewState({ show: false, name: '', filePaths: [], config: {} });
      navigate('/jobs', { state: { selectedJobId: newJob.id } });
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to create translation job', 'error');
    } finally {
      setConfirmLoading(false);
    }
  }

  function closePreview() {
    if (confirmLoading) return;
    setPreviewState({ show: false, name: '', filePaths: [], config: {} });
    setPreviewData(null);
    setPreviewError(null);
    setPreviewLoading(false);
  }

  async function handleTranslateMod(mod: ModModel) {
    const key = getModKey(mod);
    const selectedLang = selectedLanguageByMod[key] || getDefaultLangForMod(getLocalisationPaths(mod));
    const files = filterFilesByLanguage(getLocalisationPaths(mod), selectedLang);
    await openTranslatePreview(files, `Translate: ${mod.name}`);
  }

  function handleAddAllVisibleToJob(mod: ModModel, allFiles: string[], languages: string[]) {
    const hasMixed = languages.length > 1;
    if (hasMixed) {
      setAdvancedConfirmAction({ type: 'add_all_visible', mod, visibleFiles: allFiles, languages });
      return;
    }
    performAddAllVisible(allFiles, mod);
  }

  function performAddAllVisible(allFiles: string[], mod: ModModel) {
    draftAddFiles(allFiles, { modId: mod.id, modName: mod.name });
    toast(`${allFiles.length} file(s) added to job draft`, 'info');
  }

  async function handleTranslateAllVisible(mod: ModModel, allFiles: string[], languages: string[]) {
    const hasMixed = languages.length > 1;
    if (hasMixed) {
      setAdvancedConfirmAction({ type: 'translate_all_visible', mod, visibleFiles: allFiles, languages });
      return;
    }
    await performTranslateAllVisible(allFiles, mod);
  }

  async function performTranslateAllVisible(allFiles: string[], mod: ModModel) {
    await openTranslatePreview(allFiles, `Translate: ${mod.name}`);
  }

  function handleAdvancedConfirm() {
    if (!advancedConfirmAction) return;
    const { type, mod, visibleFiles } = advancedConfirmAction;
    setAdvancedConfirmAction(null);
    if (type === 'add_all_visible') {
      performAddAllVisible(visibleFiles, mod);
    } else {
      performTranslateAllVisible(visibleFiles, mod);
    }
  }

  function handleAddLocalisationToJob(mod: ModModel, filePath: string) {
    if (isFileAdded(filePath)) {
      draftRemoveFile(filePath);
    } else {
      draftAddFile(filePath, { modId: mod.id, modName: mod.name });
    }
  }

  function handleAddAllToJob(mod: ModModel) {
    const key = getModKey(mod);
    const selectedLang = selectedLanguageByMod[key] || getDefaultLangForMod(getLocalisationPaths(mod));
    const paths = filterFilesByLanguage(getLocalisationPaths(mod), selectedLang);
    if (paths.length === 0) return;
    const newPaths = paths.filter(p => !isFileAdded(p));
    if (newPaths.length === 0) {
      toast('All files already added to job draft', 'info');
      return;
    }
    draftAddFiles(newPaths, { modId: mod.id, modName: mod.name });
    toast(`${newPaths.length} file(s) added to job draft`, 'info');
  }

  function addFilesToJob(filePaths: string[], modName: string, modId: string, gameConfig?: Record<string, unknown>) {
    const newPaths = filePaths.filter(p => !isFileAdded(p));
    if (newPaths.length === 0) {
      toast('All files already added to job draft', 'info');
      return;
    }
    draftAddFiles(newPaths, { modId: modId, modName: modName });
    toast(`${newPaths.length} file(s) added to job draft`, 'info');
  }

  async function handleOpenLocalisationFolder(mod: ModModel) {
    const key = getModKey(mod);
    const selectedLang = selectedLanguageByMod[key] || getDefaultLangForMod(getLocalisationPaths(mod));
    const paths = filterFilesByLanguage(getLocalisationPaths(mod), selectedLang);
    if (paths.length === 0) return;
    const commonDir = getCommonParentDir(paths);
    if (commonDir) {
      await handleRevealPath(commonDir);
    } else {
      const firstDir = paths[0].substring(0, paths[0].lastIndexOf('/'));
      if (firstDir) {
        await handleRevealPath(firstDir);
      }
    }
  }

  function handleAddGroupToJob(mod: ModModel, group: LocalisationGroup) {
    const key = getModKey(mod);
    const selectedLang = selectedLanguageByMod[key] || getDefaultLangForMod(getLocalisationPaths(mod));
    addFilesToJob(group.files, `${mod.name} / ${group.label}`, mod.id, { src_lang: selectedLang });
  }

  function handleTranslateGroup(mod: ModModel, group: LocalisationGroup) {
    const jobName = `Translate: ${mod.name} / ${group.label}`;
    openTranslatePreview(group.files, jobName);
  }

  async function handleOpenGroupFolder(group: LocalisationGroup) {
    if (group.files.length === 0) return;
    const commonDir = getCommonParentDir(group.files);
    if (commonDir) {
      await handleRevealPath(commonDir);
    } else {
      const firstDir = group.files[0].substring(0, group.files[0].lastIndexOf('/'));
      if (firstDir) {
        await handleRevealPath(firstDir);
      }
    }
  }

  function handleUseInstallTargetDefault() {
    if (installTargetDefault) {
      setInstallTarget(installTargetDefault);
      setInstallTargetDirty(true);
    }
  }

  async function handlePreviewCache() {
    try {
      const res = await api.previewCleanCache();
      setCachePreview(res);
    } catch (err) {
      if (err instanceof ApiError) toast.showToast(err.message, 'error');
      else toast.showToast('Failed to preview cache clean', 'error');
    }
  }

  async function handleCleanCache() {
    setCacheCleaning(true);
    try {
      const res = await api.cleanCache({ cache_path: cachePreview?.items_to_delete[0]?.path || '', mode: 'selective' });
      setCacheResult({ success: res.success, message: `Deleted ${res.deleted_items.length} items` });
      setCachePreview(null);
      toast.showToast('Cache cleaned');
    } catch (err) {
      if (err instanceof ApiError) setCacheResult({ success: false, message: err.message });
      else setCacheResult({ success: false, message: 'Clean failed' });
    } finally {
      setCacheCleaning(false);
    }
  }

  /* ---- Render ---- */

  if (mods.length === 0) return null;

  return (
    <div>
      {/* Mods list */}
      <div className="card">
        <div className="card-title">Discovered Mods ({mods.length})</div>
        {mods.map((mod) => {
          const key = getModKey(mod);
          const isExpanded = !!expandedMods[key];
          const locFiles = getLocalisationPaths(mod);
          const modTags = mod.tags;

          return (
            <div key={key} className="mod-item">
              {/* Compact header — always visible */}
              <div
                className="mod-item-header"
                onClick={() => setExpandedMods(prev => ({ ...prev, [key]: !prev[key] }))}
              >
                <div className="mod-item-header-content">
                  <div className="mod-name">{mod.name}</div>
                  <div className="mod-path">{mod.path}</div>
                  <div className="mod-meta">
                    <span className={`badge ${mod.isValid ? 'badge-success' : 'badge-error'}`}>
                      {getModStatusLabel(mod)}
                    </span>
                    <span className="badge badge-info">{mod.source}</span>
                    <span className={`badge ${mod.installed ? 'badge-success' : 'badge-muted'}`}>
                      {mod.installed ? 'INSTALLED' : 'NOT INSTALLED'}
                    </span>
                    {locFiles.length > 0 && (
                      <span className="badge badge-success">Has localisation ({locFiles.length})</span>
                    )}
                    {hasInstallConflict(mod) && (
                      <span className="badge badge-error">Descriptor mismatch</span>
                    )}
                  </div>
                </div>
                <div className="mod-item-actions" onClick={e => e.stopPropagation()}>
                  <button className="btn btn-sm" onClick={() => handleReadDescriptor(getDescriptorPath(mod) || mod.path)}>
                    Read Descriptor
                  </button>
                  {mod.installed ? (
                    <button className="btn btn-sm btn-primary" onClick={() => handleInstall(mod.path, mod.installAction)} disabled={installing}>
                      {installing ? 'Installing...' : getInstallButtonLabel(mod)}
                    </button>
                  ) : (
                    <button className="btn btn-sm btn-primary" onClick={() => handleInstall(mod.path, 'install')} disabled={installing}>
                      {installing ? 'Installing...' : getInstallButtonLabel(mod)}
                    </button>
                  )}
                  {mod.installed && getInstalledPath(mod) && (
                    <button className="btn btn-sm" onClick={() => handleRevealPath(getInstalledPath(mod)!)}>
                      Open installed folder
                    </button>
                  )}
                  <button className="btn btn-sm" onClick={() => handleRevealPath(mod.path)}>
                    Open source folder
                  </button>
                  {canTranslateMod(mod) && (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handleTranslateMod(mod)}
                    >
                      Translate Mod
                    </button>
                  )}
                  <button
                    className={`expand-toggle${isExpanded ? ' open' : ''}`}
                    title={isExpanded ? 'Collapse' : 'Expand'}
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedMods(prev => ({ ...prev, [key]: !prev[key] }));
                    }}
                  >
                    &#9654;
                  </button>
                </div>
              </div>

              {/* Expanded detail body */}
              {isExpanded && (
                <div className="mod-item-body">
                  {hasInstallConflict(mod) && (
                    <div className="alert alert-warning" style={{ marginTop: '0.3rem', padding: '0.4rem 0.6rem', fontSize: '0.75rem' }}>
                      <strong>Install conflict:</strong> Descriptor path does not match installed folder.
                      <button
                        className="btn btn-sm"
                        style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                        onClick={() => {
                          toast.showToast(
                            `The descriptor.mod references a different path than where the mod is installed. ` +
                            `This can happen when the mod was moved or the descriptor was edited manually. ` +
                            `Reinstall the mod to fix this.`
                          );
                        }}
                      >
                        Show details
                      </button>
                    </div>
                  )}

                  <div className="mod-detail-section">
                    {getDescriptorPath(mod) && (
                      <div style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                        <span className="mod-detail-label">Descriptor path</span>
                        <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                          {getDescriptorPath(mod)}
                        </div>
                      </div>
                    )}
                    {getSupportedVersion(mod) && (
                      <div style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                        <span className="mod-detail-label">Supported version</span>
                        <span className="badge badge-muted">v{getSupportedVersion(mod)}</span>
                      </div>
                    )}
                    {modTags && modTags.length > 0 && (
                      <div style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                        <span className="mod-detail-label">Tags</span>
                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                          {modTags.join(', ')}
                        </div>
                      </div>
                    )}
                    {mod.installed && getInstalledPath(mod) && (
                      <div style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                        <span className="mod-detail-label">Installed at</span>
                        <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                          {getInstalledPath(mod)}
                        </div>
                      </div>
                    )}
                  </div>

                  {mod.diagnostics && (mod.diagnostics as Array<{ level: string; message: string }>).length > 0 && (
                    <div className="mod-detail-section">
                      <div className="mod-detail-label">Diagnostics</div>
                      <div style={{ fontSize: '0.75rem' }}>
                        {(mod.diagnostics as Array<{ level: string; message: string }>).map((d, i) => (
                          <div key={i} className={`badge ${d.level === 'error' || d.level === 'critical' ? 'badge-error' : 'badge-warning'}`} style={{ marginRight: '0.3rem', marginBottom: '0.2rem' }}>
                            {d.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {locFiles.length > 0 && (
                    <div className="mod-detail-section">
                      {(() => {
                        const languageGroups = groupFilesByLanguage(locFiles);
                        const availableLangs = Object.keys(languageGroups).filter(l => l !== 'unknown').sort();
                        const hasMultipleLanguages = availableLangs.length > 1;
                        const selectedLang = selectedLanguageByMod[key] || getDefaultLangForMod(locFiles);
                        const selectedLanguageFiles = hasMultipleLanguages
                          ? filterFilesByLanguage(locFiles, selectedLang)
                          : locFiles;

                        const isAdvanced = !showOnlySelected && hasMultipleLanguages;
                        const visibleFiles = isAdvanced ? locFiles : selectedLanguageFiles;

                        // Compute unique languages in visible files (for advanced mode badge)
                        const visibleLangs = (() => {
                          if (!isAdvanced) return [] as string[];
                          const langs = new Set<string>();
                          for (const p of visibleFiles) {
                            const raw = detectLocalisationLanguage(p);
                            const norm = normaliseLocalisationLanguage(raw);
                            if (norm) langs.add(norm);
                          }
                          return Array.from(langs).sort();
                        })();

                        return (
                          <>
                            {/* Toggle + Language selector */}
                            <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              {/* Advanced mode toggle */}
                              {hasMultipleLanguages && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', userSelect: 'none' }}>
                                  <input
                                    type="checkbox"
                                    checked={showOnlySelected}
                                    onChange={(e) => setShowOnlySelected(e.target.checked)}
                                  />
                                  <span style={{ fontWeight: 500 }}>Show only selected source language files</span>
                                </label>
                              )}

                              {/* Language selector (always visible when multiple langs, even in advanced mode) */}
                              {hasMultipleLanguages && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                  <label style={{ fontWeight: 600 }}>Source:</label>
                                  <select
                                    value={selectedLang}
                                    onChange={(e) =>
                                      setSelectedLanguageByMod(prev => ({
                                        ...prev,
                                        [key]: e.target.value,
                                      }))
                                    }
                                    style={{
                                      fontSize: '0.7rem',
                                      padding: '0.15rem 0.3rem',
                                      maxWidth: '200px',
                                    }}
                                  >
                                    {availableLangs.map(lang => (
                                      <option key={lang} value={lang}>
                                        {displayNameForLanguage(lang)} ({languageGroups[lang].length})
                                      </option>
                                    ))}
                                  </select>
                                </span>
                              )}
                            </div>

                            {/* Advanced mode info block */}
                            {isAdvanced && (
                              <div
                                className="alert alert-info"
                                style={{ marginBottom: '0.4rem', padding: '0.3rem 0.5rem', fontSize: '0.65rem' }}
                              >
                                Advanced mode enabled. Multiple localisation languages are visible.
                                <span style={{ marginLeft: '0.3rem', opacity: 0.7 }}>
                                  ({visibleLangs.map(l => displayNameForLanguage(l)).join(', ')})
                                </span>
                              </div>
                            )}

                            <div className="mod-localisation-header">
                              <span className="mod-detail-label" style={{ margin: 0 }}>
                                Localisation files
                                {isAdvanced
                                  ? ` (${visibleFiles.length})`
                                  : hasMultipleLanguages
                                    ? ` (${displayNameForLanguage(selectedLang)}, ${visibleFiles.length})`
                                    : ` (${visibleFiles.length})`}
                              </span>
                              <div className="mod-bulk-actions">
                                {(() => {
                                  const allSelectedAdded = selectedLanguageFiles.length > 0 && selectedLanguageFiles.every(f => isFileAdded(f));
                                  return (
                                    <button
                                      className={`btn btn-sm${allSelectedAdded ? ' btn-added' : ''}`}
                                      style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                      onClick={() => handleAddAllToJob(mod)}
                                      disabled={selectedLanguageFiles.length === 0}
                                    >
                                      {allSelectedAdded ? 'All added' : 'Add all to Translation Job'}
                                    </button>
                                  );
                                })()}
                                <button
                                  className="btn btn-sm"
                                  style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                  onClick={() => handleTranslateMod(mod)}
                                  disabled={selectedLanguageFiles.length === 0}
                                >
                                  Translate all localisation
                                </button>
                                {/* Advanced bulk actions: only when toggle OFF and multiple languages */}
                                {isAdvanced && (
                                  <>
                                    <button
                                      className="btn btn-sm"
                                      style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                      onClick={() => handleAddAllVisibleToJob(mod, visibleFiles, visibleLangs)}
                                      disabled={visibleFiles.length === 0}
                                    >
                                      Add all visible files
                                    </button>
                                    <button
                                      className="btn btn-sm"
                                      style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                      onClick={() => handleTranslateAllVisible(mod, visibleFiles, visibleLangs)}
                                      disabled={visibleFiles.length === 0}
                                    >
                                      Translate all visible files
                                    </button>
                                  </>
                                )}
                                <button
                                  className="btn btn-sm"
                                  style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                  onClick={() => handleOpenLocalisationFolder(mod)}
                                  disabled={selectedLanguageFiles.length === 0}
                                >
                                  Open localisation folder
                                </button>
                              </div>
                            </div>

                            {(() => {
                              const groups = groupLocalisationFiles(visibleFiles);
                              return (
                                <div className="loc-groups-container">
                                  {groups.map((group, gi) => {
                                    const groupKey = `${key}::${group.id}`;
                                    const isGroupExpanded = !!expandedGroups[groupKey];
                                    const visibleCount = visibleFilesByGroup[groupKey] || 10;
                                    const groupFilesToShow = group.files.slice(0, visibleCount);
                                    const hasMore = group.files.length > visibleCount;
                                    const hasMixedLanguages = group.languages.length > 1;

                                    return (
                                      <div key={gi} className="loc-group-item">
                                        <div
                                          className="loc-group-header"
                                          onClick={() =>
                                            setExpandedGroups(prev => ({
                                              ...prev,
                                              [groupKey]: !prev[groupKey],
                                            }))
                                          }
                                        >
                                          <span className={`loc-group-arrow${isGroupExpanded ? ' open' : ''}`}>
                                            &#9654;
                                          </span>
                                          <span className="loc-group-label">{group.label}</span>
                                          <span className="badge badge-muted" style={{ fontSize: '0.6rem' }}>
                                            {group.files.length} {group.files.length === 1 ? 'file' : 'files'}
                                          </span>
                                          {isAdvanced
                                            ? /* Advanced mode: normalised short-code badges */
                                              group.languages.map(raw => {
                                                const norm = normaliseLocalisationLanguage(raw);
                                                return norm ? (
                                                  <span key={raw} className="badge badge-info" style={{ fontSize: '0.6rem' }}>
                                                    {getLanguageBadge(norm)}
                                                  </span>
                                                ) : null;
                                              })
                                            : /* Safe mode: raw suffix badges (current behaviour) */
                                              group.languages.map(lang => (
                                                <span key={lang} className="badge badge-info" style={{ fontSize: '0.6rem' }}>
                                                  {lang.toUpperCase()}
                                                </span>
                                              ))}
                                          {isAdvanced && hasMixedLanguages && (
                                            <span className="badge badge-warning" style={{ fontSize: '0.6rem' }}>
                                              mixed languages
                                            </span>
                                          )}
                                        </div>

                                        <div className="loc-group-actions">
                                          {(() => {
                                            const allGroupAdded = group.files.every(f => isFileAdded(f));
                                            return (
                                              <button
                                                className={`btn btn-sm${allGroupAdded ? ' btn-added' : ''}`}
                                                style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                                onClick={() => handleAddGroupToJob(mod, group)}
                                              >
                                                {allGroupAdded ? 'All added' : 'Add group to Translation Job'}
                                              </button>
                                            );
                                          })()}
                                          <button
                                            className="btn btn-sm"
                                            style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                            onClick={() => handleTranslateGroup(mod, group)}
                                          >
                                            Translate group
                                          </button>
                                          <button
                                            className="btn btn-sm"
                                            style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                            onClick={() => handleOpenGroupFolder(group)}
                                          >
                                            Open group folder
                                          </button>
                                        </div>

                                        {isGroupExpanded && (
                                          <div className="loc-group-body">
                                            {groupFilesToShow.map((locPath, fi) => {
                                              const rawLang = detectLanguageFromPath(locPath) || '';
                                              const normLang = normaliseLocalisationLanguage(rawLang);
                                              return (
                                                <div
                                                  key={fi}
                                                  style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.4rem',
                                                    fontSize: '0.7rem',
                                                    padding: '0.15rem 0',
                                                    flexWrap: 'wrap',
                                                  }}
                                                >
                                                  <span
                                                    className="mono"
                                                    style={{
                                                      flex: 1,
                                                      minWidth: 0,
                                                      overflow: 'hidden',
                                                      textOverflow: 'ellipsis',
                                                      whiteSpace: 'nowrap',
                                                    }}
                                                  >
                                                    {locPath.split('/').pop()}
                                                  </span>
                                                  {isAdvanced && normLang ? (
                                                    <span className="badge badge-info" style={{ fontSize: '0.6rem' }}>
                                                      {getLanguageBadge(normLang)}
                                                    </span>
                                                  ) : !isAdvanced && rawLang ? (
                                                    <span className="badge badge-info" style={{ fontSize: '0.6rem' }}>
                                                      {rawLang}
                                                    </span>
                                                  ) : null}
                                                  {(() => {
                                                    const alreadyAdded = isFileAdded(locPath);
                                                    return (
                                                      <button
                                                        className={`btn btn-sm${alreadyAdded ? ' btn-added' : ''}`}
                                                        style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                                        onClick={() => handleAddLocalisationToJob(mod, locPath)}
                                                      >
                                                        {alreadyAdded ? 'Added' : 'Add to Translation Job'}
                                                      </button>
                                                    );
                                                  })()}
                                                  <button
                                                    className="btn btn-sm"
                                                    style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                                    onClick={() => handleRevealPath(locPath)}
                                                  >
                                                    Open folder
                                                  </button>
                                                </div>
                                              );
                                            })}
                                            {group.files.length > 10 && (
                                              <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.25rem' }}>
                                                {hasMore && (
                                                  <button
                                                    className="btn btn-sm"
                                                    style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                                    onClick={() =>
                                                      setVisibleFilesByGroup(prev => ({
                                                        ...prev,
                                                        [groupKey]: (prev[groupKey] || 10) + 20,
                                                      }))
                                                    }
                                                  >
                                                    Load 20 more
                                                  </button>
                                                )}
                                                {visibleCount > 10 && (
                                                  <button
                                                    className="btn btn-sm"
                                                    style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}
                                                    onClick={() =>
                                                      setVisibleFilesByGroup(prev => ({
                                                        ...prev,
                                                        [groupKey]: 10,
                                                      }))
                                                    }
                                                  >
                                                    Show less
                                                  </button>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Install target */}
      <div className="card">
        <div className="card-title">Install Target</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <PathPicker
            value={installTarget}
            onChange={(val: string) => {
              setInstallTarget(val);
              setInstallTargetDirty(true);
            }}
            mode="directory"
            label="Stellaris mods directory"
            placeholder="/path/to/Stellaris/mods"
          />
          {installTargetDefault && (
            <button className="btn btn-sm" onClick={handleUseInstallTargetDefault} type="button" style={{ alignSelf: 'flex-start' }}>
              Use Stellaris Mods Directory from Settings
            </button>
          )}
        </div>
        {installResult && (
          <div className={`alert ${installResult.success ? 'alert-success' : 'alert-error'}`} style={{ marginTop: '0.5rem' }}>
            {installResult.message}
          </div>
        )}
      </div>

      {/* Descriptor preview */}
      {descriptorText && (
        <div className="card">
          <div className="card-title">Descriptor Preview</div>
          <div className="pre-block">{descriptorText}</div>
        </div>
      )}

      {/* Stellaris cache */}
      <div className="card">
        <div className="card-title">Stellaris Cache</div>
        <div className="form-actions">
          <button className="btn" onClick={handlePreviewCache}>Preview Cache Clean</button>
          <button className="btn btn-danger" onClick={handleCleanCache} disabled={cacheCleaning}>
            {cacheCleaning ? 'Cleaning...' : 'Clean Cache'}
          </button>
        </div>
        {cachePreview && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
            <div>Items to delete: {cachePreview.items_to_delete.length}</div>
            <div>Total size: {(cachePreview.total_size_bytes / 1024 / 1024).toFixed(1)} MB</div>
            <div className="pre-block" style={{ maxHeight: 150, marginTop: '0.3rem' }}>
              {cachePreview.items_to_delete.map(item => item.path).join('\n')}
            </div>
          </div>
        )}
        {cacheResult && (
          <div className={`alert ${cacheResult.success ? 'alert-success' : 'alert-error'}`} style={{ marginTop: '0.5rem' }}>
            {cacheResult.message}
          </div>
        )}
      </div>

      {/* Advanced action confirmation modal */}
      {advancedConfirmAction && (
        <div className="modal-overlay" onPointerDown={advancedConfirmClose.handleOverlayPointerDown} onClick={advancedConfirmClose.handleOverlayClick}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Mixed localisation languages</h3>
            </div>
            <div className="modal-body" style={{ fontSize: '0.75rem' }}>
              <p>
                You are about to use localisation files from multiple source languages
                ({advancedConfirmAction.languages.map(l => displayNameForLanguage(l)).join(', ')}).
                This may produce mixed-language translation jobs.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setAdvancedConfirmAction(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleAdvancedConfirm}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Translation Preview Modal */}
      <TranslationPreviewModal
        previewState={previewState}
        previewData={previewData}
        previewLoading={previewLoading}
        previewError={previewError}
        confirmLoading={confirmLoading}
        onClose={closePreview}
        onConfirm={confirmTranslatePreview}
      />
      {/* Floating bar: Go to job when draft files exist */}
      {draftFiles.length > 0 && (
        <div className="floating-job-bar">
          <span className="floating-job-bar-label">
            {draftFiles.length} file(s) selected
          </span>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/jobs')}
          >
            Go to job ({draftFiles.length})
          </button>
        </div>
      )}
    </div>
  );
}
