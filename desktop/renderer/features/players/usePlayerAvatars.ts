/** Selected-player-only optional lookups with bounded reuse and retries. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopOperationResult, PlayerDto } from "@/app/tauri/desktopContracts";
import { cachedAvatar, forgetAvatar, rememberAvatar, type AvatarLoader } from "./avatarCache";

const AVATAR_RETRY_MS = 60_000;
const steamCooldown = new WeakMap<AvatarLoader, number>();

async function lookupAvatar(loader: AvatarLoader, saveId: string, playerId: string) {
  const result = await loader(saveId, playerId);
  if (result.ok && result.data.playerId === playerId && result.data.status === "transient") {
    const delay = result.data.retryAfterMs ?? Infinity;
    steamCooldown.set(loader, Math.max(steamCooldown.get(loader) ?? 0, Date.now() + delay));
  }
  return result;
}

export interface AvatarPrefetch {
  readonly saveId: string;
  readonly playerId: string;
  readonly result: ReturnType<AvatarLoader>;
}

/** Start only the first selected player's optional lookup, without owning retry state. */
export function prefetchInitialAvatar(
  saveId: string,
  players: DesktopOperationResult<PlayerDto[]>,
  fetchAvatar: AvatarLoader,
): AvatarPrefetch | undefined {
  const playerId = players.ok ? players.data[0]?.id : undefined;
  if (
    !playerId ||
    cachedAvatar(fetchAvatar, playerId) ||
    Date.now() < (steamCooldown.get(fetchAvatar) ?? 0)
  )
    return undefined;
  return {
    saveId,
    playerId,
    result: lookupAvatar(fetchAvatar, saveId, playerId).catch(() => ({
      ok: false as const,
      error: { code: "backend_unavailable", message: "The avatar service is unavailable." },
    })),
  };
}

interface AvatarAttempt {
  requests: number;
  retryAt: number | null;
}

async function resolveAvatar(
  playerId: string,
  request: () => ReturnType<AvatarLoader>,
): Promise<{ url: string | null; retryAfterMs?: number | null }> {
  try {
    const result = await request();
    if (result.ok) {
      if (result.data.playerId !== playerId) return { url: null };
      if (result.data.status === "transient") {
        return { url: null, retryAfterMs: result.data.retryAfterMs ?? null };
      }
      return { url: result.data.avatarUrl };
    }
    const { code } = result.error;
    if (code === "process_cancelled") return { url: null, retryAfterMs: 1_000 };
    if (
      ["process_timeout", "process_failed", "backend_unavailable", "internal_error"].includes(code)
    ) {
      return { url: null, retryAfterMs: AVATAR_RETRY_MS };
    }
    return { url: null };
  } catch {
    return { url: null, retryAfterMs: AVATAR_RETRY_MS };
  }
}

interface AvatarSession {
  saveId: string;
  urls: Record<string, string | null>;
  attempts: Map<string, AvatarAttempt>;
  busy: boolean;
  active: boolean;
  notBefore: number;
  blocked: boolean;
  prefetch: AvatarPrefetch | undefined;
}

