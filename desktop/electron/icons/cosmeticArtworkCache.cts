/** Read-only, source-validated persistent cache for locally decoded cosmetic Sprites.
 * Cosmetic IDs are presentation keys only. Cache contents never authorize save writes.
 */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { PythonClient, PythonRecordClient } from "../python/client.cjs";
import { MAX_ICON_BYTES, validPng } from "./png.cjs";

const FORMAT_VERSION = 1;
const MAX_ENTRIES = 2_000;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_WATCHES = 8;
const HEX = /^[a-f0-9]{64}$/;
const DECIMAL = /^\d{1,24}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PNG_PATTERN = /^[a-f0-9]{64}\.png$/;

interface SourceWatch {
  readonly path: string;
  readonly size: bigint;
  readonly mtimeNs: bigint;
}
interface Entry {
  readonly sourceIdentity: string;
  readonly pngHash: string;
  readonly watches: readonly SourceWatch[];
}
interface Decoded {
  readonly entry: Entry;
  readonly png: Buffer;
}

export type CosmeticArtworkPreparationPhase =
  "idle" | "checking" | "preparing" | "ready" | "degraded";
export interface CosmeticArtworkPreparationState {
  readonly phase: CosmeticArtworkPreparationPhase;
  readonly completed: number;
  readonly total: number;
  readonly cached: number;
  readonly failed: number;
}

const INITIAL_PROGRESS: CosmeticArtworkPreparationState = {
  phase: "idle",
  completed: 0,
  total: 0,
  cached: 0,
  failed: 0,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWatches(value: unknown): readonly SourceWatch[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_WATCHES) return null;
  const result: SourceWatch[] = [];
  for (const watch of value) {
    if (
      !isObject(watch) ||
      typeof watch.path !== "string" ||
      !path.isAbsolute(watch.path) ||
      typeof watch.size !== "string" ||
      !DECIMAL.test(watch.size) ||
      typeof watch.mtimeNs !== "string" ||
      !DECIMAL.test(watch.mtimeNs)
    )
      return null;
    result.push({ path: watch.path, size: BigInt(watch.size), mtimeNs: BigInt(watch.mtimeNs) });
  }
  return result;
}

function sourceValid(watches: readonly SourceWatch[]): Promise<boolean> {
  return Promise.all(
    watches.map(async (watch) => {
      try {
        const stat = await fs.lstat(watch.path, { bigint: true });
        return (
          stat.isFile() &&
          !stat.isSymbolicLink() &&
          stat.size === watch.size &&
          stat.mtimeNs === watch.mtimeNs
        );
      } catch {
        return false;
      }
    }),
  ).then((states) => states.every(Boolean));
}

