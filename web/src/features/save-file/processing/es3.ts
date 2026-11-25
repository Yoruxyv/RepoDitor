const ES3_CRYPTO_ERROR_CODE = {
  decryptFailed: "decrypt-failed",
  encryptFailed: "encrypt-failed",
  invalidContainer: "invalid-container",
} as const;

type Es3CryptoErrorCode = (typeof ES3_CRYPTO_ERROR_CODE)[keyof typeof ES3_CRYPTO_ERROR_CODE];

const ES3_PASSWORD = "Why would you want to cheat?... :o It's no fun. :') :'D";
const IV_LENGTH = 16;
const PBKDF2_ITERATIONS = 100;

const encoder = new TextEncoder();

export class Es3CryptoError extends Error {
  readonly code: Es3CryptoErrorCode;

  constructor(code: Es3CryptoErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "Es3CryptoError";
  }
}

interface EncryptOptions {
  /** Fixed IV for deterministic compatibility tests; production callers omit it. */
  testIv?: Uint8Array;
}

function bytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Es3CryptoError(
      ES3_CRYPTO_ERROR_CODE.encryptFailed,
      "Web Crypto is not available in this browser.",
    );
  }
  return globalThis.crypto;
}

async function deriveKey(password: string, iv: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  const crypto = webCrypto();
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-1",
      iterations: PBKDF2_ITERATIONS,
      salt: bytes(iv),
    },
    material,
    { name: "AES-CBC", length: 128 },
    false,
    [usage],
  );
}

export async function decryptEs3(
  container: Uint8Array,
  password = ES3_PASSWORD,
): Promise<Uint8Array<ArrayBuffer>> {
  if (container.length <= IV_LENGTH || (container.length - IV_LENGTH) % IV_LENGTH !== 0) {
    throw new Es3CryptoError(
      ES3_CRYPTO_ERROR_CODE.invalidContainer,
      "The selected file is not a supported ES3 container.",
    );
  }

  const iv = bytes(container.subarray(0, IV_LENGTH));
  const ciphertext = bytes(container.subarray(IV_LENGTH));

  try {
    const key = await deriveKey(password, iv, "decrypt");
    const plaintext = await webCrypto().subtle.decrypt({ name: "AES-CBC", iv }, key, ciphertext);
    return new Uint8Array(plaintext);
  } catch (error) {
    if (error instanceof Es3CryptoError) {
      throw error;
    }
    throw new Es3CryptoError(
      ES3_CRYPTO_ERROR_CODE.decryptFailed,
      "Unable to decrypt this save. It may be corrupted or unsupported.",
    );
  }
}

export async function encryptEs3(
  plaintext: Uint8Array,
  options: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = options.testIv
    ? bytes(options.testIv)
    : webCrypto().getRandomValues(new Uint8Array(IV_LENGTH));
  if (iv.length !== IV_LENGTH) {
    throw new Es3CryptoError(
      ES3_CRYPTO_ERROR_CODE.encryptFailed,
      "The ES3 initialization vector is invalid.",
    );
  }

  try {
    const key = await deriveKey(ES3_PASSWORD, iv, "encrypt");
    const ciphertext = new Uint8Array(
      await webCrypto().subtle.encrypt({ name: "AES-CBC", iv }, key, bytes(plaintext)),
    );
    const container = new Uint8Array(iv.length + ciphertext.length);
    container.set(iv);
    container.set(ciphertext, iv.length);
    return container;
  } catch (error) {
    if (error instanceof Es3CryptoError) {
      throw error;
    }
    throw new Es3CryptoError(
      ES3_CRYPTO_ERROR_CODE.encryptFailed,
      "Unable to encrypt this save safely.",
    );
  }
}
