const STEAM_ID64_MIN = 76_561_197_960_265_728n;
const STEAM_ID64_MAX = STEAM_ID64_MIN + 2n ** 32n - 1n;
const STEAM_AVATAR_HOSTS = new Set([
  "avatars.akamai.steamstatic.com",
  "avatars.fastly.steamstatic.com",
]);
const MAX_STEAM_IDS = 16;
const MAX_ENDPOINT_BYTES = 32 * 1024;
const ENDPOINT_TIMEOUT_MS = 4_000;

export function isPlausibleSteamId(playerId: string): boolean {
  return (
    /^\d{17}$/u.test(playerId) &&
    BigInt(playerId) >= STEAM_ID64_MIN &&
    BigInt(playerId) <= STEAM_ID64_MAX
  );
}

export function safeSteamAvatarUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      !STEAM_AVATAR_HOSTS.has(url.hostname) ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fallbacks(playerIds: readonly string[]): Record<string, null> {
  return Object.fromEntries(playerIds.map((playerId) => [playerId, null]));
}

async function readBoundedText(response: Response): Promise<string | null> {
  if (!response.body) {
    return null;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  while (true) {
    const result = await reader.read();
    if (result.done) {
      return text + decoder.decode();
    }
    bytesRead += result.value.byteLength;
    if (bytesRead > MAX_ENDPOINT_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(result.value, { stream: true });
  }
}

export async function resolveSteamAvatarUrls(
  rawPlayerIds: readonly string[],
  fetchEndpoint: typeof fetch = fetch,
): Promise<Readonly<Record<string, string | null>>> {
  const playerIds = [...new Set(rawPlayerIds.filter(isPlausibleSteamId))];
  const unavailable = fallbacks(playerIds);
  if (playerIds.length === 0 || playerIds.length > MAX_STEAM_IDS) {
    return unavailable;
  }

  try {
    const response = await fetchEndpoint("/api/steam-avatars", {
      body: JSON.stringify({ steamIds: playerIds }),
      cache: "no-store",
      // Credentials and referrer policy are independent controls that intentionally share this value.
      // eslint-disable-next-line sonarjs/no-duplicate-string
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      redirect: "error",
      referrerPolicy: "same-origin",
      signal: AbortSignal.timeout(ENDPOINT_TIMEOUT_MS),
    });
    const source = await readBoundedText(response);
    if (!response.ok || source === null) {
      return unavailable;
    }
    const result = JSON.parse(source) as unknown;
    if (!isRecord(result) || !Object.hasOwn(result, "avatars") || !isRecord(result.avatars)) {
      return unavailable;
    }
    const avatarPayload = result.avatars;
    return Object.fromEntries(
      playerIds.map((playerId) => {
        const rawUrl = Object.hasOwn(avatarPayload, playerId) ? avatarPayload[playerId] : null;
        return [playerId, typeof rawUrl === "string" ? safeSteamAvatarUrl(rawUrl) : null];
      }),
    );
  } catch {
    return unavailable;
  }
}