function sha(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function parseDecoded(response: unknown, id: number): Decoded | null {
  if (!isObject(response) || response.ok !== true || !isObject(response.artwork)) return null;
  const value = response.artwork;
  if (
    value.cosmeticId !== id ||
    typeof value.sourceIdentity !== "string" ||
    !HEX.test(value.sourceIdentity) ||
    typeof value.pngBase64 !== "string" ||
    value.pngBase64.length === 0 ||
    value.pngBase64.length > Math.ceil(MAX_ICON_BYTES / 3) * 4 ||
    !BASE64.test(value.pngBase64) ||
    typeof value.width !== "number" ||
    typeof value.height !== "number"
  )
    return null;
  const watches = parseWatches(value.watches);
  if (watches === null) return null;
  const png = Buffer.from(value.pngBase64, "base64");
  if (
    !validPng(png) ||
    png.toString("base64") !== value.pngBase64 ||
    png.readUInt32BE(16) !== value.width ||
    png.readUInt32BE(20) !== value.height
  )
    return null;
  return { png, entry: { sourceIdentity: value.sourceIdentity, pngHash: sha(png), watches } };
}

function fileName(id: number, entry: Entry): string {
  return sha(Buffer.from(`cosmetic:${id}:${entry.sourceIdentity}`, "utf8")) + ".png";
}

function serializableEntry(entry: Entry): Record<string, unknown> {
  return {
    sourceIdentity: entry.sourceIdentity,
    pngHash: entry.pngHash,
    watches: entry.watches.map((watch) => ({
      path: watch.path,
      size: String(watch.size),
      mtimeNs: String(watch.mtimeNs),
    })),
  };
}

function parseEntry(value: unknown): Entry | null {
  if (
    !isObject(value) ||
    typeof value.sourceIdentity !== "string" ||
    !HEX.test(value.sourceIdentity) ||
    typeof value.pngHash !== "string" ||
    !HEX.test(value.pngHash)
  )
    return null;
  const watches = parseWatches(value.watches);
  return watches === null
    ? null
    : { sourceIdentity: value.sourceIdentity, pngHash: value.pngHash, watches };
}

async function atomicFile(target: string, contents: Buffer | string): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export class DecodedCosmeticArtworkCache {
  #root: string | null = null;
  readonly #memory = new Map<number, Decoded>();
  readonly #entries = new Map<number, Entry>();
  readonly #inFlight = new Map<number, Promise<Buffer | null>>();
  #loaded: Promise<void> | null = null;
  #decodeTail: Promise<void> = Promise.resolve();
  #persistTail: Promise<void> = Promise.resolve();
  #prefetchTask: Promise<void> | null = null;
  readonly #prefetchAttempted = new Set<number>();
  readonly #progressListeners = new Set<(state: CosmeticArtworkPreparationState) => void>();
  #progress: CosmeticArtworkPreparationState = INITIAL_PROGRESS;

  getPreparationState(): CosmeticArtworkPreparationState {
    return { ...this.#progress };
  }

  subscribePreparation(listener: (state: CosmeticArtworkPreparationState) => void): () => void {
    this.#progressListeners.add(listener);
    return () => this.#progressListeners.delete(listener);
  }

  #publishProgress(state: CosmeticArtworkPreparationState): void {
    this.#progress = state;
    for (const listener of this.#progressListeners) {
      try {
        listener(this.getPreparationState());
      } catch {
        /* Optional UI listeners fail soft. */
      }
    }
  }

  configurePersistentRoot(root: string): void {
    if (this.#root !== null || !path.isAbsolute(root))
      throw new Error("Invalid cosmetic cache root.");
    this.#root = root;
  }

  async #load(): Promise<void> {
    const root = this.#root;
    if (root === null) return;
    if (this.#loaded === null)
      this.#loaded = (async () => {
        try {
          const candidate = path.join(root, "manifest.json");
          const stat = await fs.lstat(candidate);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) return;
          const parsed: unknown = JSON.parse(await fs.readFile(candidate, "utf8"));
          if (
            !isObject(parsed) ||
            parsed.formatVersion !== FORMAT_VERSION ||
            !isObject(parsed.entries)
          )
            return;
          if (Object.keys(parsed.entries).length > MAX_ENTRIES) return;
          for (const [key, value] of Object.entries(parsed.entries)) {
            if (!/^(?:0|[1-9]\d{0,3})$/.test(key) || Number(key) >= MAX_ENTRIES) continue;
            const entry = parseEntry(value);
            if (entry !== null) this.#entries.set(Number(key), entry);
          }
        } catch {
          /* Cache is disposable. */
        }
      })();
    await this.#loaded;
  }

  async #fromMemory(id: number): Promise<Buffer | null> {
    const value = this.#memory.get(id);
    if (value === undefined) return null;
    if (!(await sourceValid(value.entry.watches))) {
      this.#memory.delete(id);
      this.#entries.delete(id);
      return null;
    }
    return value.png;
  }

  async #fromDisk(id: number): Promise<Buffer | null> {
    if (this.#root === null) return null;
    const entry = this.#entries.get(id);
    if (entry === undefined || !(await sourceValid(entry.watches))) {
      this.#entries.delete(id);
      return null;
    }
    const name = fileName(id, entry);
    if (!PNG_PATTERN.test(name)) return null;
    const candidate = path.join(this.#root, name);
    try {
      const stat = await fs.lstat(candidate);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ICON_BYTES) return null;
      const png = await fs.readFile(candidate);
      if (!validPng(png) || sha(png) !== entry.pngHash || !(await sourceValid(entry.watches)))
        return null;
      this.#remember(id, { entry, png });
      return png;
    } catch {
      return null;
    }
  }

  #remember(id: number, value: Decoded): void {
    this.#memory.delete(id);
    this.#memory.set(id, value);
    if (this.#memory.size > 96) this.#memory.delete(this.#memory.keys().next().value!);
  }

  async #persist(id: number, value: Decoded): Promise<void> {
    const root = this.#root;
    if (root === null) return;
    const task = this.#persistTail.then(async () => {
      try {
        await fs.mkdir(root, { recursive: true });
        await atomicFile(path.join(root, fileName(id, value.entry)), value.png);
        this.#entries.set(id, value.entry);
        const entries: Record<string, unknown> = {};
        for (const [key, entry] of this.#entries) entries[String(key)] = serializableEntry(entry);
        await atomicFile(
          path.join(root, "manifest.json"),
          JSON.stringify({ formatVersion: FORMAT_VERSION, entries }),
        );
      } catch {
        /* Cache write errors must not block artwork. */
      }
    });
    this.#persistTail = task.then(
      () => undefined,
      () => undefined,
    );
    await task;
  }

  async #decode(id: number, client: PythonClient): Promise<Buffer | null> {
    try {
      // Decode is serialized to prevent concurrent heavy scans of installed game assets.
      const response = await client.run("cosmetic-artwork", [String(id)]);
      const value = parseDecoded(response, id);
      if (value === null || !(await sourceValid(value.entry.watches))) return null;
      this.#remember(id, value);
      await this.#persist(id, value);
      return value.png;
    } catch {
      return null;
    }
  }

  /** Batch persistence writes the PNGs separately, then one atomic manifest. */
  async #persistPrepared(id: number, value: Decoded): Promise<void> {
    if (this.#root === null) return;
    try {
      await fs.mkdir(this.#root, { recursive: true });
      await atomicFile(path.join(this.#root, fileName(id, value.entry)), value.png);
      this.#entries.set(id, value.entry);
    } catch {
      /* Source artwork is optional. */
    }
  }

  async #flushPreparedManifest(): Promise<void> {
    if (this.#root === null) return;
    try {
      const entries: Record<string, unknown> = {};
      for (const [key, entry] of this.#entries) entries[String(key)] = serializableEntry(entry);
      await atomicFile(
        path.join(this.#root, "manifest.json"),
        JSON.stringify({
          formatVersion: FORMAT_VERSION,
          entries,
        }),
      );
    } catch {
      /* Cache writes must not block presentation. */
    }
  }

  /** Prepare missing cosmetics in one Python invocation, never one full scan per icon. */
  prefetch(ids: readonly number[], client: PythonClient): void {
    if (
      this.#prefetchTask !== null ||
      !("runRecords" in client) ||
      typeof client.runRecords !== "function"
    )
      return;
    const records = client as PythonRecordClient;
    const total = [...new Set(ids)].filter(
      (id) => Number.isSafeInteger(id) && id >= 0 && id < MAX_ENTRIES,
    ).length;
    if (total === 0) return;
    this.#publishProgress({ phase: "checking", completed: 0, total, cached: 0, failed: 0 });
    let cached = 0;
    let completed = 0;
    let failed = 0;
    let observedBatch = false;
    const observer: PythonRecordClient = {
      run: (command, args) => records.run(command, args),
      dispose: () => undefined,
      runRecords: (command, request, onRecord) => {
        if (command !== "cosmetics-prepare") return records.runRecords(command, request, onRecord);
        observedBatch = true;
        cached = Math.max(0, total - request.length);
        this.#publishProgress({ phase: "preparing", completed: cached, total, cached, failed });
        const stride = Math.max(1, Math.ceil(request.length / 80));
        return records.runRecords(command, request, async (value) => {
          // Preserve the existing batch's validation and persistence semantics.
          await onRecord(value);
          if (!isObject(value) || value.type !== "texture") return;
          completed += 1;
          if (value.artwork === null) failed += 1;
          if (completed % stride === 0 || completed === request.length) {
            this.#publishProgress({
              phase: "preparing",
              completed: Math.min(total, cached + completed),
              total,
              cached,
              failed,
            });
          }
        });
      },
    };
    const task = this.#prefetch(ids, observer)
      .then(() => {
        this.#publishProgress({
          phase: failed > 0 ? "degraded" : "ready",
          completed: total,
          total,
          cached: observedBatch ? cached : total,
          failed,
        });
      })
      .catch(() => {
        this.#publishProgress({ ...this.#progress, phase: "degraded" });
      });
    this.#prefetchTask = task;
    void task.finally(() => {
      if (this.#prefetchTask === task) this.#prefetchTask = null;
    });
  }

  async #prefetch(ids: readonly number[], client: PythonRecordClient): Promise<void> {
    await this.#load();
    const unique = [...new Set(ids)].filter(
      (id) => Number.isSafeInteger(id) && id >= 0 && id < MAX_ENTRIES,
    );
    // Deduplicate filesystem checks for source watches shared by all cosmetics.
    const checks = new Map<string, Promise<boolean>>();
    const validEntry = async (entry: Entry): Promise<boolean> => {
      const values = await Promise.all(
        entry.watches.map((watch) => {
          const key = `${watch.path}:${watch.size}:${watch.mtimeNs}`;
          let check = checks.get(key);
          if (check === undefined) {
            check = sourceValid([watch]);
            checks.set(key, check);
          }
          return check;
        }),
      );
      return values.every(Boolean);
    };
    const missing: number[] = [];
    for (const id of unique) {
      const entry = this.#entries.get(id);
      if (entry === undefined || !(await validEntry(entry))) missing.push(id);
    }
    if (missing.length === 0) return;
    missing.forEach((id) => this.#prefetchAttempted.add(id));
    const requested = new Set(missing);
    const seen = new Set<number>();
    let completed = 0;
    const rawFinal = await client.runRecords(
      "cosmetics-prepare",
      missing.map(String),
      async (value) => {
        if (
          !isObject(value) ||
          value.type !== "texture" ||
          typeof value.cosmeticId !== "number" ||
          !requested.has(value.cosmeticId) ||
          seen.has(value.cosmeticId) ||
          value.total !== missing.length ||
          value.completed !== completed + 1
        ) {
          throw new Error("Invalid or duplicate cosmetic preparation record.");
        }
        const id = value.cosmeticId;
        seen.add(id);
        completed += 1;
        const decoded = parseDecoded({ ok: true, artwork: value.artwork }, id);
        if (decoded === null || !(await sourceValid(decoded.entry.watches))) return;
        this.#remember(id, decoded);
        await this.#persistPrepared(id, decoded);
      },
    );
    await this.#flushPreparedManifest();
    if (
      !isObject(rawFinal) ||
      rawFinal.type !== "final" ||
      rawFinal.ok !== true ||
      rawFinal.total !== missing.length ||
      rawFinal.completed !== missing.length ||
      completed !== missing.length ||
      seen.size !== missing.length
    ) {
      throw new Error("Cosmetic batch did not finish successfully.");
    }
  }

  async get(id: number, client: PythonClient): Promise<Buffer | null> {
    if (!Number.isSafeInteger(id) || id < 0 || id >= MAX_ENTRIES) return null;
    const existing = this.#inFlight.get(id);
    if (existing !== undefined) return existing;
    const task = (async () => {
      await this.#load();
      const cached = (await this.#fromMemory(id)) ?? (await this.#fromDisk(id));
      if (cached !== null) return cached;
      // When a batch is already running, do not launch a second full-bundle scan.
      if (this.#prefetchTask !== null) {
        await this.#prefetchTask;
        return (await this.#fromMemory(id)) ?? (await this.#fromDisk(id));
      }
      // Missing/invalid sprites in a completed batch fail soft, without 557 retries.
      if (this.#prefetchAttempted.has(id)) return null;
      const run = this.#decodeTail.then(() => this.#decode(id, client));
      this.#decodeTail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    })();
    this.#inFlight.set(id, task);
    try {
      return await task;
    } finally {
      this.#inFlight.delete(id);
    }
  }
}

export const decodedCosmeticArtworkCache = new DecodedCosmeticArtworkCache();
