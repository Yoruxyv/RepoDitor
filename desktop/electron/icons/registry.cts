import { randomUUID } from "node:crypto";

export type IconDomain = "item" | "cosmetic";

interface IconRegistration {
  readonly domain: IconDomain;
  readonly key: string;
}

const SAFE_KEY_PATTERN = /^[^/\\\0]{1,256}\.png$/;

export function readIconKey(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== "string"
    || !SAFE_KEY_PATTERN.test(value)
    || value !== value.toLowerCase()
    || value === ".png"
    || value === "..png"
  ) {
    throw new Error("Invalid local icon key.");
  }
  return value;
}

export class LocalIconRegistry {
  readonly #entries = new Map<string, IconRegistration>();

  replace(domain: IconDomain, keys: readonly (string | null)[]): Map<string, string> {
    for (const [token, entry] of this.#entries) {
      if (entry.domain === domain) {
        this.#entries.delete(token);
      }
    }
    const tokens = new Map<string, string>();
    for (const key of new Set(keys.filter((value): value is string => value !== null))) {
      readIconKey(key);
      const token = randomUUID();
      this.#entries.set(token, { domain, key });
      tokens.set(key, token);
    }
    return tokens;
  }

  get(token: string): IconRegistration | undefined {
    return this.#entries.get(token);
  }
}

export const localIconRegistry = new LocalIconRegistry();
