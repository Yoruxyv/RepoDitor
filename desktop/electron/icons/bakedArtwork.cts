/** Source-validated installed PNGs. Paths and mappings never leave Electron main. */
import { constants, promises as fs, type BigIntStats } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const BAKED_ARTWORK_COMMAND = "baked-artwork";
const VALIDATION_MANIFEST = "manifest.json";
const IDENTITY_FIELDS = ["size", "mtimeNs", "ctimeNs", "dev", "ino"];
type FileIdentity = Pick<BigIntStats, "size" | "mtimeNs" | "ctimeNs" | "dev" | "ino">;

import type { PythonClient } from "../python/client.cjs";
import { MAX_ICON_BYTES, validPngContents } from "./png.cjs";
import { readPngBytes } from "./localPng.cjs";

interface Watch {
  readonly path: string;
  readonly size: string;
  readonly mtimeNs: string;
  readonly device: string;
  readonly inode: string;
}
interface SourceIndex {
  readonly root: string;
  readonly sources: readonly Watch[];
  readonly item: ReadonlyMap<string, string>;
  readonly cosmetic: ReadonlyMap<string, string>;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSources(value: unknown): readonly Watch[] | null {
  if (!Array.isArray(value) || value.length < 5 || value.length > 16) return null;
  const sources: Watch[] = [];
  for (const raw of value) {
    if (!object(raw) || typeof raw.path !== "string" || !path.isAbsolute(raw.path)) return null;
    for (const key of ["size", "mtimeNs", "device", "inode"] as const) {
      if (typeof raw[key] !== "string" || !/^\d{1,24}$/.test(raw[key])) return null;
    }
    sources.push(raw as unknown as Watch);
  }
  return sources;
}

function parseMappings(
  value: unknown,
  domain: "item" | "cosmetic",
): ReadonlyMap<string, string> | null {
  if (!object(value) || Object.keys(value).length > 2000) return null;
  const entries = new Map<string, string>();
  const names = new Set<string>();
  for (const [id, name] of Object.entries(value)) {
    if (typeof name !== "string" || !/^[a-f0-9]{32}\.png$/.test(name) || names.has(name))
      return null;
    const validIdentity =
      domain === "cosmetic"
        ? /^(?:0|[1-9]\d{0,3})$/.test(id) && Number(id) < 2000
        : id.startsWith("Item ") && id.length <= 191 && !/[/\\\0]/.test(id);
    if (!validIdentity) return null;
    names.add(name);
    entries.set(id, name);
  }
  return entries;
}

function parseIndex(value: unknown): SourceIndex | null {
  if (!object(value) || value.ok !== true || !object(value.artwork)) return null;
  const data = value.artwork;
  if (typeof data.root !== "string" || !path.isAbsolute(data.root)) return null;
  const sources = parseSources(data.sources);
  const item = parseMappings(data.item, "item");
  const cosmetic = parseMappings(data.cosmetic, "cosmetic");
  return sources !== null && item !== null && cosmetic !== null
    ? { root: data.root, sources, item, cosmetic }
    : null;
}

function sameFile(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function sourcesValid(index: SourceIndex): Promise<boolean> {
  const results = await Promise.all(
    index.sources.map(async (watch) => {
      try {
        const info = await fs.lstat(watch.path, { bigint: true });
        return (
          info.isFile() &&
          !info.isSymbolicLink() &&
          path.relative(watch.path, await fs.realpath(watch.path)) === "" &&
          info.size.toString() === watch.size &&
          info.mtimeNs.toString() === watch.mtimeNs &&
          info.dev.toString() === watch.device &&
          info.ino.toString() === watch.inode
        );
      } catch {
        return false;
      }
    }),
  );
  return results.every(Boolean);
}

function parseFileIdentity(value: unknown): FileIdentity | null {
  if (!object(value)) return null;
  for (const key of IDENTITY_FIELDS) {
    if (typeof value[key] !== "string" || !/^\d{1,24}$/.test(value[key])) return null;
  }
  return {
    size: BigInt(String(value.size)),
    mtimeNs: BigInt(String(value.mtimeNs)),
    ctimeNs: BigInt(String(value.ctimeNs)),
    dev: BigInt(String(value.dev)),
    ino: BigInt(String(value.ino)),
  };
}

function sourceIdentity(index: SourceIndex): string {
  return createHash("sha256")
    .update(JSON.stringify([index.root, index.sources]))
    .digest("hex");
}

export class InstalledBakedArtwork {
  #loaded: Promise<SourceIndex | null> | null = null;
  readonly #validated = new Map<string, FileIdentity>();
  #persistentRoot: string | null = null;
  #validationLoaded: Promise<void> | null = null;
  #persistTail: Promise<void> = Promise.resolve();
  #version = 0;
  #savedVersion = 0;

  configurePersistentRoot(root: string): void {
    if (this.#persistentRoot !== null || !path.isAbsolute(root))
      throw new Error("Invalid baked validation cache root.");
    this.#persistentRoot = root;
  }

  async #loadValidation(index: SourceIndex): Promise<void> {
    const root = this.#persistentRoot;
    if (root === null) return;
    this.#validationLoaded ??= (async () => {
      try {
        const file = path.join(root, VALIDATION_MANIFEST);
        const info = await fs.lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) return;
        const raw: unknown = JSON.parse(await fs.readFile(file, "utf8"));
        if (
          !object(raw) ||
          raw.formatVersion !== 1 ||
          raw.sourceIdentity !== sourceIdentity(index) ||
          !object(raw.entries) ||
          Object.keys(raw.entries).length > 2000
        )
          return;
        for (const [fileName, value] of Object.entries(raw.entries)) {
          const identity = parseFileIdentity(value);
          if (identity !== null && path.isAbsolute(fileName) && !this.#validated.has(fileName)) {
            this.#validated.set(fileName, identity);
          }
        }
      } catch {
        /* Disposable validation stamps fail soft. */
      }
    })();
    await this.#validationLoaded;
  }

  async #persistValidation(index: SourceIndex): Promise<void> {
    const root = this.#persistentRoot;
    if (root === null) return;
    const task = this.#persistTail.then(async () => {
      if (this.#savedVersion === this.#version) return;
      const version = this.#version;
      const temporary = path.join(root, `${randomUUID()}.tmp`);
      try {
        const entries: Record<string, unknown> = {};
        for (const [file, identity] of this.#validated) {
          entries[file] = Object.fromEntries(
            Object.entries(identity)
              .filter(([key]) => IDENTITY_FIELDS.includes(key))
              .map(([key, value]) => [key, String(value)]),
          );
        }
        await fs.mkdir(root, { recursive: true });
        await fs.writeFile(
          temporary,
          JSON.stringify({ formatVersion: 1, sourceIdentity: sourceIdentity(index), entries }),
          { flag: "wx", mode: 0o600 },
        );
        await fs.rename(temporary, path.join(root, VALIDATION_MANIFEST));
        this.#savedVersion = version;
      } catch {
        /* Cache persistence must not block installed artwork. */
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
      }
    });
    this.#persistTail = task;
    await task;
  }

  async #index(client: PythonClient): Promise<SourceIndex | null> {
    this.#loaded ??= client
      .run(BAKED_ARTWORK_COMMAND)
      .then(parseIndex)
      .catch(() => null);
    const loaded = this.#loaded;
    let index = await loaded;
    if (index !== null && !(await sourcesValid(index))) {
      if (this.#loaded === loaded) {
        this.#validated.clear();
        this.#version += 1;
        this.#loaded = client
          .run(BAKED_ARTWORK_COMMAND)
          .then(parseIndex)
          .catch(() => null);
      }
      index = await this.#loaded;
      if (index !== null && !(await sourcesValid(index))) return null;
    }
    return index;
  }

  async #read(
    index: SourceIndex,
    domain: "item" | "cosmetic",
    id: string,
    checkOnly: boolean,
  ): Promise<Buffer | boolean> {
    const name = index[domain].get(id);
    if (name === undefined) return false;
    const candidate = path.join(
      index.root,
      "REPO_Data",
      "StreamingAssets",
      "BakedIcons",
      domain === "item" ? "Items" : "Cosmetics",
      name,
    );
    try {
      const before = await fs.lstat(candidate, { bigint: true });
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.size > BigInt(MAX_ICON_BYTES) ||
        path.relative(candidate, await fs.realpath(candidate)) !== ""
      )
        return false;
      const validated = this.#validated.get(candidate);
      if (checkOnly && validated !== undefined && sameFile(before, validated)) return true;
      const handle = await fs.open(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = await handle.stat({ bigint: true });
        if (!opened.isFile() || !sameFile(before, opened)) return false;
        const png = await readPngBytes(handle, opened.size);
        if (png === null) return false;
        const after = await fs.lstat(candidate, { bigint: true });
        if (
          !sameFile(opened, after) ||
          !sameFile(opened, await handle.stat({ bigint: true })) ||
          path.relative(candidate, await fs.realpath(candidate)) !== "" ||
          BigInt(png.length) !== opened.size ||
          !validPngContents(png)
        )
          return false;
        if (validated === undefined || !sameFile(validated, after)) {
          this.#validated.set(candidate, after);
          this.#version += 1;
        }
        return checkOnly ? true : png;
      } finally {
        await handle.close();
      }
    } catch {
      return false;
    }
  }

  async get(domain: "item" | "cosmetic", id: string, client: PythonClient): Promise<Buffer | null> {
    const index = await this.#index(client);
    if (index === null) return null;
    await this.#loadValidation(index);
    const png = await this.#read(index, domain, id, false);
    return Buffer.isBuffer(png) && (await sourcesValid(index)) ? png : null;
  }

  async availableCosmetics(
    ids: readonly number[],
    client: PythonClient,
  ): Promise<ReadonlySet<number>> {
    const available = new Set<number>();
    if (ids.length === 0) return available;
    const index = await this.#index(client);
    if (index === null) return available;
    await this.#loadValidation(index);
    for (const id of ids) {
      if (await this.#read(index, "cosmetic", String(id), true)) available.add(id);
    }
    if (!(await sourcesValid(index))) return new Set<number>();
    await this.#persistValidation(index);
    return available;
  }

  async availableItems(
    names: readonly string[],
    client: PythonClient,
  ): Promise<ReadonlySet<string>> {
    const available = new Set<string>();
    if (names.length === 0) return available;
    const index = await this.#index(client);
    if (index === null) return available;
    await this.#loadValidation(index);
    for (const name of new Set(names)) {
      if (await this.#read(index, "item", name, true)) available.add(name);
    }
    if (!(await sourcesValid(index))) return new Set<string>();
    await this.#persistValidation(index);
    return available;
  }
}

export const installedBakedArtwork = new InstalledBakedArtwork();
