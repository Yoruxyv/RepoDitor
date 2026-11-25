import { useEffect, useRef, useState } from "react";

import type { RunPlayer } from "@/features/run-save/model/runSave";
import {
  isPlausibleSteamId,
  resolveSteamAvatarUrls,
} from "@/features/run-save/avatars/steamProfiles";

interface AvatarState {
  readonly sessionToken: symbol;
  readonly urls: Readonly<Record<string, string | null | undefined>>;
}

function initialState(sessionToken: symbol): AvatarState {
  return { sessionToken, urls: {} };
}

export function useSteamAvatars(players: readonly RunPlayer[], sessionToken: symbol) {
  const [stored, setStored] = useState<AvatarState>(() => initialState(sessionToken));
  const requested = useRef({ sessionToken, playerIds: new Set<string>() });
  const state = stored.sessionToken === sessionToken ? stored : initialState(sessionToken);
  const playerIds = [
    ...new Set(players.map((player) => player.id).filter(isPlausibleSteamId)),
  ].join(",");

  useEffect(() => {
    setStored((current) =>
      current.sessionToken === sessionToken ? current : initialState(sessionToken),
    );
    if (requested.current.sessionToken !== sessionToken) {
      requested.current = { sessionToken, playerIds: new Set<string>() };
    }
    const pendingIds = playerIds
      .split(",")
      .filter((playerId) => playerId && !requested.current.playerIds.has(playerId));
    if (pendingIds.length === 0) {
      return;
    }
    for (const playerId of pendingIds) {
      requested.current.playerIds.add(playerId);
    }
    void resolveSteamAvatarUrls(pendingIds).then((urls) => {
      setStored((current) =>
        current.sessionToken === sessionToken
          ? { ...current, urls: { ...current.urls, ...urls } }
          : current,
      );
    });
  }, [playerIds, sessionToken]);

  function reject(playerId: string): void {
    setStored((current) =>
      current.sessionToken === sessionToken
        ? { ...current, urls: { ...current.urls, [playerId]: null } }
        : current,
    );
  }

  return {
    avatarUrl: (playerId: string) => (isPlausibleSteamId(playerId) ? state.urls[playerId] : null),
    reject,
  };
}