export function usePlayerAvatars(
  saveId: string,
  selectedPlayerId: string | null,
  fetchAvatar: AvatarLoader,
  prefetch?: AvatarPrefetch,
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
            prefetch: undefined,
          };
    if (prefetch?.saveId === saveId && !state.attempts.has(prefetch.playerId))
      state.prefetch = prefetch;
    state.active = true;
    session.current = state;
    publish(state);
    return () => {
      state.active = false;
    };
  }, [prefetch, publish, saveId]);

  const loadAvatar = useCallback(
    async (playerId: string) => {
      const state = session.current;
      if (state?.saveId !== saveId || !state.active || playerId !== selectedPlayerId) return;
      if (typeof state.urls[playerId] === "string") return;
      const cached = cachedAvatar(fetchAvatar, playerId);
      if (cached !== undefined && !state.attempts.has(playerId)) {
        state.urls[playerId] = cached;
        state.attempts.set(playerId, { requests: 0, retryAt: null });
        publish(state);
        return;
      }
      const attempt = state.attempts.get(playerId);
      const prefetched = state.prefetch?.playerId === playerId ? state.prefetch : undefined;
      const notBefore = Math.max(state.notBefore, steamCooldown.get(fetchAvatar) ?? 0);
      if (
        state.busy ||
        state.blocked ||
        (attempt && (attempt.requests >= 2 || attempt.retryAt === null)) ||
        (!prefetched && Date.now() < Math.max(notBefore, attempt?.retryAt ?? 0))
      )
        return;
      const current: AvatarAttempt = { requests: (attempt?.requests ?? 0) + 1, retryAt: null };
      state.attempts.set(playerId, current);
      state.busy = true;
      publish(state);
      if (prefetched) state.prefetch = undefined;
      const { url, retryAfterMs } = await resolveAvatar(playerId, () =>
        prefetched ? prefetched.result : lookupAvatar(fetchAvatar, saveId, playerId),
      );
      state.busy = false;
      state.urls[playerId] = url;
      if (state.active && url !== null) rememberAvatar(fetchAvatar, playerId, url);
      if (retryAfterMs === null) state.blocked = true;
      if (typeof retryAfterMs === "number") {
        current.retryAt = Date.now() + retryAfterMs;
        // A rate-limited lookup must not be followed by a burst for other players.
        state.notBefore = Math.max(state.notBefore, current.retryAt);
      }
      publish(state);
    },
    [fetchAvatar, publish, saveId, selectedPlayerId],
  );

  useEffect(() => {
    const state = session.current;
    if (state?.saveId !== saveId) return;
    if (selectedPlayerId === null) return;
    const cached = cachedAvatar(fetchAvatar, selectedPlayerId);
    if (cached !== undefined && !state.attempts.has(selectedPlayerId)) {
      void loadAvatar(selectedPlayerId);
      return;
    }
    const prefetched = state.prefetch?.playerId === selectedPlayerId;
    const notBefore = prefetched
      ? 0
      : Math.max(state.notBefore, steamCooldown.get(fetchAvatar) ?? 0);
    if (state.blocked || notBefore === Infinity) {
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
    const delay = Math.max(notBefore, attempt?.retryAt ?? 0) - Date.now();
    if (delay > 0) {
      if (state.urls[selectedPlayerId] === undefined) {
        state.urls[selectedPlayerId] = null;
        publish(state);
      }
      const timer = setTimeout(() => {
        publish(state);
      }, delay);
      return () => clearTimeout(timer);
    }
    void loadAvatar(selectedPlayerId);
  }, [fetchAvatar, loadAvatar, publish, saveId, selectedPlayerId, snapshot]);

  useEffect(() => {
    if (selectedPlayerId === null) return;
    function resumeAvatar() {
      if (selectedPlayerId === null) return;
      const state = session.current;
      if (!state?.active || state.saveId !== saveId || state.busy) return;
      const attempt = state.attempts.get(selectedPlayerId);
      if (
        attempt?.requests === 2 &&
        attempt.retryAt !== null &&
        Date.now() >=
          Math.max(attempt.retryAt, state.notBefore, steamCooldown.get(fetchAvatar) ?? 0)
      ) {
        attempt.requests = 1;
        void loadAvatar(selectedPlayerId);
      }
    }
    window.addEventListener("focus", resumeAvatar);
    return () => window.removeEventListener("focus", resumeAvatar);
  }, [fetchAvatar, loadAvatar, saveId, selectedPlayerId]);

  const rejectAvatar = useCallback(
    (playerId: string, failedUrl: string) => {
      const state = session.current;
      if (state?.saveId !== saveId) return;
      const attempt = state.attempts.get(playerId);
      if (!state.active || !attempt || state.urls[playerId] !== failedUrl) return;
      forgetAvatar(fetchAvatar, playerId, failedUrl);
      state.urls[playerId] = null;
      attempt.retryAt = Date.now() + AVATAR_RETRY_MS;
      publish(state);
    },
    [fetchAvatar, publish, saveId],
  );

  return {
    avatarUrls: snapshot.saveId === saveId ? snapshot.urls : {},
    loadAvatar,
    rejectAvatar,
  };
}
