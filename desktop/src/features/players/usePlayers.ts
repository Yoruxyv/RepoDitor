/**
 * Owns player projection loading plus bounded optional avatar retries.
 *
 * Health edits remain parent-owned pending changes. Avatar failures are cached only
 * for the session and never block or mutate save-derived player state.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  DesktopOperationResult,
  PlayerDto,
  SaveCanonicalPlayerValue,
} from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/translations";
import type { PlayerHealthEdit } from "@/features/pending-changes/pendingEdits";

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

function initialState(result: DesktopOperationResult<PlayerDto[]> | null): PlayersState {
  if (result === null) return INITIAL_STATE;
  return result.ok
    ? { players: result.data, error: null, loading: false }
    : { players: [], error: operationErrorKey(result.error.code), loading: false };
}
const AVATAR_RETRY_COOLDOWN_MS = 30_000;
const MAX_AVATAR_REQUESTS = 2;

export function usePlayers(
  saveId: string,
  initialResult: DesktopOperationResult<PlayerDto[]> | null = null,
  initialAvatarUrls: Readonly<Record<string, string | null>> = {},
) {
  const { t } = usePreferences();
  const [state, setState] = useState<PlayersState>(() => initialState(initialResult));
  const initialResultRef = useRef(initialResult);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(() =>
    initialResult?.ok ? (initialResult.data[0]?.id ?? null) : null,
  );
  const [pendingByPlayer, setPendingByPlayer] = useState<Record<string, PlayerHealthEdit>>({});
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>(() => ({
    ...initialAvatarUrls,
  }));
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

  const loadPlayers = useCallback(
    async (preserveExisting = false): Promise<boolean> => {
      if (playerRequestInFlight.current) {
        return false;
      }
      playerRequestInFlight.current = true;
      try {
        const result = await window.repoditor.players.list(saveId);
        if (!mounted.current) return result.ok;
        if (result.ok) {
          setState({ players: result.data, error: null, loading: false });
          setSelectedPlayerId((current) =>
            current && result.data.some((player) => player.id === current)
              ? current
              : (result.data[0]?.id ?? null),
          );
          return true;
        }
        setState((current) => ({
          players: preserveExisting ? current.players : [],
          error: operationErrorKey(result.error.code),
          loading: false,
        }));
        return false;
      } catch {
        if (mounted.current) {
          setState((current) => ({
            players: preserveExisting ? current.players : [],
            error: "error.service",
            loading: false,
          }));
        }
        return false;
      } finally {
        playerRequestInFlight.current = false;
      }
    },
    [saveId],
  );

  useEffect(() => {
    mounted.current = true;
    const request =
      initialResultRef.current === null
        ? window.setTimeout(() => void loadPlayers(false))
        : undefined;
    return () => {
      mounted.current = false;
      if (request !== undefined) window.clearTimeout(request);
    };
  }, [loadPlayers]);

  useEffect(() => {
    for (const player of state.players) {
      if (avatarUrls[player.id] === undefined) {
        void loadAvatar(player.id);
      }
    }
  }, [avatarUrls, loadAvatar, state.players]);

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
    void loadPlayers(false);
  }

  function applyAfterSave(values: readonly SaveCanonicalPlayerValue[]): boolean {
    const current = state.players;
    const byId = new Map(values.map((value) => [value.id, value.health]));
    if (
      byId.size !== values.length ||
      values.some((value) => !current.some((player) => player.id === value.id))
    ) {
      return false;
    }
    const nextPlayers = current.map((player) =>
      byId.has(player.id) ? { ...player, health: byId.get(player.id)! } : player,
    );
    setState({ players: nextPlayers, error: null, loading: false });
    return true;
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
    applyAfterSave,
    reload,
    refreshAfterSave: () => loadPlayers(true),
  };
}
