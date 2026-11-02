/** Read-only local artwork protocol: opaque tokens, trusted roots and PNG bounds.
 * Missing or invalid optional artwork fails soft; decoded upgrade caching is owned
 * by upgradeTextureCache, independently of Electron protocol registration.
 */
import path from "node:path";
import { mapArtwork, type MapArtwork } from "./mapArtwork.cjs";
import { protocol } from "electron";

import { pythonClient, type PythonClient } from "../python/client.cjs";
import { localIconRegistry, type LocalIconRegistry, type IconRegistration } from "./registry.cjs";
import { readLocalPng } from "./localPng.cjs";
import { decodedUpgradeTextureCache, DecodedUpgradeTextureCache } from "./upgradeTextureCache.cjs";
import {
  decodedCosmeticArtworkCache,
  type DecodedCosmeticArtworkCache,
} from "./cosmeticArtworkCache.cjs";

import { installedBakedArtwork, type InstalledBakedArtwork } from "./bakedArtwork.cjs";

const ICON_SCHEME = "repoditor-icon";
const ITEM_VISUAL_KIND = "item-visual";
const UPGRADE_VISUAL_KIND = "upgrade-visual";

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

async function serveCacheIcon(
  entry: { readonly domain: "item" | "upgrade" | "cosmetic"; readonly key: string },
  roots: IconRoots | null,
): Promise<Response> {
  if (roots === null) return notFound();
  const png = await readLocalPng(roots[entry.domain], entry.key);
  return png === null ? notFound() : pngResponse(png);
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

async function serveVisual(
  entry: Exclude<IconRegistration, { readonly kind: "cache" | "map-visual" }>,
  roots: IconRoots | null,
  client: PythonClient,
  decodedCache: DecodedUpgradeTextureCache,
  cosmeticCache: DecodedCosmeticArtworkCache,
  baked: Pick<InstalledBakedArtwork, "get">,
): Promise<Response> {
  if (entry.kind !== UPGRADE_VISUAL_KIND) {
    const id = entry.kind === ITEM_VISUAL_KIND ? entry.itemName : String(entry.cosmeticId);
    const png = await baked.get(entry.domain, id, client);
    if (png !== null) return pngResponse(png);
  }
  if (entry.kind === UPGRADE_VISUAL_KIND && entry.cacheKey !== null) {
    const cached = await serveCacheIcon({ domain: entry.domain, key: entry.cacheKey }, roots);
    if (cached.status === 200) return cached;
  }
  if (entry.kind === ITEM_VISUAL_KIND) return notFound();
  const png =
    entry.kind === "cosmetic-visual"
      ? await cosmeticCache.get(entry.cosmeticId, client)
      : await decodedCache.get(entry.upgradeKey, client);
  return png === null ? notFound() : pngResponse(png);
}

export async function serveLocalIcon(
  request: Request,
  roots: IconRoots | null,
  registry: LocalIconRegistry = localIconRegistry,
  client: PythonClient = pythonClient,
  decodedCache: DecodedUpgradeTextureCache = new DecodedUpgradeTextureCache(),
  cosmeticCache: DecodedCosmeticArtworkCache = decodedCosmeticArtworkCache,
  baked: Pick<InstalledBakedArtwork, "get"> = installedBakedArtwork,
  maps: Pick<MapArtwork, "get"> = mapArtwork,
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
  if (
    url.protocol !== `${ICON_SCHEME}:` ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname !== "local" ||
    parts.length !== 1 ||
    url.search ||
    url.hash
  )
    return notFound();
  const entry = registry.get(parts[0]);
  if (entry === undefined) return notFound();
  if (entry.kind === "map-visual") {
    const png = await maps.get(entry.family, entry.sourceIdentity, client);
    return png === null ? notFound() : pngResponse(png);
  }
  if (entry.kind === "cache")
    return entry.domain === "upgrade" ? serveCacheIcon(entry, roots) : notFound();
  return serveVisual(entry, roots, client, decodedCache, cosmeticCache, baked);
}

export function registerLocalIconScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ICON_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

export function registerLocalIconProtocol(client: PythonClient = pythonClient): void {
  const roots = loadRoots(client);
  protocol.handle(ICON_SCHEME, async (request) =>
    serveLocalIcon(
      request,
      await roots,
      localIconRegistry,
      client,
      decodedUpgradeTextureCache,
      decodedCosmeticArtworkCache,
    ),
  );
}
