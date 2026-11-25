import { isTauri } from "@tauri-apps/api/core";
import type { DesktopOperationResult, PlayerAvatar } from "@/app/tauri/desktopContracts";

export type AvatarLoader = (
  saveId: string,
  playerId: string,
) => Promise<DesktopOperationResult<PlayerAvatar>>;
type CachedAvatar = { url: string; expiresAt: number };
const AVATAR_TTL_MS = 15 * 60_000;
const STORAGE_KEY = "repoditor.steamAvatarUrls";
const MAX_ENTRIES = 64;
const avatarCache = new WeakMap<AvatarLoader, Map<string, CachedAvatar>>();

function validEntry(row: unknown): row is [string, CachedAvatar] {
  if (!Array.isArray(row) || row.length !== 2) return false;
  const [id, entry] = row as [unknown, Partial<CachedAvatar> | null];
  return (
    typeof id === "string" &&
    /^76561\d{12}$/.test(id) &&
    typeof entry?.expiresAt === "number" &&
    entry.expiresAt > Date.now() &&
    entry.expiresAt <= Date.now() + AVATAR_TTL_MS &&
    typeof entry.url === "string" &&
    entry.url.length <= 2048 &&
    /^https:\/\/avatars\.(?:akamai|fastly)\.steamstatic\.com(?::443)?\/[a-z\d/_-]+\.(?:jpg|png|jpeg|webp)$/i.test(
      entry.url,
    )
  );
}

function readCache(): Map<string, CachedAvatar> {
  if (!isTauri()) return new Map();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const entries: unknown = stored && stored.length <= 150_000 ? JSON.parse(stored) : null;
    if (Array.isArray(entries) && entries.length <= MAX_ENTRIES) {
      return new Map(entries.filter(validEntry));
    }
  } catch {
    // An unavailable WebView profile must not block player presentation.
  }
  return new Map();
}

function cacheFor(loader: AvatarLoader) {
  const existing = avatarCache.get(loader);
  if (existing) return existing;
  const cache = readCache();
  avatarCache.set(loader, cache);
  return cache;
}

function persist(cache: Map<string, CachedAvatar>) {
  if (!isTauri()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...cache].filter(validEntry)));
  } catch {
    // Reuse remains available for this process if WebView storage is unavailable.
  }
}

export function cachedAvatar(loader: AvatarLoader, playerId: string): string | undefined {
  const cache = cacheFor(loader);
  const entry = cache.get(playerId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(playerId);
    return undefined;
  }
  return entry.url;
}

export function rememberAvatar(loader: AvatarLoader, playerId: string, url: string) {
  const cache = cacheFor(loader);
  cache.delete(playerId);
  cache.set(playerId, { url, expiresAt: Date.now() + AVATAR_TTL_MS });
  const oldest = cache.keys().next().value;
  if (cache.size > MAX_ENTRIES && oldest !== undefined) cache.delete(oldest);
  persist(cache);
}

export function forgetAvatar(loader: AvatarLoader, playerId: string, failedUrl: string) {
  const cache = cacheFor(loader);
  if (cache.get(playerId)?.url !== failedUrl) return;
  cache.delete(playerId);
  persist(cache);
}
