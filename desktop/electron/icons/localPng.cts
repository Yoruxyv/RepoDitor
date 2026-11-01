/** Bounded PNG reads, plus read-only access for the preserved upgrade cache. */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileHandle } from "node:fs/promises";

import { MAX_ICON_BYTES, validPng } from "./png.cjs";

export async function readPngBytes(handle: FileHandle, size: bigint): Promise<Buffer | null> {
  if (size <= 0n || size > BigInt(MAX_ICON_BYTES)) return null;
  const data = Buffer.alloc(Number(size));
  let offset = 0;
  while (offset < data.length) {
    const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
    if (bytesRead === 0) return null;
    offset += bytesRead;
  }
  return data;
}

export async function readLocalPng(root: string, key: string): Promise<Buffer | null> {
  if (!path.isAbsolute(root) || !/^[^/\\\0]{1,256}\.png$/.test(key)) return null;
  const candidate = path.join(root, key);
  try {
    const rootReal = await fs.realpath(root);
    const initial = await fs.lstat(candidate, { bigint: true });
    if (!initial.isFile() || initial.isSymbolicLink() || initial.size > BigInt(MAX_ICON_BYTES))
      return null;
    const candidateReal = await fs.realpath(candidate);
    if (path.relative(path.join(rootReal, key), candidateReal) !== "") return null;
    const handle = await fs.open(candidateReal, "r");
    try {
      const stat = await handle.stat({ bigint: true });
      if (
        !stat.isFile() ||
        stat.size !== initial.size ||
        stat.ino !== initial.ino ||
        stat.dev !== initial.dev ||
        stat.mtimeNs !== initial.mtimeNs
      )
        return null;
      const data = await readPngBytes(handle, stat.size);
      if (data === null) return null;
      const after = await handle.stat({ bigint: true });
      if (
        BigInt(data.length) !== stat.size ||
        stat.mtimeNs !== after.mtimeNs ||
        stat.size !== after.size ||
        !validPng(data)
      )
        return null;
      return data;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}
