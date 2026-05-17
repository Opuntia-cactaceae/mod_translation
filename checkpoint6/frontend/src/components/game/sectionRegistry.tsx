import { api } from '../../App';
import { GenericFileSection } from './GenericFileSection';
import { ModDiscoverySection } from './ModDiscoverySection';
import { ModListSection } from './ModListSection';
import type { GameFeature, GameModel, FileHandlerModel, ModModel } from '../../domain';
import { mapModInfo } from '../../domain';
import type React from 'react';

/* ------------------------------------------------------------------ */
/*  Section context — passed to every section's render function       */
/* ------------------------------------------------------------------ */

export interface GameSectionContext {
  game: GameModel;
  handlerOptions: FileHandlerModel[];
  mods: ModModel[];
  setMods: React.Dispatch<React.SetStateAction<ModModel[]>>;
  lastScanPaths: string[];
  setLastScanPaths: React.Dispatch<React.SetStateAction<string[]>>;
  refreshMods: () => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Section definition                                                 */
/* ------------------------------------------------------------------ */

export interface GameSectionDefinition {
  id: string;
  feature: GameFeature;
  render: (ctx: GameSectionContext) => React.ReactNode;
}

/* ------------------------------------------------------------------ */
/*  Registry — declaratively maps game features to UI sections        */
/* ------------------------------------------------------------------ */

export const GAME_SECTIONS: GameSectionDefinition[] = [
  {
    id: 'mod_discovery',
    feature: 'mod_discovery',
    render: (ctx) => (
      <ModDiscoverySection
        hasMods={ctx.mods.length > 0}
        onModsDiscovered={(mods, paths) => {
          ctx.setMods(mods.map(mapModInfo));
          ctx.setLastScanPaths(paths);
        }}
      />
    ),
  },
  {
    id: 'mod_list',
    feature: 'mod_discovery',
    render: (ctx) => (
      <ModListSection
        mods={ctx.mods}
        onRefreshMods={ctx.refreshMods}
      />
    ),
  },
  {
    id: 'generic_file_scan',
    feature: 'generic_file_scan',
    render: (ctx) => (
      <GenericFileSection
        game={ctx.game}
        handlerOptions={ctx.handlerOptions}
      />
    ),
  },
];
