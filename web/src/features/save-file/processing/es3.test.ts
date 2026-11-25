/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { decryptEs3, encryptEs3, Es3CryptoError } from "@/features/save-file/processing/es3";

interface CompatibilityVector {
  readonly container_base64: string;
  readonly iv_hex: string;
  readonly plaintext: Record<string, unknown>;
}

const COMPATIBILITY = JSON.parse(
  readFileSync(resolve("..", "compatibility", "es3", "known-vector.json"), "utf8"),
) as CompatibilityVector;
const COMPATIBILITY_JSON = JSON.stringify(COMPATIBILITY.plaintext, null, 4);

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encodeBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

function decodeHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

describe("ES3 compatibility crypto", () => {
  it("matches the Python deterministic decrypt and encrypt vector", async () => {
    const vector = decodeBase64(COMPATIBILITY.container_base64);

    await expect(
      decryptEs3(vector).then((plaintext) => new TextDecoder().decode(plaintext)),
    ).resolves.toBe(COMPATIBILITY_JSON);
    await expect(
      encryptEs3(new TextEncoder().encode(COMPATIBILITY_JSON), {
        testIv: decodeHex(COMPATIBILITY.iv_hex),
      }).then(encodeBase64),
    ).resolves.toBe(COMPATIBILITY.container_base64);
  });

  it("rejects corrupt containers and the wrong compatibility password", async () => {
    const corrupt = decodeBase64(COMPATIBILITY.container_base64);
    corrupt[corrupt.length - 1] = (corrupt.at(-1) ?? 0) ^ 1;

    await expect(decryptEs3(corrupt)).rejects.toBeInstanceOf(Es3CryptoError);
    await expect(
      decryptEs3(decodeBase64(COMPATIBILITY.container_base64), "wrong password"),
    ).rejects.toBeInstanceOf(Es3CryptoError);
    await expect(decryptEs3(new Uint8Array(16))).rejects.toMatchObject({
      code: "invalid-container",
    });
  });
});
