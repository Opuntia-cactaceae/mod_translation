import { useEffect, useState } from 'react';
import { api, ApiError } from '../../App';
import { mapSettingsResponse } from '../../domain/settings';
import { PathPicker } from '..';
import type { ModInfoSchema } from '../../api/types';

interface ModDiscoverySectionProps {
  onModsDiscovered: (mods: ModInfoSchema[], inputPaths: string[]) => void;
  hasMods?: boolean;
}

export function ModDiscoverySection({ onModsDiscovered, hasMods }: ModDiscoverySectionProps) {
  const [scanPaths, setScanPaths] = useState('');
  const [scanPathsDirty, setScanPathsDirty] = useState(false);
  const [defaultModsDir, setDefaultModsDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannedPaths, setScannedPaths] = useState<string[]>([]);
  const [scanPathToAdd, setScanPathToAdd] = useState('');

  // Load default mods directory from settings
  useEffect(() => {
    api.getSettings()
      .then(res => {
        const model = mapSettingsResponse(res.settings);
        const stellarisGs = model.game_settings?.stellaris;
        // Prefer game_settings.stellaris.downloaded_mods_dir, fallback to paths.downloaded_mods_dir
        const downloadedModsDir = stellarisGs?.downloaded_mods_dir || model.paths?.downloaded_mods_dir;
        if (downloadedModsDir && typeof downloadedModsDir === 'string' && downloadedModsDir.trim()) {
          const dir = downloadedModsDir.trim();
          setDefaultModsDir(dir);
          if (!scanPaths.trim() && !scanPathsDirty) {
            setScanPaths(dir);
          }
        }
      })
      .catch(() => {
        // Silently fail – settings fetch is not critical
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDiscover() {
    const paths = scanPaths.split('\n').map(s => s.trim()).filter(Boolean);
    if (paths.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.discoverMods({ paths });
      setScannedPaths(res.scanned_paths);
      onModsDiscovered(res.mods, paths);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Discovery failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="card-title">Discover Mods</div>
        <div className="form-group">
          <label>Add scan path</label>
          <div className="form-row" style={{ gap: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <PathPicker
                value={scanPathToAdd}
                onChange={setScanPathToAdd}
                mode="directory"
                placeholder="Pick a directory to scan"
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (scanPathToAdd.trim()) {
                  setScanPathsDirty(true);
                  setScanPaths(prev => prev + (prev ? '\n' : '') + scanPathToAdd.trim());
                  setScanPathToAdd('');
                }
              }}
              type="button"
              style={{ alignSelf: 'flex-end', marginBottom: '0.85rem' }}
            >
              Add Scan Path
            </button>
          </div>
        </div>
        <div className="form-group">
          <label>Search paths (one per line)</label>
          <textarea
            className="form-control"
            rows={3}
            placeholder={"/path/to/steam/workshop\n/path/to/mods"}
            value={scanPaths}
            onChange={e => {
              setScanPathsDirty(true);
              setScanPaths(e.target.value);
            }}
          />
        </div>
        <div className="mod-discovery-actions">
          {defaultModsDir && (
            <button
              className="btn btn-secondary"
              onClick={() => {
                setScanPaths(defaultModsDir);
                setScanPathsDirty(true);
              }}
              type="button"
            >
              Use default mods folder
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={handleDiscover}
            disabled={loading}
          >
            {loading ? 'Scanning...' : (hasMods ? 'Refresh / Rediscover' : 'Scan / Discover')}
          </button>
        </div>
        {defaultModsDir && (
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
            Default path is taken from Settings {'->'} Downloaded mods directory.
          </div>
        )}
        {scannedPaths.length > 0 && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Scanned: {scannedPaths.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}
