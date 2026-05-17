import type { GameOption, FileHandlerOption } from "../api/types";

/* ------------------------------------------------------------------ */
/*  Feature model                                                      */
/* ------------------------------------------------------------------ */

export type GameFeature =
  | 'mod_discovery'
  | 'descriptors'
  | 'install'
  | 'translation_preview'
  | 'file_grouping'
  | 'output_management'
  | 'cache_cleaning'
  | 'generic_file_scan';

export type GameFeatures = Record<GameFeature, boolean>;

/* ------------------------------------------------------------------ */
/*  Domain models                                                      */
/* ------------------------------------------------------------------ */

export type GameId = string;
export type FileHandlerId = string;

export interface GameModel {
  id: GameId;
  label: string;
  vendor?: string | null;
  features: Partial<Record<GameFeature, boolean>>;
  supportsModDiscovery: boolean;
  supportsDescriptors: boolean;
  supportsInstall: boolean;
  fileHandlers: FileHandlerId[];
}

export interface FileHandlerModel {
  id: FileHandlerId;
  label: string;
  extensions: string[];
  description?: string;
}

/* ------------------------------------------------------------------ */
/*  DTO → Domain mappers                                               */
/* ------------------------------------------------------------------ */

export function mapGameOption(dto: GameOption): GameModel {
  const features: Partial<Record<GameFeature, boolean>> = dto.features ?? {
    mod_discovery: dto.supports_mod_discovery,
    descriptors: dto.supports_descriptors,
    install: dto.supports_install,
  };
  return {
    id: dto.id,
    label: dto.label,
    vendor: dto.vendor,
    features,
    supportsModDiscovery: hasFeatureFromRecord(features, 'mod_discovery', dto.supports_mod_discovery),
    supportsDescriptors: hasFeatureFromRecord(features, 'descriptors', dto.supports_descriptors),
    supportsInstall: hasFeatureFromRecord(features, 'install', dto.supports_install),
    fileHandlers: [...dto.file_handlers],
  };
}

function hasFeatureFromRecord(
  features: Partial<Record<GameFeature, boolean>>,
  feature: GameFeature,
  fallback: boolean,
): boolean {
  const val = features[feature];
  return val !== undefined ? val : fallback;
}

export function mapFileHandlerOption(dto: FileHandlerOption): FileHandlerModel {
  return {
    id: dto.id,
    label: dto.label,
    extensions: [...dto.extensions],
    description: dto.description || undefined,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function hasFeature(game: GameModel, feature: GameFeature): boolean {
  const val = game.features[feature];
  return val !== undefined ? val : false;
}

export function supportsModDiscovery(game: GameModel): boolean {
  return hasFeature(game, 'mod_discovery');
}

export function supportsInstall(game: GameModel): boolean {
  return hasFeature(game, 'install');
}

export function supportsDescriptors(game: GameModel): boolean {
  return hasFeature(game, 'descriptors');
}

export function getHandlersForGame(
  game: GameModel,
  handlers: FileHandlerModel[],
): FileHandlerModel[] {
  return handlers.filter(h => game.fileHandlers.includes(h.id));
}

export function isGenericGame(game: GameModel): boolean {
  return game.id === "generic";
}

export function isStellarisGame(game: GameModel): boolean {
  return game.id === "stellaris";
}
