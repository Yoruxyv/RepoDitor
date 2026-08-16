import { useCallback, useEffect, useRef, useState } from "react";

import type { PlayerDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/translations";
import type { PlayerHealthEdit } from "@/features/editor/pendingEdits";

interface PlayersState {
  players: PlayerDto[];
  error: TranslationKey | null;
  loading: boolean;
}

interface AvatarAttempt {
  readonly requests: number;
  readonly failedAt: number | null;
}

const INITIAL_STATE: PlayersState = {
  players: [],
  error: null,
  loading: true,
};
const AVATAR_RETRY_COOLDOWN_MS = 30_000;
const MAX_AVATAR_REQUESTS = 2;

export function usePlayers(saveId: string) {
  const { t } = usePreferences();
  const [state, setState] = useState<PlayersState>(INITIAL_STATE);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [pendingByPlayer, setPendingByPlayer] = useState<Record<string, PlayerHealthEdit>>({});
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});
  const mounted = useRef(false);
  const playerRequestInFlight = useRef(false);
  const avatarRequests = useRef(new Set<string>());
  const avatarAttempts = useRef(new Map<string, AvatarAttempt>());

  const markAvatarFailure = useCallback((playerId: string) => {
    const attempt = avatarAttempts.current.get(playerId);
    avatarAttempts.current.set(playerId, {
      requests: Math.max(attempt?.requests ?? 0, 1),
      failedAt: Date.now(),
    });
    if (mounted.current) {
      setAvatarUrls((current) => ({ ...current, [playerId]: null }));
    }
  }, []);

  const loadAvatar = useCallback(
    async (playerId: string) => {
      const previous = avatarAttempts.current.get(playerId);
      if (
        avatarRequests.current.has(playerId) ||
        (previous?.requests ?? 0) >= MAX_AVATAR_REQUESTS ||
        previous?.failedAt === null ||
        (previous?.failedAt !== undefined &&
          Date.now() - previous.failedAt < AVATAR_RETRY_COOLDOWN_MS)
      ) {
        return;
      }
      avatarRequests.current.add(playerId);
      avatarAttempts.current.set(playerId, {
        requests: (previous?.requests ?? 0) + 1,
        failedAt: null,
      });
      if (mounted.current && previous?.failedAt !== undefined) {
        setAvatarUrls((current) => {
          const next = { ...current };
          delete next[playerId];
          return next;
        });
      }
      try {
        const result = await window.repoditor.players.avatar(saveId, playerId);
        if (!result.ok || result.data.avatarUrl === null) {
          markAvatarFailure(playerId);
        } else if (mounted.current) {
          setAvatarUrls((current) => ({ ...current, [playerId]: result.data.avatarUrl }));
        }
      } catch {
        markAvatarFailure(playerId);
      } finally {
        avatarRequests.current.delete(playerId);
      }
    },
    [markAvatarFailure, saveId],
  );

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
          setState({ players: [], error: operationErrorKey(result.error.code), loading: false });
        }
      }
    } catch {
      if (mounted.current) {
        setState({ players: [], error: "error.service", loading: false });
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

  useEffect(() => {
    if (selectedPlayerId && avatarUrls[selectedPlayerId] === undefined) {
      void loadAvatar(selectedPlayerId);
    }
  }, [avatarUrls, loadAvatar, selectedPlayerId]);

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
          label: "Health",
          subject: player.name,
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
    markAvatarFailure(playerId);
  }

  function selectPlayer(playerId: string): void {
    setSelectedPlayerId(playerId);
    if (avatarUrls[playerId] === null) {
      void loadAvatar(playerId);
    }
  }

  function reload(): void {
    setState((current) => ({ ...current, error: null, loading: true }));
    void loadPlayers();
  }

  function revertAll(): void {
    setPendingByPlayer({});
  }

  return {
    ...state,
    error: state.error ? t(state.error) : null,
    selectedPlayerId,
    setSelectedPlayerId: selectPlayer,
    pendingByPlayer,
    pendingEdits: Object.values(pendingByPlayer),
    avatarUrls,
    loadAvatar,
    rejectAvatar,
    updateHealth,
    revertHealth,
    revertAll,
    reload,
  };
}
