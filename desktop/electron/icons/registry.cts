/**
 * In-memory registry for opaque renderer-safe game icon tokens.
 *
 * Registrations bind domain identities to trusted local-cache keys or prepared
 * visuals. Local paths remain in Electron/Python and never cross into React.
 */
import { randomUUID } from "node:crypto";

export type IconDomain = "item" | "upgrade" | "cosmetic" | "map";

export interface CacheIconRegistration {
  readonly kind: "cache";
  readonly domain: Exclude<IconDomain, "map">;
  readonly key: string;
}

export interface UpgradeVisualRegistration {
  readonly kind: "upgrade-visual";
  readonly domain: Exclude<IconDomain, "map">;
  readonly cacheKey: string | null;
  readonly upgradeKey: string;
}

export interface CosmeticVisualRegistration {
  readonly kind: "cosmetic-visual";
  readonly domain: "cosmetic";
  readonly cosmeticId: number;
  readonly cacheKey: string | null;
}

export interface ItemVisualRegistration {
  readonly kind: "item-visual";
  readonly domain: "item";
  readonly itemName: string;
  readonly cacheKey: string | null;
}

export interface MapVisualRegistration {
  readonly kind: "map-visual";
  readonly domain: "map";
  readonly family: string;
  readonly sourceIdentity: string;
}

export type IconRegistration =
  | CacheIconRegistration
  | UpgradeVisualRegistration
  | CosmeticVisualRegistration
  | ItemVisualRegistration
  | MapVisualRegistration;

export interface IconVisualRequest {
  readonly cacheKey: string | null;
  readonly upgradeKey: string | null;
  readonly cosmeticId?: number | null;
  readonly itemName?: string | null;
  readonly mapFamily?: string;
  readonly sourceIdentity?: string;
}

const MAP_VISUAL_KIND = "map-visual";
const ITEM_VISUAL_KIND = "item-visual";
const COSMETIC_VISUAL_KIND = "cosmetic-visual";

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
  if (entry.kind === MAP_VISUAL_KIND) return `map:${entry.family}:${entry.sourceIdentity}`;
  if (entry.kind === "cache") return `cache:${entry.key}`;
  if (entry.kind === ITEM_VISUAL_KIND)
    return `item:${entry.itemName}:cache:${entry.cacheKey ?? ""}`;
  if (entry.kind === COSMETIC_VISUAL_KIND) {
    return `cosmetic:${entry.cosmeticId}:cache:${entry.cacheKey ?? ""}`;
  }
  return `upgrade:${entry.upgradeKey}:cache:${entry.cacheKey ?? ""}`;
}

function visualRegistration(
  domain: IconDomain,
  request: IconVisualRequest,
): IconRegistration | null {
  if (domain === "map") {
    if (
      !validMapFamily(request.mapFamily) ||
      typeof request.sourceIdentity !== "string" ||
      !/^[a-f0-9]{64}$/.test(request.sourceIdentity) ||
      request.cacheKey !== null ||
      request.upgradeKey !== null ||
      request.itemName != null ||
      request.cosmeticId != null
    ) {
      throw new Error("Invalid map artwork identity.");
    }
    return {
      kind: MAP_VISUAL_KIND,
      domain,
      family: request.mapFamily,
      sourceIdentity: request.sourceIdentity,
    };
  }
  if (request.mapFamily !== undefined || request.sourceIdentity !== undefined)
    throw new Error("Invalid artwork namespace.");
  const cacheKey = readIconKey(request.cacheKey);
  if (request.itemName !== undefined && request.itemName !== null) {
    if (
      domain !== "item" ||
      !request.itemName.startsWith("Item ") ||
      request.itemName.length > 191 ||
      /[/\\\0]/.test(request.itemName)
    ) {
      throw new Error("Invalid item artwork identity.");
    }
    return { kind: ITEM_VISUAL_KIND, domain, itemName: request.itemName, cacheKey };
  }
  if (request.cosmeticId !== undefined && request.cosmeticId !== null) {
    if (
      domain !== "cosmetic" ||
      !Number.isSafeInteger(request.cosmeticId) ||
      request.cosmeticId < 0 ||
      request.cosmeticId >= 2000
    ) {
      throw new Error("Invalid cosmetic visual ID.");
    }
    return { kind: COSMETIC_VISUAL_KIND, domain, cosmeticId: request.cosmeticId, cacheKey };
  }
  const upgradeKey = readUpgradeVisualKey(request.upgradeKey);
  if (upgradeKey !== null) {
    return { kind: "upgrade-visual", domain, cacheKey, upgradeKey };
  }
  if (cacheKey !== null) return { kind: "cache", domain, key: cacheKey };
  return null;
}

export function validMapFamily(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    !/[/\\]/.test(value) &&
    !Array.from(value).some((char) => char.charCodeAt(0) < 32)
  );
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
