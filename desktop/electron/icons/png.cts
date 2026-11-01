import { crc32, inflateSync } from "node:zlib";

/** Shared bounds and header validation for local presentation PNGs. */
export const MAX_ICON_BYTES = 2 * 1024 * 1024;
const MAX_ICON_DIMENSION = 2048;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function validPng(data: Buffer): boolean {
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

interface PngChunk {
  readonly type: string;
  readonly data: Buffer;
}

function pngChunks(data: Buffer): readonly PngChunk[] | null {
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 12 <= data.length && chunks.length < 4096) {
    const length = data.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > data.length) return null;
    const type = data.subarray(offset + 4, offset + 8).toString("ascii");
    if (
      !/^[A-Za-z]{4}$/.test(type) ||
      crc32(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)
    )
      return null;
    chunks.push({ type, data: data.subarray(offset + 8, end - 4) });
    offset = end;
  }
  return offset === data.length ? chunks : null;
}

function validPixels(data: Buffer, compressed: readonly Buffer[]): boolean {
  const stride = data.readUInt32BE(16) * (data[25] === 6 ? 4 : 3) + 1;
  const expected = stride * data.readUInt32BE(20);
  try {
    const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
    if (pixels.length !== expected) return false;
    for (let i = 0; i < pixels.length; i += stride) {
      if (pixels[i] > 4) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function validPngContents(data: Buffer): boolean {
  if (!validPng(data) || data.length < 57) return false;
  const chunks = pngChunks(data);
  if (chunks === null || chunks.length < 3) return false;
  const first = chunks[0];
  const last = chunks[chunks.length - 1];
  if (
    first.type !== "IHDR" ||
    first.data.length !== 13 ||
    last.type !== "IEND" ||
    last.data.length !== 0
  )
    return false;
  const fields = first.data.subarray(8);
  if (!fields.equals(Buffer.from([8, 2, 0, 0, 0])) && !fields.equals(Buffer.from([8, 6, 0, 0, 0])))
    return false;
  const compressed = compressedChunks(chunks);
  return compressed !== null && validPixels(data, compressed);
}

function compressedChunks(chunks: readonly PngChunk[]): readonly Buffer[] | null {
  const compressed: Buffer[] = [];
  let dataEnded = false;
  for (const part of chunks.slice(1, -1)) {
    if (part.type === "IDAT") {
      if (dataEnded) return null;
      compressed.push(part.data);
      continue;
    }
    dataEnded = compressed.length > 0;
    if (part.type === "PLTE") {
      if (
        dataEnded ||
        part.data.length === 0 ||
        part.data.length > 768 ||
        part.data.length % 3 !== 0
      )
        return null;
    } else if (/^[A-Z]/.test(part.type)) return null;
  }
  return compressed.length > 0 ? compressed : null;
}
