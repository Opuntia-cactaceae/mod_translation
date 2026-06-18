import { Fragment, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../App';
import { GamePageLayout } from '../components/game/GamePageLayout';
import { GAME_SECTIONS, type GameSectionContext } from '../components/game/sectionRegistry';
import type { GameModel, FileHandlerModel, ModModel } from '../domain';
import { mapGameOption, mapFileHandlerOption, hasFeature, mapModInfo } from '../domain';
import { usePersistentState } from '../hooks/usePersistentState';
import { STORAGE_KEYS } from '../utils/storageKeys';

/* ------------------------------------------------------------------ */
/*  Fallback (used when API is unreachable)                            */
/* ------------------------------------------------------------------ */
const FALLBACK_HANDLER_OPTIONS: FileHandlerModel[] = [
  { id: 'plain_text', label: 'Plain text', extensions: ['.txt'] },
  { id: 'json', label: 'JSON', extensions: ['.json'] },
  { id: 'yaml', label: 'YAML', extensions: ['.yml', '.yaml'] },
];

/* ------------------------------------------------------------------ */
/*  GamePage — unified page, routed at /games/:gameId                  */
/*  Renders sections based on game capabilities.                       */
/* ------------------------------------------------------------------ */
export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();

  const [loading, setLoading] = useState(true);
  const [game, setGame] = useState<GameModel | null>(null);
  const [handlerOptions, setHandlerOptions] = useState<FileHandlerModel[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Shared mods state (bridges ModDiscoverySection ↔ ModListSection)
  const [mods, setMods] = useState<ModModel[]>([]);
  const [lastScanPaths, setLastScanPaths] = useState<string[]>([]);
  const [modsLoading, setModsLoading] = useState(false);

  // Lifted discovery scan state — persisted to localStorage so it
  // survives GamePage unmount/remount (e.g. navigating away and back).
  const [discoveredFiles, setDiscoveredFiles] = usePersistentState<string[]>(
    `${STORAGE_KEYS.discoveryScannedFiles}.${gameId}`,
    [],
  );
  const [discoveryScanning, setDiscoveryScanning] = useState(false);
  const [discoveryScanError, setDiscoveryScanError] = usePersistentState<string | null>(
    `${STORAGE_KEYS.discoveryScanError}.${gameId}`,
    null,
  );

  // Load previously discovered mods from backend cache on mount
  useEffect(() => {
    if (!gameId) return;
    (async () => {
      setModsLoading(true);
      try {
        const res = await api.getDiscoveredMods();
        if (res.mods && res.mods.length > 0) {
          setMods(res.mods.map(mapModInfo));
          if (res.scanned_paths && res.scanned_paths.length > 0) {
            setLastScanPaths(res.scanned_paths);
          }
        }
      } catch {
        // Silent — user can discover manually
      } finally {
        setModsLoading(false);
      }
    })();
  }, [gameId]);

  useEffect(() => {
    (async () => {
      try {
        const dto = await api.getGameOptions();
        const found = dto.games.find(g => g.id === gameId);
        if (!found) {
          setError(`Game "${gameId}" not found`);
          setLoading(false);
          return;
        }
        setGame(mapGameOption(found));
        const handlers = dto.file_handlers
          .filter(h => found.file_handlers.includes(h.id))
          .map(mapFileHandlerOption);
        setHandlerOptions(handlers);
      } catch {
        // API unavailable — allow fallback only for the 'generic' game
        if (gameId === 'generic') {
          setGame({
            id: 'generic',
            label: 'Other Game',
            vendor: null,
            features: {
              mod_discovery: false,
              descriptors: false,
              install: false,
              translation_preview: true,
              file_grouping: false,
              output_management: true,
              cache_cleaning: false,
              generic_file_scan: true,
            },
            supportsModDiscovery: false,
            supportsDescriptors: false,
            supportsInstall: false,
            fileHandlers: ['plain_text', 'json', 'yaml'],
          });
          setHandlerOptions(FALLBACK_HANDLER_OPTIONS);
        } else {
          setError(`Failed to load game options`);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [gameId]);

  /** Re-discover mods using the last scan paths (called after install). */
  const refreshMods = useCallback(async () => {
    try {
      // If we have scan paths, re-discover from the filesystem
      if (lastScanPaths.length > 0) {
        const res = await api.discoverMods({ paths: lastScanPaths });
        setMods(res.mods.map(mapModInfo));
        return;
      }
      // Fallback: reload from backend cache
      const res = await api.getDiscoveredMods();
      if (res.mods && res.mods.length > 0) {
        setMods(res.mods.map(mapModInfo));
      }
    } catch {
      // silent — user can re-discover manually
    }
  }, [lastScanPaths]);

  if (loading) {
    return <div className="loading"><span className="spinner" /> Loading...</div>;
  }

  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }

  if (!game) {
    return <div className="alert alert-error">Game not found</div>;
  }

  const matchingSections = GAME_SECTIONS.filter(s => hasFeature(game, s.feature));

  if (matchingSections.length === 0) {
    return (
      <GamePageLayout title={game.label}>
        <div className="alert alert-info">No UI sections available for this game.</div>
      </GamePageLayout>
    );
  }

  const ctx: GameSectionContext = {
    game,
    handlerOptions,
    mods,
    setMods,
    lastScanPaths,
    setLastScanPaths,
    refreshMods,
    discoveredFiles,
    setDiscoveredFiles,
    discoveryScanning,
    setDiscoveryScanning,
    discoveryScanError,
    setDiscoveryScanError,
  };

  return (
    <GamePageLayout title={game.label}>
      {matchingSections.map(section => (
        <Fragment key={section.id}>
          {section.render(ctx)}
        </Fragment>
      ))}
    </GamePageLayout>
  );
}
