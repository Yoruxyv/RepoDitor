/**
 * Custom protocol and persistent cache for local presentation artwork.
 *
 * Resolves opaque tokens, enforces trusted-root containment and PNG bounds, and
 * fails soft when optional artwork is unavailable. Derived files are presentation
 * artifacts only; source watches invalidate them and they grant no mutation authority.
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { protocol } from "electron";

import { pythonClient, type PythonClient } from "../python/client.cjs";
import { localIconRegistry, type LocalIconRegistry } from "./registry.cjs";

const ICON_SCHEME = "repoditor-icon";
const MAX_ICON_BYTES = 2 * 1024 * 1024;
const MAX_ICON_DIMENSION = 2048;
const MAX_SOURCE_WATCHES = 8;
const PRESENTATION_CACHE_FORMAT_VERSION = 1;
const MAX_PRESENTATION_CACHE_ENTRIES = 256;
const MAX_PRESENTATION_MANIFEST_BYTES = 512 * 1024;
const MAX_UPGRADE_KEY_BYTES = 512;
const PRESENTATION_MANIFEST_NAME = "manifest.json";
const PERSISTENT_ARTIFACT_PATTERN = /^[a-f0-9]{64}\.png$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SOURCE_ID_PATTERN = /^[a-f0-9]{64}$/;
const DECIMAL_PATTERN = /^\d{1,24}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

interface IconRoots {
  readonly item: string;
  readonly upgrade: string;
  readonly cosmetic: string;
}

interface SourceWatch {
  readonly path: string;
  readonly size: bigint;
  readonly mtimeNs: bigint;
}

interface DecodedTexture {
  readonly sourceIdentity: string;
  readonly png: Buffer;
  readonly watches: readonly SourceWatch[];
}

interface PersistentTextureEntry {
  readonly sourceIdentity: string;
  readonly watches: readonly SourceWatch[];
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

function validPng(data: Buffer): boolean {
  return (
    data.length >= 24 &&
    data.length <= MAX_ICON_BYTES &&
    data.subarray(0, 8).equals(PNG_SIGNATURE) &&
    data.readUInt32BE(8) === 13 &&
    data.subarray(12, 16).toString("ascii") === "IHDR" &&
    data.readUInt32BE(16) > 0 &&
    data.readUInt32BE(16) <= MAX_ICON_DIMENSION &&
    data.readUInt32BE(20) > 0 &&
    data.readUInt32BE(20) <= MAX_ICON_DIMENSION
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDecimalBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function parseSourceWatches(value: unknown): readonly SourceWatch[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SOURCE_WATCHES) return null;
  const watches: SourceWatch[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.path !== "string" || !path.isAbsolute(raw.path)) return null;
    const size = readDecimalBigInt(raw.size);
    const mtimeNs = readDecimalBigInt(raw.mtimeNs);
    if (size === null || mtimeNs === null || size < 0n || mtimeNs < 0n) return null;
    watches.push({ path: raw.path, size, mtimeNs });
  }
  return watches;
}

function parseDecodedTexturePayload(value: unknown): DecodedTexture | null {
  if (!isRecord(value)) return null;
  const texture = value;
  if (
    typeof texture.sourceIdentity !== "string" ||
    !SOURCE_ID_PATTERN.test(texture.sourceIdentity) ||
    typeof texture.pngBase64 !== "string" ||
    texture.pngBase64.length === 0 ||
    texture.pngBase64.length > Math.ceil(MAX_ICON_BYTES / 3) * 4 ||
    !BASE64_PATTERN.test(texture.pngBase64)
  ) {
    return null;
  }
  const watches = parseSourceWatches(texture.watches);
  if (watches === null) return null;
  const png = Buffer.from(texture.pngBase64, "base64");
  if (!validPng(png) || png.toString("base64") !== texture.pngBase64) return null;
  if (
    typeof texture.width !== "number" ||
    !Number.isInteger(texture.width) ||
    typeof texture.height !== "number" ||
    !Number.isInteger(texture.height) ||
    texture.width !== png.readUInt32BE(16) ||
    texture.height !== png.readUInt32BE(20)
  ) {
    return null;
  }
  return { sourceIdentity: texture.sourceIdentity, png, watches };
}

function parseDecodedTexture(value: unknown): DecodedTexture | null {
  if (!isRecord(value) || value.ok !== true || value.texture === null) return null;
  return parseDecodedTexturePayload(value.texture);
}

async function sourcesUnchanged(watches: readonly SourceWatch[]): Promise<boolean> {
  try {
    for (const watch of watches) {
      const stat = await fs.lstat(watch.path, { bigint: true });
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size !== watch.size ||
        stat.mtimeNs !== watch.mtimeNs
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function validUpgradeKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= MAX_UPGRADE_KEY_BYTES &&
    !value.includes("\0")
  );
}

function serializeWatches(watches: readonly SourceWatch[]): readonly Record<string, string>[] {
  return watches.map((watch) => ({
    path: watch.path,
    size: watch.size.toString(),
    mtimeNs: watch.mtimeNs.toString(),
  }));
}

async function replaceCacheFile(root: string, name: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const target = path.join(root, name);
  const temporary = path.join(root, `.${name}.${randomUUID()}.tmp`);
  let temporaryExists = false;
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    temporaryExists = true;
    try {
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(temporary, target);
    } catch {
      await fs.rm(target, { force: true });
      await fs.rename(temporary, target);
    }
    temporaryExists = false;
  } finally {
    if (temporaryExists) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

function parsePersistentManifest(value: unknown): Map<string, PersistentTextureEntry> {
  const entries = new Map<string, PersistentTextureEntry>();
  if (!isRecord(value) || value.formatVersion !== PRESENTATION_CACHE_FORMAT_VERSION) return entries;
  if (!isRecord(value.entries)) return entries;
  const rawEntries = Object.entries(value.entries);
  if (rawEntries.length > MAX_PRESENTATION_CACHE_ENTRIES) return entries;
  for (const [upgradeKey, raw] of rawEntries) {
    if (!validUpgradeKey(upgradeKey) || !isRecord(raw)) continue;
    if (typeof raw.sourceIdentity !== "string" || !SOURCE_ID_PATTERN.test(raw.sourceIdentity)) {
      continue;
    }
    const watches = parseSourceWatches(raw.watches);
    if (watches === null) continue;
    entries.set(upgradeKey, { sourceIdentity: raw.sourceIdentity, watches });
  }
  return entries;
}

interface PreparationWaiter {
  readonly promise: Promise<Buffer | null>;
  readonly resolve: (value: Buffer | null) => void;
}

export class DecodedUpgradeTextureCache {
  readonly #bySource = new Map<string, DecodedTexture>();
  readonly #sourceByUpgrade = new Map<string, string>();
  readonly #inFlight = new Map<string, Promise<Buffer | null>>();
  readonly #preparing = new Map<string, PreparationWaiter>();
  readonly #persistentEntries = new Map<string, PersistentTextureEntry>();
  #persistentRoot: string | null = null;
  #persistentLoad: Promise<void> | null = null;
  #persistentTail: Promise<void> = Promise.resolve();
  #decodeTail: Promise<void> = Promise.resolve();

  constructor(persistentRoot: string | null = null) {
    if (persistentRoot !== null) this.configurePersistentRoot(persistentRoot);
  }

  configurePersistentRoot(root: string): void {
    if (!path.isAbsolute(root)) throw new Error("Presentation cache root must be absolute.");
    const resolved = path.resolve(root);
    if (this.#persistentRoot !== null && this.#persistentRoot !== resolved) {
      throw new Error("Presentation cache root is already configured.");
    }
    this.#persistentRoot = resolved;
  }

  beginPreparation(upgradeKeys: readonly string[]): void {
    for (const upgradeKey of new Set(upgradeKeys)) {
      if (this.#preparing.has(upgradeKey)) continue;
      let resolve!: (value: Buffer | null) => void;
      const promise = new Promise<Buffer | null>((next) => {
        resolve = next;
      });
      this.#preparing.set(upgradeKey, { promise, resolve });
    }
  }

  finishPreparation(upgradeKey: string): void {
    this.#resolvePreparation(upgradeKey, null);
  }

  async hasPrepared(upgradeKey: string): Promise<boolean> {
    return (await this.#cached(upgradeKey)) !== null;
  }

  async storePrepared(upgradeKey: string, value: unknown): Promise<boolean> {
    const decoded = parseDecodedTexturePayload(value);
    if (decoded === null || !(await sourcesUnchanged(decoded.watches))) return false;
    const png = this.#store(upgradeKey, decoded);
    await this.#persistFailSoft(upgradeKey, decoded);
    this.#resolvePreparation(upgradeKey, png);
    return true;
  }

  async get(upgradeKey: string, client: PythonClient): Promise<Buffer | null> {
    const existing = this.#inFlight.get(upgradeKey);
    if (existing !== undefined) return existing;
    const cached = await this.#cached(upgradeKey);
    if (cached !== null) return cached;
    const pending = this.#inFlight.get(upgradeKey) ?? this.#preparing.get(upgradeKey)?.promise;
    if (pending !== undefined) return pending;
    const task = this.#load(upgradeKey, client);
    this.#inFlight.set(upgradeKey, task);
    try {
      return await task;
    } finally {
      this.#inFlight.delete(upgradeKey);
    }
  }

  async #cached(upgradeKey: string): Promise<Buffer | null> {
    const knownSource = this.#sourceByUpgrade.get(upgradeKey);
    if (knownSource !== undefined) {
      const cached = this.#bySource.get(knownSource);
      if (cached !== undefined && (await sourcesUnchanged(cached.watches))) return cached.png;
      this.#sourceByUpgrade.delete(upgradeKey);
      if (cached !== undefined) this.#bySource.delete(knownSource);
    }
    return this.#loadPersistent(upgradeKey);
  }

  #store(upgradeKey: string, decoded: DecodedTexture): Buffer {
    const existing = this.#bySource.get(decoded.sourceIdentity);
    const stored = existing ?? decoded;
    this.#bySource.set(decoded.sourceIdentity, stored);
    this.#sourceByUpgrade.set(upgradeKey, decoded.sourceIdentity);
    return stored.png;
  }

  #resolvePreparation(upgradeKey: string, value: Buffer | null): void {
    const waiter = this.#preparing.get(upgradeKey);
    if (waiter === undefined) return;
    this.#preparing.delete(upgradeKey);
    waiter.resolve(value);
  }

  async #load(upgradeKey: string, client: PythonClient): Promise<Buffer | null> {
    const cached = await this.#cached(upgradeKey);
    if (cached !== null) return cached;

    let decoded: DecodedTexture | null;
    try {
      const run = this.#decodeTail.then(() => client.run("upgrade-texture", [upgradeKey]));
      this.#decodeTail = run.then(
        () => undefined,
        () => undefined,
      );
      decoded = parseDecodedTexture(await run);
    } catch {
      return null;
    }
    if (decoded === null || !(await sourcesUnchanged(decoded.watches))) return null;
    const png = this.#store(upgradeKey, decoded);
    await this.#persistFailSoft(upgradeKey, decoded);
    return png;
  }

  async #ensurePersistentLoaded(): Promise<void> {
    if (this.#persistentRoot === null) return;
    if (this.#persistentLoad === null) this.#persistentLoad = this.#loadPersistentManifest();
    await this.#persistentLoad;
  }

  async #loadPersistentManifest(): Promise<void> {
    const root = this.#persistentRoot;
    if (root === null) return;
    const manifestPath = path.join(root, PRESENTATION_MANIFEST_NAME);
    try {
      const stat = await fs.lstat(manifestPath);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size <= 0 ||
        stat.size > MAX_PRESENTATION_MANIFEST_BYTES
      ) {
        return;
      }
      const raw = await fs.readFile(manifestPath, "utf8");
      const parsed = parsePersistentManifest(JSON.parse(raw));
      for (const [upgradeKey, entry] of parsed) this.#persistentEntries.set(upgradeKey, entry);
      await this.#prunePersistentArtifacts();
    } catch {
      // Persistent presentation data is disposable. Any load failure falls back to source decode.
    }
  }

  async #prunePersistentArtifacts(): Promise<void> {
    const root = this.#persistentRoot;
    if (root === null) return;
    const referenced = new Set(
      [...this.#persistentEntries.values()].map((entry) => `${entry.sourceIdentity}.png`),
    );
    const entries = await fs.readdir(root, { withFileTypes: true });
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            PERSISTENT_ARTIFACT_PATTERN.test(entry.name) &&
            !referenced.has(entry.name),
        )
        .map((entry) => fs.rm(path.join(root, entry.name), { force: true })),
    );
  }

  async #loadPersistent(upgradeKey: string): Promise<Buffer | null> {
    if (this.#persistentRoot === null) return null;
    await this.#ensurePersistentLoaded();
    const entry = this.#persistentEntries.get(upgradeKey);
    if (entry === undefined) return null;
    if (!(await sourcesUnchanged(entry.watches))) {
      await this.#dropPersistentEntry(upgradeKey);
      return null;
    }
    const artifactPath = path.join(this.#persistentRoot, `${entry.sourceIdentity}.png`);
    try {
      const stat = await fs.lstat(artifactPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ICON_BYTES) {
        await this.#dropPersistentEntry(upgradeKey);
        return null;
      }
      const png = await fs.readFile(artifactPath);
      if (png.length !== stat.size || !validPng(png)) {
        await this.#dropPersistentEntry(upgradeKey);
        return null;
      }
      return this.#store(upgradeKey, {
        sourceIdentity: entry.sourceIdentity,
        png,
        watches: entry.watches,
      });
    } catch {
      await this.#dropPersistentEntry(upgradeKey);
      return null;
    }
  }

  async #persistFailSoft(upgradeKey: string, decoded: DecodedTexture): Promise<void> {
    const root = this.#persistentRoot;
    if (root === null) return;
    const task = this.#persistentTail.then(async () => {
      try {
        await this.#ensurePersistentLoaded();
        await replaceCacheFile(root, `${decoded.sourceIdentity}.png`, decoded.png);
        this.#persistentEntries.set(upgradeKey, {
          sourceIdentity: decoded.sourceIdentity,
          watches: decoded.watches,
        });
        await this.#writePersistentManifest();
      } catch {
        // Disk/cache failures never turn presentation state into save-editing authority.
      }
    });
    this.#persistentTail = task.then(
      () => undefined,
      () => undefined,
    );
    await task;
  }

  async #dropPersistentEntry(upgradeKey: string): Promise<void> {
    if (this.#persistentRoot === null) return;
    const task = this.#persistentTail.then(async () => {
      this.#persistentEntries.delete(upgradeKey);
      try {
        await this.#writePersistentManifest();
      } catch {
        // A stale manifest is harmless: source watches are revalidated on every persistent hit.
      }
    });
    this.#persistentTail = task.then(
      () => undefined,
      () => undefined,
    );
    await task;
  }

  async #writePersistentManifest(): Promise<void> {
    const root = this.#persistentRoot;
    if (root === null) return;
    await fs.mkdir(root, { recursive: true });
    const entries: Record<string, object> = {};
    for (const [upgradeKey, entry] of this.#persistentEntries) {
      entries[upgradeKey] = {
        sourceIdentity: entry.sourceIdentity,
        watches: serializeWatches(entry.watches),
      };
    }
    const manifest = JSON.stringify(
      { formatVersion: PRESENTATION_CACHE_FORMAT_VERSION, entries },
      null,
      2,
    );
    if (Buffer.byteLength(manifest, "utf8") > MAX_PRESENTATION_MANIFEST_BYTES) {
      throw new Error("Presentation cache manifest exceeds its supported bound.");
    }
    await replaceCacheFile(root, PRESENTATION_MANIFEST_NAME, `${manifest}\n`);
    await this.#prunePersistentArtifacts();
  }
}

export const decodedUpgradeTextureCache = new DecodedUpgradeTextureCache();

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
  const entry = registry.get(parts[0]!);
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
