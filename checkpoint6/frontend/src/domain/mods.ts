import type { ModInfoSchema } from "../api/types";
import { filterFilesByLanguage } from "../utils/localisationLanguage";

/* ------------------------------------------------------------------ */
/*  Domain models                                                      */
/* ------------------------------------------------------------------ */

export interface ModModel {
  id: string;
  name: string;
  path: string;
  descriptorPath?: string | null;
  isValid: boolean;
  source: string;
  localisationPaths: string[];
  installed: boolean;
  installedPath?: string | null;
  installAction: "install" | "reinstall";
  installConflict: boolean;
  selfInstalled: boolean;
  diagnostics: unknown[];
  tags?: string[];
  supportedVersion?: string | null;
  version?: string | null;
}

/* ------------------------------------------------------------------ */
/*  DTO → Domain mapper                                                */
/* ------------------------------------------------------------------ */

export function mapModInfo(dto: ModInfoSchema): ModModel {
  return {
    id: dto.mod_id,
    name: dto.name,
    path: dto.path,
    descriptorPath: dto.descriptor_path ?? null,
    isValid: dto.is_valid,
    source: dto.source,
    localisationPaths: [...dto.localisation_paths],
    installed: dto.installed,
    installedPath: dto.installed_path ?? null,
    installAction: dto.install_action as "install" | "reinstall",
    installConflict: dto.install_conflict,
    selfInstalled: dto.self_installed ?? false,
    diagnostics: [...dto.diagnostics],
    tags: dto.tags?.length ? [...dto.tags] : undefined,
    supportedVersion: dto.supported_version || null,
    version: dto.version || null,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers (accept both ModModel and ModInfoSchema for compat)        */
/* ------------------------------------------------------------------ */

type ModLike = {
  id?: string;
  mod_id?: string;
  path: string;
  localisation_paths?: string[];
  localisationPaths?: string[];
  installed: boolean;
  name: string;
};

export function getLocalisationPaths(mod: ModLike): string[] {
  return mod.localisationPaths ?? mod.localisation_paths ?? [];
}

export function getModKey(mod: ModLike): string {
  return mod.id || mod.mod_id || mod.path;
}

/**
 * Stable unique key that is collision-free even when mod_id collides.
 * Uses the absolute filesystem path which is inherently unique.
 */
export function getModStableKey(mod: ModLike): string {
  return mod.path;
}

export function hasLocalisation(mod: ModLike): boolean {
  return getLocalisationPaths(mod).length > 0;
}

export function getLocalisationCount(mod: ModLike): number {
  return getLocalisationPaths(mod).length;
}

export function canTranslateMod(mod: ModLike): boolean {
  return hasLocalisation(mod);
}

/** Count localisation files of a mod that match the given language code. */
export function getLocalisationCountForLanguage(
  mod: ModLike,
  language: string,
): number {
  const paths = getLocalisationPaths(mod);
  return filterFilesByLanguage(paths, language).length;
}

export function getInstallButtonLabel(mod: ModModel): string {
  if (mod.selfInstalled) return "Reinstall";
  return mod.installed ? "Reinstall" : "Install Mod";
}

/* ------------------------------------------------------------------ */
/*  New helpers (typed on ModModel)                                    */
/* ------------------------------------------------------------------ */

export function isInstalled(mod: ModModel): boolean {
  return mod.installed;
}

export function hasInstallConflict(mod: ModModel): boolean {
  return mod.installConflict;
}

export function isSelfInstalled(mod: ModModel): boolean {
  return mod.selfInstalled;
}

export function getDescriptorPath(mod: ModModel): string | null {
  return mod.descriptorPath ?? null;
}

export function getInstalledPath(mod: ModModel): string | null {
  return mod.installedPath ?? null;
}

export function getModStatusLabel(mod: ModModel): string {
  return mod.isValid ? "Valid" : "Invalid";
}

export function getModSourceLabel(mod: ModModel): string {
  return mod.source;
}

export function getSupportedVersion(mod: ModModel): string | null {
  return mod.supportedVersion ?? null;
}

/* ------------------------------------------------------------------ */
/*  Game-neutral aliases (for gradual adoption away from "mod" naming)  */
/* ------------------------------------------------------------------ */

/** Alias for ModModel — use when referring to any translatable content source. */
export type ContentSourceModel = ModModel;

export function getContentSourceKey(source: ContentSourceModel): string {
  return getModStableKey(source);
}

export function canTranslateContentSource(source: ContentSourceModel): boolean {
  return canTranslateMod(source);
}
