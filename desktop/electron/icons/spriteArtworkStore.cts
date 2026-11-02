/** Source-validated PNG storage shared by decoded Sprite source adapters. */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MAX_ICON_BYTES, validPng } from "./png.cjs";
import { readLocalPng, readPngBytes } from "./localPng.cjs";

const FORMAT_VERSION = 1;
const MANIFEST_NAME = "manifest.json";
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
export interface Decoded {
  readonly entry: Entry;
  readonly png: Buffer;
}

export function isObject(value: unknown): value is Record<string, unknown> {
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
      watch.path.length > 4096 ||
      Array.from(watch.path).some((char) => char.charCodeAt(0) < 32) ||
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

export function sourceValid(watches: readonly SourceWatch[]): Promise<boolean> {
  return Promise.all(
    watches.map(async (watch) => {
      try {
        const stat = await fs.lstat(watch.path, { bigint: true });
        return (
          stat.isFile() &&
          !stat.isSymbolicLink() &&
          path.relative(watch.path, await fs.realpath(watch.path)) === "" &&
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

export function parseSpriteArtwork(response: unknown): Decoded | null {
  if (!isObject(response) || response.ok !== true || !isObject(response.artwork)) return null;
  const value = response.artwork;
  if (
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

function fileName(namespace: string, id: string | number, entry: Entry): string {
  return sha(Buffer.from(`${namespace}:${id}:${entry.sourceIdentity}`, "utf8")) + ".png";
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

export class SpriteArtworkStore<K extends string | number> {
  #root: string | null = null;
  readonly #memory = new Map<K, Decoded>();
  readonly #entries = new Map<K, Entry>();
  #loaded: Promise<void> | null = null;
  #persistTail: Promise<void> = Promise.resolve();
  readonly #obsolete = new Set<string>();

  constructor(
    readonly namespace: string,
    readonly parseKey: (key: string) => K | null,
  ) {}

  configurePersistentRoot(root: string): void {
    if (this.#root !== null || !path.isAbsolute(root))
      throw new Error("Invalid Sprite cache root.");
    this.#root = root;
  }

  async load(): Promise<void> {
    const root = this.#root;
    if (root === null) return;
    if (this.#loaded === null)
      this.#loaded = (async () => {
        try {
          const candidate = path.join(root, MANIFEST_NAME);
          const stat = await fs.lstat(candidate);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) return;
          if (path.relative(candidate, await fs.realpath(candidate)) !== "") return;
          const handle = await fs.open(candidate, "r");
          let bytes: Buffer | null;
          try {
            const opened = await handle.stat({ bigint: true });
            if (!opened.isFile() || opened.size > BigInt(MAX_MANIFEST_BYTES)) return;
            bytes = await readPngBytes(handle, opened.size);
          } finally {
            await handle.close();
          }
          if (bytes === null) return;
          const parsed: unknown = JSON.parse(bytes.toString("utf8"));
          if (
            !isObject(parsed) ||
            parsed.formatVersion !== FORMAT_VERSION ||
            !isObject(parsed.entries)
          )
            return;
          if (Object.keys(parsed.entries).length > MAX_ENTRIES) return;
          for (const [key, value] of Object.entries(parsed.entries)) {
            const id = this.parseKey(key);
            if (id === null) continue;
            const entry = parseEntry(value);
            if (entry !== null) this.#entries.set(id, entry);
          }
        } catch {
          /* Cache is disposable. */
        }
      })();
    await this.#loaded;
  }

  async fromMemory(id: K, identity?: string): Promise<Buffer | null> {
    const value = this.#memory.get(id);
    if (value === undefined || (identity !== undefined && value.entry.sourceIdentity !== identity))
      return null;
    if (!(await sourceValid(value.entry.watches))) {
      this.#memory.delete(id);
      return null;
    }
    return value.png;
  }

  async fromDisk(id: K, identity?: string): Promise<Buffer | null> {
    if (this.#root === null) return null;
    const entry = this.#entries.get(id);
    if (
      entry === undefined ||
      (identity !== undefined && entry.sourceIdentity !== identity) ||
      !(await sourceValid(entry.watches))
    ) {
      return null;
    }
    const name = fileName(this.namespace, id, entry);
    if (!PNG_PATTERN.test(name)) return null;
    try {
      const png = await readLocalPng(this.#root, name);
      if (png === null || sha(png) !== entry.pngHash || !(await sourceValid(entry.watches)))
        return null;
      this.remember(id, { entry, png });
      return png;
    } catch {
      return null;
    }
  }

  remember(id: K, value: Decoded): void {
    this.#memory.delete(id);
    this.#memory.set(id, value);
    if (this.#memory.size > 96) this.#memory.delete(this.#memory.keys().next().value!);
  }

  async persist(id: K, value: Decoded): Promise<void> {
    const root = this.#root;
    if (root === null) return;
    const task = this.#persistTail.then(async () => {
      await this.persistPrepared(id, value);
      await this.flushPreparedManifest();
    });
    this.#persistTail = task.then(
      () => undefined,
      () => undefined,
    );
    await task;
  }

  /** Batch persistence writes the PNGs separately, then one atomic manifest. */
  async persistPrepared(id: K, value: Decoded): Promise<void> {
    if (this.#root === null) return;
    try {
      await fs.mkdir(this.#root, { recursive: true });
      await atomicFile(path.join(this.#root, fileName(this.namespace, id, value.entry)), value.png);
      const old = this.#entries.get(id);
      if (old !== undefined && old.sourceIdentity !== value.entry.sourceIdentity)
        this.#obsolete.add(fileName(this.namespace, id, old));
      this.#entries.set(id, value.entry);
    } catch {
      /* Source artwork is optional. */
    }
  }

  async flushPreparedManifest(): Promise<void> {
    if (this.#root === null) return;
    try {
      const entries: Record<string, unknown> = {};
      for (const [key, entry] of this.#entries) entries[String(key)] = serializableEntry(entry);
      await atomicFile(
        path.join(this.#root, MANIFEST_NAME),
        JSON.stringify({
          formatVersion: FORMAT_VERSION,
          entries,
        }),
      );
      for (const name of this.#obsolete) {
        await fs.rm(path.join(this.#root, name), { force: true });
        this.#obsolete.delete(name);
      }
    } catch {
      /* Cache writes must not block presentation. */
    }
  }
}
