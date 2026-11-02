/** Finite installed-map Sprite source adapter using the existing validated PNG store. */
import { validMapFamily } from "./registry.cjs";
import type { PythonClient } from "../python/client.cjs";
import { validPngContents } from "./png.cjs";
import {
  SpriteArtworkStore,
  isObject,
  parseSpriteArtwork,
  sourceValid,
} from "./spriteArtworkStore.cjs";

export class MapArtwork {
  readonly #store = new SpriteArtworkStore<string>("map", (key) =>
    validMapFamily(key) ? key : null,
  );
  #batch: Promise<void> | null = null;
  #revision: string | null = null;
  #generation = 0;

  configurePersistentRoot(root: string): void {
    this.#store.configurePersistentRoot(root);
  }

  /** Explicit catalog refresh permits retrying optional failures without looping on image errors. */
  refresh(): void {
    this.#generation += 1;
    if (this.#batch === null) this.#revision = null;
  }

  async #prepare(revision: string, client: PythonClient): Promise<void> {
    try {
      const response = await client.run("maps-artwork");
      if (!isObject(response) || response.ok !== true || !isObject(response.artworks)) return;
      const entries = Object.entries(response.artworks);
      if (entries.length > 128) return;
      let total = 0;
      for (const [family, artwork] of entries) {
        if (!validMapFamily(family)) continue;
        const value = parseSpriteArtwork({ ok: true, artwork });
        if (value?.entry.sourceIdentity !== revision) continue;
        total += value.png.length;
        if (total > 8 * 1024 * 1024) return;
        if (!validPngContents(value.png) || !(await sourceValid(value.entry.watches))) continue;
        this.#store.remember(family, value);
        await this.#store.persistPrepared(family, value);
      }
    } catch {
      /* Decoding is optional; the installed map catalog remains usable. */
    } finally {
      await this.#store.flushPreparedManifest();
    }
  }

  async get(family: string, revision: string, client: PythonClient): Promise<Buffer | null> {
    if (!validMapFamily(family) || !/^[a-f0-9]{64}$/.test(revision)) return null;
    const generation = this.#generation;
    await this.#store.load();
    const cached =
      (await this.#store.fromMemory(family, revision)) ??
      (await this.#store.fromDisk(family, revision));
    if (generation !== this.#generation) return null;
    if (cached !== null && validPngContents(cached)) return cached;
    if (this.#batch !== null) await this.#batch;
    if (generation !== this.#generation) return null;
    if (this.#revision !== revision) {
      this.#revision = revision;
      const task = this.#prepare(revision, client);
      this.#batch = task;
      try {
        await task;
      } finally {
        if (this.#batch === task) this.#batch = null;
      }
    }
    const png =
      (await this.#store.fromMemory(family, revision)) ??
      (await this.#store.fromDisk(family, revision));
    return generation === this.#generation && png !== null && validPngContents(png) ? png : null;
  }
}

export const mapArtwork = new MapArtwork();
