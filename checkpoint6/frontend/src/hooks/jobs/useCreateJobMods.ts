import { useState, useEffect } from 'react';
import { api } from '../../App';
import type { ModInfoSchema } from '../../api/types';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface UseCreateJobModsReturn {
  mods: ModInfoSchema[];
  modsLoading: boolean;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Load discovered mods on mount.
 */
export function useCreateJobMods(): UseCreateJobModsReturn {
  const [mods, setMods] = useState<ModInfoSchema[]>([]);
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
  };
}
