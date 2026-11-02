/** Cosmetic Sprite source selection and finite baked-first preparation. */
import type { PythonClient, PythonRecordClient } from "../python/client.cjs";
import { installedBakedArtwork, type InstalledBakedArtwork } from "./bakedArtwork.cjs";
import {
  SpriteArtworkStore,
  parseSpriteArtwork,
  sourceValid,
  isObject,
  type Decoded,
} from "./spriteArtworkStore.cjs";
const MAX_ENTRIES = 2_000;

function parseDecoded(response: unknown, id: number): Decoded | null {
  if (!isObject(response) || !isObject(response.artwork) || response.artwork.cosmeticId !== id)
    return null;
  return parseSpriteArtwork(response);
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

export class DecodedCosmeticArtworkCache {
  constructor(
    readonly baked: Pick<InstalledBakedArtwork, "availableCosmetics"> = installedBakedArtwork,
  ) {}
  readonly #store = new SpriteArtworkStore<number>("cosmetic", (key) =>
    /^(?:0|[1-9]\d{0,3})$/.test(key) && Number(key) < MAX_ENTRIES ? Number(key) : null,
  );
  readonly #inFlight = new Map<number, Promise<Buffer | null>>();
  #decodeTail: Promise<void> = Promise.resolve();
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
    this.#store.configurePersistentRoot(root);
  }

  async #decode(id: number, client: PythonClient): Promise<Buffer | null> {
    try {
      // Decode is serialized to prevent concurrent heavy scans of installed game assets.
      const response = await client.run("cosmetic-artwork", [String(id)]);
      const value = parseDecoded(response, id);
      if (value === null || !(await sourceValid(value.entry.watches))) return null;
      this.#store.remember(id, value);
      await this.#store.persist(id, value);
      return value.png;
    } catch {
      return null;
    }
  }

  /** Verify readiness silently, then prepare only missing artwork in one batch. */
  prefetch(ids: readonly number[], client: PythonClient): void {
    if (
      this.#prefetchTask !== null ||
      !("runRecords" in client) ||
      typeof client.runRecords !== "function"
    )
      return;
    const unique = [...new Set(ids)].filter(
      (id) => Number.isSafeInteger(id) && id >= 0 && id < MAX_ENTRIES,
    );
    if (unique.length === 0) return;
    const records = client as PythonRecordClient;
    const task = this.#decodeTail.then(() => this.#prefetch(unique, records));
    this.#prefetchTask = task;
    this.#decodeTail = task.catch(() => undefined);
    void task.finally(() => {
      if (this.#prefetchTask === task) this.#prefetchTask = null;
    });
  }

  async #prefetch(ids: readonly number[], client: PythonRecordClient): Promise<void> {
    let cached = 0;
    let completed = 0;
    let failed = 0;
    const total = ids.length;
    let preparing = false;
    const publish = (phase: CosmeticArtworkPreparationPhase) =>
      this.#publishProgress({ phase, completed, total, cached, failed });
    try {
      await this.#store.load();
      const baked = await this.baked.availableCosmetics(ids, client);
      const remaining = ids.filter((id) => !baked.has(id));
      cached = total - remaining.length;
      const missing: number[] = [];
      for (const id of remaining) {
        if (((await this.#store.fromMemory(id)) ?? (await this.#store.fromDisk(id))) !== null)
          cached += 1;
        else if (this.#prefetchAttempted.has(id)) failed += 1;
        else missing.push(id);
      }
      completed = cached + failed;
      if (missing.length === 0) {
        publish(failed === 0 ? "ready" : "degraded");
        return;
      }
      missing.forEach((id) => this.#prefetchAttempted.add(id));
      const requested = new Set(missing);
      const seen = new Set<number>();
      preparing = true;
      publish("preparing");
      const stride = Math.max(1, Math.ceil(missing.length / 80));
      const final = await client.runRecords(
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
            value.completed !== seen.size + 1
          ) {
            throw new Error("Invalid or duplicate cosmetic preparation record.");
          }
          const id = value.cosmeticId;
          seen.add(id);
          completed += 1;
          const decoded = parseDecoded({ ok: true, artwork: value.artwork }, id);
          if (decoded === null || !(await sourceValid(decoded.entry.watches))) failed += 1;
          else {
            this.#store.remember(id, decoded);
            await this.#store.persistPrepared(id, decoded);
            this.#prefetchAttempted.delete(id);
          }
          if (seen.size % stride === 0 || seen.size === missing.length) publish("preparing");
        },
      );
      if (
        !isObject(final) ||
        final.type !== "final" ||
        final.ok !== true ||
        final.total !== missing.length ||
        final.completed !== missing.length ||
        seen.size !== missing.length
      ) {
        throw new Error("Cosmetic batch did not finish successfully.");
      }
      publish(failed === 0 ? "ready" : "degraded");
    } catch {
      failed += total - completed;
      publish("degraded");
    } finally {
      if (preparing) await this.#store.flushPreparedManifest();
    }
  }

  async get(id: number, client: PythonClient): Promise<Buffer | null> {
    if (!Number.isSafeInteger(id) || id < 0 || id >= MAX_ENTRIES) return null;
    const existing = this.#inFlight.get(id);
    if (existing !== undefined) return existing;
    const task = (async () => {
      await this.#store.load();
      const cached = (await this.#store.fromMemory(id)) ?? (await this.#store.fromDisk(id));
      if (cached !== null) return cached;
      // When a batch is already running, do not launch a second full-bundle scan.
      if (this.#prefetchTask !== null) {
        await this.#prefetchTask;
        return (await this.#store.fromMemory(id)) ?? (await this.#store.fromDisk(id));
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
