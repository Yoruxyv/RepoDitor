import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RepoDitorApi } from "@electron/contracts";
import { prefetchInitialAvatar, usePlayerAvatars } from "./usePlayerAvatars";

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

  it("reuses a successful result that completed before the workspace mounted", async () => {
    const avatar = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        playerId: alpha,
        avatarUrl: "https://avatars.fastly.steamstatic.com/ready.jpg",
        status: "available",
      },
    });
    const prefetched = prefetchInitialAvatar(
      saveId,
      { ok: true, data: [{ id: alpha, name: "Alpha", health: 100, maxHealth: 100 }] },
      avatar,
    )!;
    await prefetched.result;
    const { result } = renderHook(() => usePlayerAvatars(saveId, alpha, avatar, prefetched));
    await waitFor(() => expect(result.current.avatarUrls[alpha]).toContain("ready.jpg"));
    expect(avatar).toHaveBeenCalledTimes(1);
  });

  it("reuses the URL across workspaces until it expires and ignores an error for an old URL", async () => {
    vi.useFakeTimers();
    const oldUrl = "https://avatars.fastly.steamstatic.com/old.jpg";
    const newUrl = "https://avatars.fastly.steamstatic.com/new.jpg";
    const avatar = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: { playerId: alpha, avatarUrl: oldUrl } })
      .mockResolvedValueOnce({ ok: true, data: { playerId: alpha, avatarUrl: newUrl } });
    const first = renderHook(() => usePlayerAvatars(saveId, alpha, avatar));
    await act(async () => {});
    first.unmount();

    const second = renderHook(() => usePlayerAvatars(saveId + "-next", alpha, avatar));
    expect(second.result.current.avatarUrls[alpha]).toBe(oldUrl);
    expect(avatar).toHaveBeenCalledTimes(1);
    second.unmount();

    await act(async () => vi.advanceTimersByTimeAsync(15 * 60_000));
    const third = renderHook(() => usePlayerAvatars(saveId, alpha, avatar));
    await act(async () => {});
    act(() => third.result.current.rejectAvatar(alpha, oldUrl));
    expect(third.result.current.avatarUrls[alpha]).toBe(newUrl);
    expect(avatar).toHaveBeenCalledTimes(2);
  });

  it("recovers a repeated transient failure on refocus after the cooldown", async () => {
    vi.useFakeTimers();
    const transient = { ok: false, error: { code: "internal_error", message: "bridge failed" } };
    const avatar = vi
      .fn()
      .mockResolvedValueOnce(transient)
      .mockResolvedValueOnce(transient)
      .mockResolvedValueOnce({
        ok: true,
        data: { playerId: alpha, avatarUrl: "https://avatars.fastly.steamstatic.com/ready.jpg" },
      });
    const { result } = renderHook(() => usePlayerAvatars(saveId, alpha, avatar));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(result.current.avatarUrls[alpha]).toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(avatar).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(avatar).toHaveBeenCalledTimes(3);
    expect(result.current.avatarUrls[alpha]).toContain("ready.jpg");
  });

  it("sanitizes an early rejected prefetch and permits only one delayed recovery lookup", async () => {
    vi.useFakeTimers();
    const avatar = vi.fn().mockRejectedValue(new Error("private transport detail"));
    const prefetched = prefetchInitialAvatar(
      saveId,
      { ok: true, data: [{ id: alpha, name: "Alpha", health: 100, maxHealth: 100 }] },
      avatar,
    )!;
    expect(await prefetched.result).toEqual({
      ok: false,
      error: { code: "backend_unavailable", message: "The avatar service is unavailable." },
    });
    const { result, unmount } = renderHook(() =>
      usePlayerAvatars(saveId, alpha, avatar, prefetched),
    );
    await act(async () => {});
    expect(result.current.avatarUrls[alpha]).toBeNull();
    expect(avatar).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(59_999));
    expect(avatar).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(avatar).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    expect(avatar).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("adopts an in-flight initial lookup once and never shows it under a newly selected identity", async () => {
    let resolve!: (value: Awaited<ReturnType<RepoDitorApi["players"]["avatar"]>>) => void;
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
    const prefetched = prefetchInitialAvatar(
      saveId,
      { ok: true, data: [{ id: alpha, name: "Alpha", health: 100, maxHealth: 100 }] },
      avatar,
    )!;
    await act(async () => {});
    const { result, rerender } = renderHook(
      ({ id }) => usePlayerAvatars(saveId, id, avatar, prefetched),
      { initialProps: { id: alpha }, wrapper: StrictMode },
    );
    expect(avatar).toHaveBeenCalledTimes(1);
    rerender({ id: beta });
    expect(avatar).toHaveBeenCalledTimes(1);
    await act(async () =>
      resolve({
        ok: true,
        data: {
          playerId: alpha,
          avatarUrl: "https://avatars.fastly.steamstatic.com/alpha.jpg",
          status: "available",
        },
      }),
    );
    await waitFor(() => expect(avatar).toHaveBeenCalledTimes(2));
    expect(avatar).toHaveBeenLastCalledWith(saveId, beta);
    expect(result.current.avatarUrls[beta]).toBeNull();
    expect(result.current.avatarUrls[alpha]).toContain("alpha.jpg");
  });

  it("keeps a prefetched transient failure within the existing one-retry budget", async () => {
    vi.useFakeTimers();
    const avatar = vi.fn().mockResolvedValue({
      ok: true,
      data: { playerId: alpha, avatarUrl: null, status: "transient", retryAfterMs: 45_000 },
    });
    const prefetched = prefetchInitialAvatar(
      saveId,
      { ok: true, data: [{ id: alpha, name: "Alpha", health: 100, maxHealth: 100 }] },
      avatar,
    );
    await act(async () => {});
    const { result } = renderHook(() => usePlayerAvatars(saveId, alpha, avatar, prefetched));
    await act(async () => {});
    expect(result.current.avatarUrls[alpha]).toBeNull();
    expect(avatar).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(44_999));
    expect(avatar).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(avatar).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    expect(avatar).toHaveBeenCalledTimes(2);
  });

  it("honors a prefetched Steam cooldown after switching saves before mounting Players", async () => {
    vi.useFakeTimers();
    const avatar = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: { playerId: alpha, avatarUrl: null, status: "transient", retryAfterMs: 45_000 },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { playerId: beta, avatarUrl: "https://avatars.fastly.steamstatic.com/beta.jpg" },
      });
    const nextSave = saveId + "-next";
    const players = (id: string) => ({
      ok: true as const,
      data: [{ id, name: "Player", health: 100, maxHealth: 100 }],
    });
    await prefetchInitialAvatar(saveId, players(alpha), avatar)?.result;
    expect(prefetchInitialAvatar(nextSave, players(beta), avatar)).toBeUndefined();
    const { result } = renderHook(() => usePlayerAvatars(nextSave, beta, avatar));
    expect(result.current.avatarUrls[beta]).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(44_999));
    expect(avatar).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(avatar).toHaveBeenLastCalledWith(nextSave, beta);
    expect(result.current.avatarUrls[beta]).toContain("beta.jpg");
  });

  it("ignores another save's prefetched result and treats permanent failures as final", async () => {
    const avatar = vi.fn((_save: string, playerId: string) =>
      Promise.resolve({
        ok: true as const,
        data: { playerId, avatarUrl: null, status: "unavailable" as const },
      }),
    );
    const prefetched = prefetchInitialAvatar(
      saveId,
      { ok: true, data: [{ id: alpha, name: "Alpha", health: 100, maxHealth: 100 }] },
      avatar,
    );
    await act(async () => {});
    const { result } = renderHook(() =>
      usePlayerAvatars(saveId + "-new", alpha, avatar, prefetched),
    );
    await waitFor(() => expect(result.current.avatarUrls[alpha]).toBeNull());
    expect(avatar).toHaveBeenCalledTimes(2);
    expect(avatar).toHaveBeenLastCalledWith(saveId + "-new", alpha);
    await act(async () => result.current.loadAvatar(alpha));
    expect(avatar).toHaveBeenCalledTimes(2);
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
    act(() => result.current.rejectAvatar(alpha, url));
    expect(result.current.avatarUrls[alpha]).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(59_999));
    expect(avatar).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(avatar).toHaveBeenCalledTimes(2);
    expect(result.current.avatarUrls[alpha]).toBe(url);
    act(() => result.current.rejectAvatar(alpha, url));
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    expect(avatar).toHaveBeenCalledTimes(2);
  });
});
