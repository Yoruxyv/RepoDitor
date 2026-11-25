import { renderHook, waitFor } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RunPlayer } from "@/features/run-save/model/runSave";
import { useSteamAvatars } from "@/features/run-save/avatars/useSteamAvatars";

const FIRST_ID = "76561197960287930";
const SECOND_ID = "76561198000000001";
const AVATAR_URL = "https://avatars.fastly.steamstatic.com/avatar.jpg";
const players: readonly RunPlayer[] = [
  { health: 80, id: FIRST_ID, name: "Alpha" },
  { health: 60, id: SECOND_ID, name: "Beta" },
  { health: 40, id: "111", name: "Local" },
];

function strictMode({ children }: { readonly children: ReactNode }) {
  return createElement(StrictMode, null, children);
}

function endpointResponse(avatars: Record<string, string>): Response {
  return Response.json({ avatars });
}

afterEach(() => vi.unstubAllGlobals());

describe("useSteamAvatars", () => {
  it("loads once under Strict Mode, fails independently, and never persists results", async () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const fetchEndpoint = vi
      .fn<typeof fetch>()
      .mockResolvedValue(endpointResponse({ [FIRST_ID]: AVATAR_URL }));
    vi.stubGlobal("fetch", fetchEndpoint);
    const sessionToken = Symbol("session-a");
    const { result } = renderHook(() => useSteamAvatars(players, sessionToken), {
      wrapper: strictMode,
    });

    await waitFor(() => expect(fetchEndpoint).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.avatarUrl(FIRST_ID)).toBe(AVATAR_URL));
    await waitFor(() => expect(result.current.avatarUrl(SECOND_ID)).toBeNull());
    expect(result.current.avatarUrl("111")).toBeNull();
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it("prevents a stale response from populating a replacement session", async () => {
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchEndpoint = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(endpointResponse({}));
    vi.stubGlobal("fetch", fetchEndpoint);
    const firstToken = Symbol("first");
    const secondToken = Symbol("second");
    const { result, rerender } = renderHook(({ token }) => useSteamAvatars(players, token), {
      initialProps: { token: firstToken },
    });

    await waitFor(() => expect(fetchEndpoint).toHaveBeenCalledOnce());
    rerender({ token: secondToken });
    await waitFor(() => expect(fetchEndpoint).toHaveBeenCalledTimes(2));
    resolveFirst(endpointResponse({ [FIRST_ID]: AVATAR_URL }));
    await waitFor(() => expect(result.current.avatarUrl(FIRST_ID)).toBeNull());
  });
});
