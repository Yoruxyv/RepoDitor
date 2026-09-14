/** Read-only local artwork protocol: opaque tokens, trusted roots and PNG bounds.
 * Missing or invalid optional artwork fails soft; decoded upgrade caching is owned
 * by upgradeTextureCache, independently of Electron protocol registration.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { protocol } from "electron";

import { pythonClient, type PythonClient } from "../python/client.cjs";
import { localIconRegistry, type LocalIconRegistry } from "./registry.cjs";
import { MAX_ICON_BYTES, validPng } from "./png.cjs";
import { decodedUpgradeTextureCache, DecodedUpgradeTextureCache } from "./upgradeTextureCache.cjs";

const ICON_SCHEME = "repoditor-icon";

interface IconRoots {
  readonly item: string;
  readonly upgrade: string;
  readonly cosmetic: string;
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}

function readRoots(value: unknown): IconRoots | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const response = value as Record<string, unknown>;
  if (response.ok !== true || response.roots === null) {
    return null;
  }
  if (typeof response.roots !== "object" || Array.isArray(response.roots)) {
    return null;
  }
  const roots = response.roots as Record<string, unknown>;
  return typeof roots.item === "string" &&
    path.isAbsolute(roots.item) &&
    typeof roots.cosmetic === "string" &&
    path.isAbsolute(roots.cosmetic)
    ? { item: roots.item, upgrade: roots.item, cosmetic: roots.cosmetic }
    : null;
}

async function loadRoots(client: PythonClient): Promise<IconRoots | null> {
  try {
    return readRoots(await client.run("icons-roots"));
  } catch {
    return null;
  }
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

async function serveCacheIcon(
  entry: { readonly domain: "item" | "upgrade" | "cosmetic"; readonly key: string },
  roots: IconRoots | null,
): Promise<Response> {
  if (roots === null || path.extname(entry.key) !== ".png") return notFound();
  const root = roots[entry.domain];
  const candidate = path.join(root, entry.key);
  try {
    const rootReal = await fs.realpath(root);
    const initial = await fs.lstat(candidate);
    if (!initial.isFile() || initial.isSymbolicLink() || initial.size > MAX_ICON_BYTES) {
      return notFound();
    }
    const candidateReal = await fs.realpath(candidate);
    if (!inside(rootReal, candidateReal)) return notFound();
    const handle = await fs.open(candidateReal, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_ICON_BYTES) return notFound();
      const data = await handle.readFile();
      if (data.length !== stat.size || !validPng(data)) return notFound();
      return pngResponse(data);
    } finally {
      await handle.close();
    }
  } catch {
    return notFound();
  }
}

function pngResponse(data: Buffer): Response {
  return new Response(Uint8Array.from(data), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function serveLocalIcon(
  request: Request,
  roots: IconRoots | null,
  registry: LocalIconRegistry = localIconRegistry,
  client: PythonClient = pythonClient,
  decodedCache: DecodedUpgradeTextureCache = new DecodedUpgradeTextureCache(),
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { Allow: "GET" } });
  }
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return notFound();
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname !== "local" || parts.length !== 1 || url.search || url.hash) return notFound();
  const entry = registry.get(parts[0]);
  if (entry === undefined) return notFound();
  if (entry.kind === "cache") return serveCacheIcon(entry, roots);
  if (entry.cacheKey !== null) {
    const cached = await serveCacheIcon({ domain: entry.domain, key: entry.cacheKey }, roots);
    if (cached.status === 200) return cached;
  }
  const png = await decodedCache.get(entry.upgradeKey, client);
  return png === null ? notFound() : pngResponse(png);
}

export function registerLocalIconScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ICON_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

export function registerLocalIconProtocol(client: PythonClient = pythonClient): void {
  const roots = loadRoots(client);
  protocol.handle(ICON_SCHEME, async (request) =>
    serveLocalIcon(request, await roots, localIconRegistry, client, decodedUpgradeTextureCache),
  );
}
