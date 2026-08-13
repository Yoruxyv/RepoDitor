import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RepoDitorApi } from "@electron/contracts";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { usePlayers } from "./usePlayers";

const saveId = "REPO_SAVE_2026_08_08_10_20_30";
const playerId = "76561197960287930";
const player = { id: playerId, name: "Alpha", health: 80, maxHealth: 100 };

function wrapper({ children }: { readonly children: ReactNode }) {
  return <PreferencesProvider>{children}</PreferencesProvider>;
}

function installBridge(avatar: RepoDitorApi["players"]["avatar"]): void {
  Object.defineProperty(window, "repoditor", {
    configurable: true,
    value: {
      players: {
        avatar,
        list: vi.fn().mockResolvedValue({ ok: true, data: [player] }),
      },
    },
  });
}

describe("usePlayers avatar requests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a successful URL cached and preserves the Steam ID as a string", async () => {
    const avatarUrl = "https://avatars.fastly.steamstatic.com/avatar.jpg";
    const avatar = vi.fn().mockResolvedValue({
      ok: true,
      data: { playerId, avatarUrl },
    });
    installBridge(avatar);
    const { result } = renderHook(() => usePlayers(saveId), { wrapper });

    await waitFor(() => expect(result.current.avatarUrls[playerId]).toBe(avatarUrl));
    expect(avatar).toHaveBeenCalledWith(saveId, playerId);
    expect(typeof avatar.mock.calls[0]?.[1]).toBe("string");

    await act(async () => result.current.loadAvatar(playerId));
    act(() => result.current.setSelectedPlayerId(playerId));
    expect(avatar).toHaveBeenCalledTimes(1);
  });

  it("suppresses duplicates and permits only one retry after the cooldown", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let resolveFirst: ((value: {
      ok: true;
      data: { playerId: string; avatarUrl: null };
    }) => void) | undefined;
    const avatar = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValue({ ok: true, data: { playerId, avatarUrl: null } });
    installBridge(avatar);
    const { result } = renderHook(() => usePlayers(saveId), { wrapper });

    await waitFor(() => expect(avatar).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.setSelectedPlayerId(playerId);
      result.current.setSelectedPlayerId(playerId);
    });
    expect(avatar).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst?.({ ok: true, data: { playerId, avatarUrl: null } });
    });
    await waitFor(() => expect(result.current.avatarUrls[playerId]).toBeNull());

    act(() => result.current.setSelectedPlayerId(playerId));
    expect(avatar).toHaveBeenCalledTimes(1);

    now += 30_000;
    act(() => result.current.setSelectedPlayerId(playerId));
    await waitFor(() => expect(avatar).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.avatarUrls[playerId]).toBeNull());

    now += 30_000;
    act(() => result.current.setSelectedPlayerId(playerId));
    expect(avatar).toHaveBeenCalledTimes(2);
  });

  it("allows one bounded retry after an avatar image failure", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const avatarUrl = "https://avatars.fastly.steamstatic.com/avatar.jpg";
    const avatar = vi.fn().mockResolvedValue({
      ok: true,
      data: { playerId, avatarUrl },
    });
    installBridge(avatar);
    const { result } = renderHook(() => usePlayers(saveId), { wrapper });

    await waitFor(() => expect(result.current.avatarUrls[playerId]).toBe(avatarUrl));
    act(() => result.current.rejectAvatar(playerId));
    expect(result.current.avatarUrls[playerId]).toBeNull();

    act(() => result.current.setSelectedPlayerId(playerId));
    expect(avatar).toHaveBeenCalledTimes(1);

    now += 30_000;
    act(() => result.current.setSelectedPlayerId(playerId));
    await waitFor(() => expect(avatar).toHaveBeenCalledTimes(2));
  });
});
