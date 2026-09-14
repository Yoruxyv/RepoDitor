/** Decoded upgrade artwork cache, source watches and fail-soft persistent manifests.
 * Presentation artifacts never authorize save mutations. One shared instance serves
 * background preparation and lazy protocol requests; writes and decodes retain ordering.
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { PythonClient } from "../python/client.cjs";
import { MAX_ICON_BYTES, validPng } from "./png.cjs";

const MAX_SOURCE_WATCHES = 8;
const PRESENTATION_CACHE_FORMAT_VERSION = 2;
const MAX_PRESENTATION_CACHE_ENTRIES = 256;
const MAX_PRESENTATION_MANIFEST_BYTES = 512 * 1024;
const MAX_UPGRADE_KEY_BYTES = 512;
const PRESENTATION_MANIFEST_NAME = "manifest.json";
const PERSISTENT_ARTIFACT_PATTERN = /^[a-f0-9]{64}\.png$/;
const SOURCE_ID_PATTERN = /^[a-f0-9]{64}$/;
const DECIMAL_PATTERN = /^\d{1,24}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

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

const PRESENTATION_CACHE_REASON = {
  artifactInvalid: "artifact-invalid",
  artifactMissing: "artifact-missing",
  artifactReadFailed: "artifact-read-failed",
  entryMissing: "entry-missing",
  manifestInvalid: "manifest-invalid",
  manifestMissing: "manifest-missing",
  manifestUnreadable: "manifest-unreadable",
  memoryHit: "memory-hit",
  noPersistentRoot: "no-persistent-root",
  persisted: "persisted",
  persistentHit: "persistent-hit",
  persistFailed: "persist-failed",
  sourceChanged: "source-changed",
  sourceDecodeRequired: "source-decode-required",
  sourceMissing: "source-missing",
  sourceReadFailed: "source-read-failed",
} as const;

export type PresentationCacheDiagnosticReason =
  (typeof PRESENTATION_CACHE_REASON)[keyof typeof PRESENTATION_CACHE_REASON];

export interface PresentationCacheDiagnostic {
  readonly reason: PresentationCacheDiagnosticReason;
  readonly upgradeKey?: string;
}

export type PresentationCacheDiagnosticSink = (diagnostic: PresentationCacheDiagnostic) => void;

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

type SourceWatchStatus =
  | "unchanged"
  | typeof PRESENTATION_CACHE_REASON.sourceMissing
  | typeof PRESENTATION_CACHE_REASON.sourceChanged
  | typeof PRESENTATION_CACHE_REASON.sourceReadFailed;

async function sourceWatchStatus(watches: readonly SourceWatch[]): Promise<SourceWatchStatus> {
  try {
    for (const watch of watches) {
      const stat = await fs.lstat(watch.path, { bigint: true });
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size !== watch.size ||
        stat.mtimeNs !== watch.mtimeNs
      ) {
        return PRESENTATION_CACHE_REASON.sourceChanged;
      }
    }
    return "unchanged";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? PRESENTATION_CACHE_REASON.sourceMissing
      : PRESENTATION_CACHE_REASON.sourceReadFailed;
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

interface ParsedPersistentManifest {
  readonly entries: Map<string, PersistentTextureEntry>;
  readonly valid: boolean;
}

function parsePersistentManifest(value: unknown): ParsedPersistentManifest {
  const entries = new Map<string, PersistentTextureEntry>();
  if (!isRecord(value) || value.formatVersion !== PRESENTATION_CACHE_FORMAT_VERSION) {
    return { entries, valid: false };
  }
  if (!isRecord(value.entries)) return { entries, valid: false };
  const rawEntries = Object.entries(value.entries);
  if (rawEntries.length > MAX_PRESENTATION_CACHE_ENTRIES) return { entries, valid: false };
  let valid = true;
  for (const [upgradeKey, raw] of rawEntries) {
    if (!validUpgradeKey(upgradeKey) || !isRecord(raw)) {
      valid = false;
      continue;
    }
    if (typeof raw.sourceIdentity !== "string" || !SOURCE_ID_PATTERN.test(raw.sourceIdentity)) {
      valid = false;
      continue;
    }
    const watches = parseSourceWatches(raw.watches);
    if (watches === null) {
      valid = false;
      continue;
    }
    entries.set(upgradeKey, { sourceIdentity: raw.sourceIdentity, watches });
  }
  return { entries, valid };
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
  #diagnosticSink: PresentationCacheDiagnosticSink;
  #persistentRoot: string | null = null;
  #persistentLoad: Promise<void> | null = null;
  #persistentTail: Promise<void> = Promise.resolve();
  #decodeTail: Promise<void> = Promise.resolve();

  constructor(
    persistentRoot: string | null = null,
    diagnosticSink: PresentationCacheDiagnosticSink = () => undefined,
  ) {
    this.#diagnosticSink = diagnosticSink;
    if (persistentRoot !== null) this.configurePersistentRoot(persistentRoot);
  }

  #diagnose(reason: PresentationCacheDiagnosticReason, upgradeKey?: string): void {
    try {
      this.#diagnosticSink(upgradeKey === undefined ? { reason } : { reason, upgradeKey });
    } catch {
      // Diagnostics must never make optional presentation artwork unavailable.
    }
  }

  configurePersistentRoot(root: string): void {
    if (!path.isAbsolute(root)) throw new Error("Presentation cache root must be absolute.");
    const resolved = path.resolve(root);
    if (this.#persistentRoot !== null && this.#persistentRoot !== resolved) {
      throw new Error("Presentation cache root is already configured.");
    }
    this.#persistentRoot = resolved;
  }

  configureDiagnosticSink(sink: PresentationCacheDiagnosticSink): void {
    this.#diagnosticSink = sink;
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
    if (decoded === null) return false;
    const sourceStatus = await sourceWatchStatus(decoded.watches);
    if (sourceStatus !== "unchanged") {
      this.#diagnose(sourceStatus, upgradeKey);
      return false;
    }
    this.#diagnose(PRESENTATION_CACHE_REASON.sourceDecodeRequired, upgradeKey);
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
    const task = this.#decode(upgradeKey, client);
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
      if (cached !== undefined) {
        const sourceStatus = await sourceWatchStatus(cached.watches);
        if (sourceStatus === "unchanged") {
          this.#diagnose(PRESENTATION_CACHE_REASON.memoryHit, upgradeKey);
          return cached.png;
        }
        this.#diagnose(sourceStatus, upgradeKey);
      }
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

  async #decode(upgradeKey: string, client: PythonClient): Promise<Buffer | null> {
    this.#diagnose(PRESENTATION_CACHE_REASON.sourceDecodeRequired, upgradeKey);
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
    if (decoded === null) return null;
    const sourceStatus = await sourceWatchStatus(decoded.watches);
    if (sourceStatus !== "unchanged") {
      this.#diagnose(sourceStatus, upgradeKey);
      return null;
    }
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
        this.#diagnose(PRESENTATION_CACHE_REASON.manifestInvalid);
        return;
      }
      const raw = await fs.readFile(manifestPath, "utf8");
      const parsed = parsePersistentManifest(JSON.parse(raw));
      if (!parsed.valid) this.#diagnose(PRESENTATION_CACHE_REASON.manifestInvalid);
      for (const [upgradeKey, entry] of parsed.entries) {
        this.#persistentEntries.set(upgradeKey, entry);
      }
    } catch (error) {
      let reason: PresentationCacheDiagnosticReason = PRESENTATION_CACHE_REASON.manifestUnreadable;
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        reason = PRESENTATION_CACHE_REASON.manifestMissing;
      else if (error instanceof SyntaxError) reason = PRESENTATION_CACHE_REASON.manifestInvalid;
      this.#diagnose(reason);
      // Persistent presentation data is disposable. Any load failure falls back to source decode.
      return;
    }
    try {
      await this.#prunePersistentArtifacts();
    } catch {
      this.#diagnose(PRESENTATION_CACHE_REASON.artifactReadFailed);
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
    if (this.#persistentRoot === null) {
      this.#diagnose(PRESENTATION_CACHE_REASON.noPersistentRoot, upgradeKey);
      return null;
    }
    await this.#ensurePersistentLoaded();
    const entry = this.#persistentEntries.get(upgradeKey);
    if (entry === undefined) {
      this.#diagnose(PRESENTATION_CACHE_REASON.entryMissing, upgradeKey);
      return null;
    }
    const sourceStatus = await sourceWatchStatus(entry.watches);
    if (sourceStatus !== "unchanged") {
      this.#diagnose(sourceStatus, upgradeKey);
      await this.#dropPersistentEntry(upgradeKey);
      return null;
    }
    const artifactPath = path.join(this.#persistentRoot, `${entry.sourceIdentity}.png`);
    try {
      const stat = await fs.lstat(artifactPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ICON_BYTES) {
        this.#diagnose(PRESENTATION_CACHE_REASON.artifactInvalid, upgradeKey);
        await this.#dropPersistentEntry(upgradeKey);
        return null;
      }
      const png = await fs.readFile(artifactPath);
      if (png.length !== stat.size || !validPng(png)) {
        this.#diagnose(PRESENTATION_CACHE_REASON.artifactInvalid, upgradeKey);
        await this.#dropPersistentEntry(upgradeKey);
        return null;
      }
      const stored = this.#store(upgradeKey, {
        sourceIdentity: entry.sourceIdentity,
        png,
        watches: entry.watches,
      });
      this.#diagnose(PRESENTATION_CACHE_REASON.persistentHit, upgradeKey);
      return stored;
    } catch (error) {
      const reason =
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? PRESENTATION_CACHE_REASON.artifactMissing
          : PRESENTATION_CACHE_REASON.artifactReadFailed;
      this.#diagnose(reason, upgradeKey);
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
        this.#diagnose(PRESENTATION_CACHE_REASON.persisted, upgradeKey);
      } catch {
        this.#diagnose(PRESENTATION_CACHE_REASON.persistFailed, upgradeKey);
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
        this.#diagnose(PRESENTATION_CACHE_REASON.persistFailed, upgradeKey);
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
