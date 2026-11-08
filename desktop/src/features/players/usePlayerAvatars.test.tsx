import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RepoDitorApi } from "@electron/contracts";
import { usePlayerAvatars } from "./usePlayerAvatars";

const saveId = "REPO_SAVE_2026_08_08_10_20_30";
const alpha = "76561197960287930";
const beta = "76561198000000001";

function installBridge(avatar: RepoDitorApi["players"]["avatar"]): void {
  Object.defineProperty(window, "repoditor", {
    configurable: true,
    value: { players: { avatar } },
  });
}

describe("usePlayerAvatars", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not duplicate a pending lookup under StrictMode effect replay", async () => {
    let resolve!: (value: unknown) => void;
    const avatar = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const loader = avatar as RepoDitorApi["players"]["avatar"];
    renderHook(() => usePlayerAvatars(saveId, alpha, loader), { wrapper: StrictMode });
    expect(avatar).toHaveBeenCalledTimes(1);
    await act(async () =>
      resolve({ ok: true, data: { playerId: alpha, avatarUrl: null, status: "unavailable" } }),
    );
    expect(avatar).toHaveBeenCalledTimes(1);
  });

  it("fetches by stable identity once and reuses cached URLs across replacements and switches", async () => {
    const avatar = vi.fn((_saveId: string, playerId: string) =>
      Promise.resolve({
        ok: true as const,
        data: { playerId, avatarUrl: `https://avatars.fastly.steamstatic.com/${playerId}.jpg` },
      }),
    );
    installBridge(avatar);
    const { result, rerender } = renderHook(
      ({ selectedPlayerId }) => usePlayerAvatars(saveId, selectedPlayerId),
      { initialProps: { selectedPlayerId: alpha } },
    );

    await waitFor(() => expect(result.current.avatarUrls[alpha]).toContain(alpha));
    expect(avatar).toHaveBeenCalledTimes(1);

    rerender({ selectedPlayerId: alpha });
    expect(avatar).toHaveBeenCalledTimes(1);

    rerender({ selectedPlayerId: beta });
    await waitFor(() => expect(result.current.avatarUrls[beta]).toContain(beta));
    expect(avatar).toHaveBeenCalledTimes(2);

    rerender({ selectedPlayerId: alpha });
    expect(avatar).toHaveBeenCalledTimes(2);
  });

  it("retries a transient lookup once after its server cooldown, never in a burst", async () => {
    vi.useFakeTimers();
    const avatar = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        playerId: alpha,
        avatarUrl: null,
        status: "transient",
        retryAfterMs: 45_000,
      },
    });
    installBridge(avatar);
    const { result } = renderHook(() => usePlayerAvatars(saveId, alpha));
    await act(async () => {});
    expect(avatar).toHaveBeenCalledTimes(1);
    expect(result.current.avatarUrls[alpha]).toBeNull();
    await act(async () => result.current.loadAvatar(alpha));
    await act(async () => vi.advanceTimersByTimeAsync(44_999));
    expect(avatar).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(avatar).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    expect(avatar).toHaveBeenCalledTimes(2);
  });

  it("keeps permanent and out-of-budget failures at initials without automatic requests", async () => {
    vi.useFakeTimers();
    const avatar = vi.fn((_save: string, playerId: string) =>
      Promise.resolve({
        ok: true as const,
        data: {
          playerId,
          avatarUrl: null,
          status: playerId === alpha ? ("unavailable" as const) : ("transient" as const),
          retryAfterMs: null,
        },
      }),
    );
    installBridge(avatar);
    const { rerender } = renderHook(({ id }) => usePlayerAvatars(saveId, id), {
      initialProps: { id: alpha },
    });
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    expect(avatar).toHaveBeenCalledTimes(1);
    rerender({ id: beta });
    await act(async () => {});
    rerender({ id: alpha });
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    expect(avatar).toHaveBeenCalledTimes(2);
  });

  it("serializes selection changes and deduplicates requests already in flight", async () => {
    let resolve!: (value: unknown) => void;
    const avatar = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue({
        ok: true,
        data: { playerId: beta, avatarUrl: null, status: "unavailable" },
      });
    installBridge(avatar);
    const { result, rerender } = renderHook(({ id }) => usePlayerAvatars(saveId, id), {
      initialProps: { id: alpha },
    });
    await act(async () => result.current.loadAvatar(alpha));
    expect(avatar).toHaveBeenCalledTimes(1);
    rerender({ id: beta });
    expect(avatar).toHaveBeenCalledTimes(1);
    await act(async () =>
      resolve({ ok: true, data: { playerId: alpha, avatarUrl: null, status: "unavailable" } }),
    );
    await waitFor(() => expect(avatar).toHaveBeenCalledTimes(2));
    expect(avatar).toHaveBeenLastCalledWith(saveId, beta);
  });

  it("clears stale selection timers and closes without retry activity", async () => {
    vi.useFakeTimers();
    const avatar = vi.fn((_save: string, playerId: string) =>
      Promise.resolve({
        ok: true as const,
        data: { playerId, avatarUrl: null, status: "transient" as const, retryAfterMs: 30_000 },
      }),
    );
    installBridge(avatar);
    const { rerender, unmount } = renderHook(({ id }) => usePlayerAvatars(saveId, id), {
      initialProps: { id: alpha },
    });
    await act(async () => {});
    rerender({ id: beta });
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(avatar).toHaveBeenCalledTimes(2);
    expect(avatar).toHaveBeenLastCalledWith(saveId, beta);
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    expect(avatar).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("discards late results when a new save session replaces the old one", async () => {
    let resolve!: (value: unknown) => void;
    const avatar = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue({
        ok: true,
        data: { playerId: alpha, avatarUrl: null, status: "unavailable" },
      });
    installBridge(avatar);
    const { result, rerender } = renderHook(({ save }) => usePlayerAvatars(save, alpha), {
      initialProps: { save: saveId },
    });
    rerender({ save: saveId + "-next" });
    await act(async () => {});
    expect(result.current.avatarUrls[alpha]).toBeNull();
    await act(async () =>
      resolve({
        ok: true,
        data: { playerId: alpha, avatarUrl: "https://avatars.fastly.steamstatic.com/stale.jpg" },
      }),
    );
    expect(result.current.avatarUrls[alpha]).toBeNull();
    expect(avatar).toHaveBeenCalledTimes(2);
  });

  it("allows one delayed refresh after a CDN image failure and reuses the refreshed URL", async () => {
    vi.useFakeTimers();
    const url = "https://avatars.fastly.steamstatic.com/current.jpg";
    const avatar = vi.fn().mockResolvedValue({
      ok: true,
      data: { playerId: alpha, avatarUrl: url, status: "available" },
    });
    installBridge(avatar);
    const { result } = renderHook(() => usePlayerAvatars(saveId, alpha));
    await act(async () => {});
    act(() => result.current.rejectAvatar(alpha));
    expect(result.current.avatarUrls[alpha]).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(59_999));
    expect(avatar).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(avatar).toHaveBeenCalledTimes(2);
    expect(result.current.avatarUrls[alpha]).toBe(url);
    act(() => result.current.rejectAvatar(alpha));
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    expect(avatar).toHaveBeenCalledTimes(2);
  });
});
