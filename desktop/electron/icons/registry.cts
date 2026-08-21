/**
 * In-memory registry for opaque renderer-safe game icon tokens.
 *
 * Registrations bind domain identities to trusted local-cache keys or prepared
 * visuals. Local paths remain in Electron/Python and never cross into React.
 */
import { randomUUID } from "node:crypto";

export type IconDomain = "item" | "upgrade" | "cosmetic";

export interface CacheIconRegistration {
  readonly kind: "cache";
  readonly domain: IconDomain;
  readonly key: string;
}

export interface UpgradeVisualRegistration {
  readonly kind: "upgrade-visual";
  readonly domain: IconDomain;
  readonly cacheKey: string | null;
  readonly upgradeKey: string;
}

export type IconRegistration = CacheIconRegistration | UpgradeVisualRegistration;

export interface IconVisualRequest {
  readonly cacheKey: string | null;
  readonly upgradeKey: string | null;
}

const SAFE_KEY_PATTERN = /^[^/\\\0]{1,256}\.png$/;
const MAX_UPGRADE_KEY_BYTES = 512;

export function readIconKey(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    !SAFE_KEY_PATTERN.test(value) ||
    value !== value.toLowerCase() ||
    value === ".png" ||
    value === "..png"
  ) {
    throw new Error("Invalid local icon key.");
  }
  return value;
}

export function readUpgradeVisualKey(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !value.startsWith("playerUpgrade") ||
    value === "playerUpgrade" ||
    Buffer.byteLength(value, "utf8") > MAX_UPGRADE_KEY_BYTES ||
    value.includes("\0")
  ) {
    throw new Error("Invalid upgrade visual key.");
  }
  return value;
}

function signature(entry: IconRegistration): string {
  return entry.kind === "cache"
    ? `cache:${entry.key}`
    : `upgrade:${entry.upgradeKey}:cache:${entry.cacheKey ?? ""}`;
}

function visualRegistration(
  domain: IconDomain,
  request: IconVisualRequest,
): IconRegistration | null {
  const cacheKey = readIconKey(request.cacheKey);
  const upgradeKey = readUpgradeVisualKey(request.upgradeKey);
  if (upgradeKey !== null) {
    return { kind: "upgrade-visual", domain, cacheKey, upgradeKey };
  }
  if (cacheKey !== null) return { kind: "cache", domain, key: cacheKey };
  return null;
}

export class LocalIconRegistry {
  readonly #entries = new Map<string, IconRegistration>();

  replace(domain: IconDomain, keys: readonly (string | null)[]): Map<string, string> {
    const uniqueKeys = [...new Set(keys.filter((value): value is string => value !== null))];
    const tokens = this.replaceVisuals(
      domain,
      uniqueKeys.map((key) => ({ cacheKey: key, upgradeKey: null })),
    );
    return new Map(uniqueKeys.map((key, index) => [key, tokens[index]!]));
  }

  replaceVisuals(
    domain: IconDomain,
    requests: readonly IconVisualRequest[],
  ): readonly (string | null)[] {
    const registrations = requests.map((request) => visualRegistration(domain, request));
    const wanted = new Set(
      registrations.filter((entry): entry is IconRegistration => entry !== null).map(signature),
    );
    const existing = new Map<string, string>();
    for (const [token, entry] of this.#entries) {
      if (entry.domain !== domain) continue;
      const key = signature(entry);
      existing.set(key, token);
      if (!wanted.has(key)) this.#entries.delete(token);
    }

    return registrations.map((entry) => {
      if (entry === null) return null;
      const key = signature(entry);
      const current = existing.get(key);
      if (current !== undefined) return current;
      const token = randomUUID();
      this.#entries.set(token, entry);
      existing.set(key, token);
      return token;
    });
  }

  get(token: string): IconRegistration | undefined {
    return this.#entries.get(token);
  }
}

export const localIconRegistry = new LocalIconRegistry();
