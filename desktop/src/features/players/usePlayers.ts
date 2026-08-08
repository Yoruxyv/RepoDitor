import { useCallback, useEffect, useRef, useState } from "react";

import type { PlayerDto } from "@electron/contracts";

export interface PlayerHealthEdit {
  feature: "players";
  entity: string;
  field: "health";
  before: number;
  after: number;
}

interface PlayersState {
  players: PlayerDto[];
  error: string | null;
  loading: boolean;
}

const INITIAL_STATE: PlayersState = {
  players: [],
  error: null,
  loading: true,
};

export function usePlayers(saveId: string) {
  const [state, setState] = useState<PlayersState>(INITIAL_STATE);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [pendingByPlayer, setPendingByPlayer] = useState<Record<string, PlayerHealthEdit>>({});
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});
  const mounted = useRef(false);
  const playerRequestInFlight = useRef(false);
  const avatarRequests = useRef(new Set<string>());

  const loadPlayers = useCallback(async () => {
    if (playerRequestInFlight.current) {
      return;
    }
    playerRequestInFlight.current = true;
    try {
      const result = await window.repoditor.players.list(saveId);
      if (mounted.current) {
        if (result.ok) {
          setState({ players: result.data, error: null, loading: false });
          setSelectedPlayerId((current) => current ?? result.data[0]?.id ?? null);
        } else {
          setState({ players: [], error: result.error.message, loading: false });
        }
      }
    } catch {
      if (mounted.current) {
        setState({ players: [], error: "The desktop player bridge is unavailable.", loading: false });
      }
    } finally {
      playerRequestInFlight.current = false;
    }
  }, [saveId]);

  useEffect(() => {
    mounted.current = true;
    const request = window.setTimeout(() => void loadPlayers());
    return () => {
      mounted.current = false;
      window.clearTimeout(request);
    };
  }, [loadPlayers]);

  const loadAvatar = useCallback(
    async (playerId: string) => {
      if (avatarRequests.current.has(playerId)) {
        return;
      }
      avatarRequests.current.add(playerId);
      try {
        const result = await window.repoditor.players.avatar(saveId, playerId);
        if (mounted.current) {
          setAvatarUrls((current) => ({
            ...current,
            [playerId]: result.ok ? result.data.avatarUrl : null,
          }));
        }
      } catch {
        if (mounted.current) {
          setAvatarUrls((current) => ({ ...current, [playerId]: null }));
        }
      }
    },
    [saveId],
  );

  function updateHealth(player: PlayerDto, health: number): void {
    setPendingByPlayer((current) => {
      if (health === player.health) {
        const next = { ...current };
        delete next[player.id];
        return next;
      }
      return {
        ...current,
        [player.id]: {
          feature: "players",
          entity: player.id,
          field: "health",
          before: player.health,
          after: health,
        },
      };
    });
  }

  function revertHealth(playerId: string): void {
    setPendingByPlayer((current) => {
      const next = { ...current };
      delete next[playerId];
      return next;
    });
  }

  function rejectAvatar(playerId: string): void {
    setAvatarUrls((current) => ({ ...current, [playerId]: null }));
  }

  function reload(): void {
    setState((current) => ({ ...current, error: null, loading: true }));
    void loadPlayers();
  }

  return {
    ...state,
    selectedPlayerId,
    setSelectedPlayerId,
    pendingByPlayer,
    pendingEdits: Object.values(pendingByPlayer),
    avatarUrls,
    loadAvatar,
    rejectAvatar,
    updateHealth,
    revertHealth,
    reload,
  };
}
