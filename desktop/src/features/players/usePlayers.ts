/**
 * Owns mutable player projection loading and pending health edits.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  DesktopOperationResult,
  PlayerDto,
  RepoDitorApi,
  SaveCanonicalPlayerValue,
} from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/i18n";
import type { PlayerHealthEdit } from "@/features/pending-changes/pendingEdits";

interface PlayersState {
  players: PlayerDto[];
  error: TranslationKey | null;
  loading: boolean;
}

const INITIAL_STATE: PlayersState = {
  players: [],
  error: null,
  loading: true,
};

const listDesktopPlayers: RepoDitorApi["players"]["list"] = (saveId) =>
  window.repoditor.players.list(saveId);

function initialState(result: DesktopOperationResult<PlayerDto[]> | null): PlayersState {
  if (result === null) return INITIAL_STATE;
  return result.ok
    ? { players: result.data, error: null, loading: false }
    : { players: [], error: operationErrorKey(result.error.code), loading: false };
}
export function usePlayers(
  saveId: string,
  initialResult: DesktopOperationResult<PlayerDto[]> | null = null,
  list: RepoDitorApi["players"]["list"] = listDesktopPlayers,
) {
  const { t } = usePreferences();
  const [state, setState] = useState<PlayersState>(() => initialState(initialResult));
  const initialResultRef = useRef(initialResult);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(() =>
    initialResult?.ok ? (initialResult.data[0]?.id ?? null) : null,
  );
  const [pendingByPlayer, setPendingByPlayer] = useState<Record<string, PlayerHealthEdit>>({});
  const mounted = useRef(false);
  const playerRequestInFlight = useRef(false);
  const projectionVersion = useRef(0);

  const loadPlayers = useCallback(
    async (preserveExisting = false): Promise<boolean> => {
      if (playerRequestInFlight.current) {
        return false;
      }
      playerRequestInFlight.current = true;
      const version = projectionVersion.current;
      try {
        const result = await list(saveId);
        if (!mounted.current || version !== projectionVersion.current) return result.ok;
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
        if (mounted.current && version === projectionVersion.current) {
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
    [list, saveId],
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

  function updateHealth(player: PlayerDto, health: number): void {
    if (!Number.isSafeInteger(health)) return;
    const validHealth = Math.min(Math.max(health, 0), player.maxHealth);
    setPendingByPlayer((current) => {
      if (validHealth === player.health) {
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
          after: validHealth,
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

  function selectPlayer(playerId: string): void {
    if (state.players.some((player) => player.id === playerId)) setSelectedPlayerId(playerId);
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

  function acceptSnapshot(next: PlayerDto[]): void {
    projectionVersion.current += 1;
    setState({ players: next, error: null, loading: false });
    setSelectedPlayerId((current) =>
      next.some((player) => player.id === current) ? current : (next[0]?.id ?? null),
    );
  }

  return {
    ...state,
    error: state.error ? t(state.error) : null,
    selectedPlayerId,
    setSelectedPlayerId: selectPlayer,
    pendingByPlayer,
    pendingEdits: Object.values(pendingByPlayer),
    updateHealth,
    revertHealth,
    revertAll,
    applyAfterSave,
    acceptSnapshot,
    reload,
    refreshAfterSave: () => loadPlayers(true),
  };
}
