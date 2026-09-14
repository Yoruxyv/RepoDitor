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
