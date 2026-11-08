/** Selected-player-only optional lookups, with one finite transient retry per session. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RepoDitorApi } from "@electron/contracts";

type AvatarLoader = RepoDitorApi["players"]["avatar"];
interface AvatarAttempt {
  requests: number;
  retryAt: number | null;
}
interface AvatarSession {
  saveId: string;
  urls: Record<string, string | null>;
  attempts: Map<string, AvatarAttempt>;
  busy: boolean;
  active: boolean;
  notBefore: number;
  blocked: boolean;
}

export function usePlayerAvatars(
  saveId: string,
  selectedPlayerId: string | null,
  fetchAvatar: AvatarLoader = window.repoditor.players.avatar,
) {
  const session = useRef<AvatarSession | null>(null);
  const [snapshot, setSnapshot] = useState<{ saveId: string; urls: Record<string, string | null> }>(
    { saveId, urls: {} },
  );
  const publish = useCallback((state: AvatarSession) => {
    if (state.active) setSnapshot({ saveId: state.saveId, urls: { ...state.urls } });
  }, []);
  useEffect(() => {
    const state: AvatarSession =
      session.current?.saveId === saveId
        ? session.current
        : {
            saveId,
            urls: {},
            attempts: new Map(),
            busy: false,
            active: true,
            notBefore: 0,
            blocked: false,
          };
    state.active = true;
    session.current = state;
    publish(state);
    return () => {
      state.active = false;
    };
  }, [publish, saveId]);

  const loadAvatar = useCallback(
    async (playerId: string) => {
      const state = session.current;
      if (state?.saveId !== saveId) return;
      const attempt = state.attempts.get(playerId);
      if (
        !state.active ||
        state.busy ||
        state.blocked ||
        playerId !== selectedPlayerId ||
        typeof state.urls[playerId] === "string" ||
        (attempt && (attempt.requests >= 2 || attempt.retryAt === null)) ||
        Date.now() < Math.max(state.notBefore, attempt?.retryAt ?? 0)
      )
        return;
      const current: AvatarAttempt = { requests: (attempt?.requests ?? 0) + 1, retryAt: null };
      state.attempts.set(playerId, current);
      state.busy = true;
      publish(state);
      let delay: number | null = null;
      let url: string | null = null;
      try {
        const result = await fetchAvatar(saveId, playerId);
        if (result.ok && result.data.playerId === playerId) {
          url = result.data.avatarUrl;
          if (result.data.status === "transient") {
            delay = result.data.retryAfterMs ?? null;
            if (delay === null) state.blocked = true;
          }
        } else if (
          !result.ok &&
          ["process_timeout", "process_failed", "backend_unavailable"].includes(result.error.code)
        ) {
          delay = 60_000;
        }
      } catch {
        delay = 60_000;
      } finally {
        state.busy = false;
        state.urls[playerId] = url;
        // Both native and Electron projections validate the bounded retry delay.
        if (delay !== null) {
          current.retryAt = Date.now() + delay;
          // A rate-limited lookup must not be followed by a burst for other players.
          state.notBefore = Math.max(state.notBefore, current.retryAt);
        }
        publish(state);
      }
    },
    [fetchAvatar, publish, saveId, selectedPlayerId],
  );

  useEffect(() => {
    const state = session.current;
    if (state?.saveId !== saveId) return;
    if (selectedPlayerId === null) return;
    if (state.blocked) {
      if (state.urls[selectedPlayerId] === undefined) {
        state.urls[selectedPlayerId] = null;
        publish(state);
      }
      return;
    }
    const attempt = state.attempts.get(selectedPlayerId);
    if (
      typeof state.urls[selectedPlayerId] === "string" ||
      (attempt && (attempt.requests >= 2 || attempt.retryAt === null))
    )
      return;
    const delay = Math.max(state.notBefore, attempt?.retryAt ?? 0) - Date.now();
    if (delay > 0) {
      if (state.urls[selectedPlayerId] === undefined) {
        state.urls[selectedPlayerId] = null;
        publish(state);
      }
      const timer = setTimeout(() => {
        void loadAvatar(selectedPlayerId);
      }, delay);
      return () => clearTimeout(timer);
    }
    void loadAvatar(selectedPlayerId);
  }, [loadAvatar, publish, saveId, selectedPlayerId, snapshot]);

  const rejectAvatar = useCallback(
    (playerId: string) => {
      const state = session.current;
      if (state?.saveId !== saveId) return;
      const attempt = state.attempts.get(playerId);
      if (!state.active || !attempt || state.urls[playerId] === null) return;
      state.urls[playerId] = null;
      attempt.retryAt = Date.now() + 60_000;
      publish(state);
    },
    [publish, saveId],
  );

  return {
    avatarUrls: snapshot.saveId === saveId ? snapshot.urls : {},
    loadAvatar,
    rejectAvatar,
  };
}
