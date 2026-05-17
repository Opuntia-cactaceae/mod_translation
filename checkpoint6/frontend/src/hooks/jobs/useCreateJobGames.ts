import { useState, useEffect } from 'react';
import { api } from '../../App';
import type { GameOption } from '../../api/types';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface UseCreateJobGamesReturn {
  /** All games from the backend, mapped from GameOption */
  games: GameOption[];
  /** Games that support mod_discovery feature */
  gamesWithMods: GameOption[];
  gamesLoading: boolean;
  selectedGameId: string;
  setSelectedGameId: (id: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Load game options on mount and manage selected game state.
 *
 * Exposes both the full game list and a filtered subset of games
 * that support mod discovery, so the form can show the correct set of
 * games for the mod selector.
 */
export function useCreateJobGames(): UseCreateJobGamesReturn {
  const [games, setGames] = useState<GameOption[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string>('');

  useEffect(() => {
    setGamesLoading(true);
    api.getGameOptions()
      .then(res => {
        setGames(res.games);
        // Auto-select first game with mod_discovery support
        const modGames = res.games.filter(g => g.supports_mod_discovery);
        if (modGames.length === 1 && !selectedGameId) {
          setSelectedGameId(modGames[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setGamesLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const gamesWithMods = games.filter(g => g.supports_mod_discovery);

  return {
    games,
    gamesWithMods,
    gamesLoading,
    selectedGameId,
    setSelectedGameId,
  };
}
