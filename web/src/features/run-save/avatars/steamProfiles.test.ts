import { describe, expect, it, vi } from "vitest";

import {
  isPlausibleSteamId,
  resolveSteamAvatarUrls,
  safeSteamAvatarUrl,
} from "@/features/run-save/avatars/steamProfiles";

const STEAM_ID = "76561197960287930";
const AVATAR_URL = "https://avatars.fastly.steamstatic.com/avatar.jpg";
const CLEAR_TEXT_AVATAR_URL = ["http", "://avatars.fastly.steamstatic.com/avatar.jpg"].join("");

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe("Steam avatar endpoint client", () => {
  it("validates the Desktop SteamID64 range without Number coercion", () => {
    expect(isPlausibleSteamId(STEAM_ID)).toBe(true);
    expect(isPlausibleSteamId("76561197960265728")).toBe(true);
    expect(isPlausibleSteamId("76561202255233023")).toBe(true);
    expect(isPlausibleSteamId("111")).toBe(false);
    expect(isPlausibleSteamId("76561197960265727")).toBe(false);
    expect(isPlausibleSteamId("76561202255233024")).toBe(false);
    expect(isPlausibleSteamId("7656119796028793x")).toBe(false);
  });

  it("sends only deduplicated valid IDs to the same-origin endpoint", async () => {
    const fetchEndpoint = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ avatars: { [STEAM_ID]: AVATAR_URL } }));

    await expect(
      resolveSteamAvatarUrls([STEAM_ID, STEAM_ID, "111"], fetchEndpoint),
    ).resolves.toEqual({ [STEAM_ID]: AVATAR_URL });
    expect(fetchEndpoint).toHaveBeenCalledOnce();
    const [url, options] = fetchEndpoint.mock.calls[0]!;
    expect(url).toBe("/api/steam-avatars");
    expect(options).toMatchObject({
      body: JSON.stringify({ steamIds: [STEAM_ID] }),
      credentials: "same-origin",
      method: "POST",
      redirect: "error",
    });
  });

  it("does not request the endpoint when no valid ID remains", async () => {
    const fetchEndpoint = vi.fn<typeof fetch>();
    await expect(
      resolveSteamAvatarUrls(["111", "https://example.com"], fetchEndpoint),
    ).resolves.toEqual({});
    expect(fetchEndpoint).not.toHaveBeenCalled();
  });

  it.each([
    "https://example.com/avatar.jpg",
    CLEAR_TEXT_AVATAR_URL,
    "https://user@avatars.fastly.steamstatic.com/avatar.jpg",
    "https://avatars.fastly.steamstatic.com:444/avatar.jpg",
    "https://avatars.fastly.steamstatic.com.example.com/avatar.jpg",
  ])("rejects unsafe avatar URL %s", (avatarUrl) => {
    expect(safeSteamAvatarUrl(avatarUrl)).toBeNull();
  });

  it("fails soft for endpoint failures and malformed responses", async () => {
    const failures = [
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Unavailable")),
      vi.fn<typeof fetch>().mockResolvedValue(response({ error: "Unavailable" }, 503)),
      vi.fn<typeof fetch>().mockResolvedValue(response({ avatars: [] })),
      vi.fn<typeof fetch>().mockResolvedValue(response({ avatars: { [STEAM_ID]: "unsafe" } })),
    ];
    for (const fetchEndpoint of failures) {
      await expect(resolveSteamAvatarUrls([STEAM_ID], fetchEndpoint)).resolves.toEqual({
        [STEAM_ID]: null,
      });
    }
  });
});
