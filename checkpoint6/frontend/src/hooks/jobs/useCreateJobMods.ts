import { useState, useEffect } from 'react';
import { api } from '../../App';
import type { ModInfoSchema } from '../../api/types';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface UseCreateJobModsReturn {
  mods: ModInfoSchema[];
  modsLoading: boolean;
  selectedMod: ModInfoSchema | null;
  setSelectedMod: (mod: ModInfoSchema | null) => void;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Load discovered mods on mount and manage mod selection state.
 *
 * Does NOT handle form-field population when a mod is selected —
 * that is a cross-cutting concern handled by the composition hook.
 */
export function useCreateJobMods(): UseCreateJobModsReturn {
  const [mods, setMods] = useState<ModInfoSchema[]>([]);
  const [selectedMod, setSelectedMod] = useState<ModInfoSchema | null>(null);
  const [modsLoading, setModsLoading] = useState(false);

  useEffect(() => {
    setModsLoading(true);
    api.getDiscoveredMods()
      .then(res => setMods(res.mods))
      .catch(() => {})
      .finally(() => setModsLoading(false));
  }, []);

  return {
    mods,
    modsLoading,
    selectedMod,
    setSelectedMod,
  };
}
