"""Encryption/decryption helpers for the R.E.P.O. ES3 save container."""

from __future__ import annotations

import hashlib
import json
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.padding import PKCS7


class SaveCryptoError(ValueError):
    """Raised when a save cannot be decrypted, decoded, or encoded."""


# ES3 compatibility contract: these values reproduce the game-owned save
# container. They are not RepoDitor security choices; changing them would make
# existing R.E.P.O. saves unreadable.
ES3_PASSWORD = "Why would you want to cheat?... :o It's no fun. :') :'D"
ES3_COMPAT_IV_SIZE_BYTES = 16
ES3_COMPAT_PBKDF2_HASH = "sha1"
ES3_COMPAT_PBKDF2_ITERATIONS = 100
ES3_COMPAT_KEY_SIZE_BYTES = 16
ES3_COMPAT_AES_BLOCK_SIZE_BITS = 128


def _derive_key(password: bytes, iv: bytes) -> bytes:
    return hashlib.pbkdf2_hmac(
        ES3_COMPAT_PBKDF2_HASH,
        password,
        iv,
        ES3_COMPAT_PBKDF2_ITERATIONS,
        dklen=ES3_COMPAT_KEY_SIZE_BYTES,
    )


def decrypt_save(blob: bytes) -> dict[str, Any]:
    """Decrypt an ES3 container and decode its JSON object.

    Args:
        blob: Complete encrypted save bytes, including the compatibility IV.

    Returns:
        The decrypted object at the save root.

    Raises:
        SaveCryptoError: The container is too small, cannot be decrypted or decoded,
            or does not contain a JSON object.
    """
    if len(blob) <= ES3_COMPAT_IV_SIZE_BYTES:
        raise SaveCryptoError("The selected file is too small to be a supported save.")

    iv = blob[:ES3_COMPAT_IV_SIZE_BYTES]
    ciphertext = blob[ES3_COMPAT_IV_SIZE_BYTES:]
    key = _derive_key(ES3_PASSWORD.encode("utf-8"), iv)

    try:
        decryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
        padded = decryptor.update(ciphertext) + decryptor.finalize()

        unpadder = PKCS7(ES3_COMPAT_AES_BLOCK_SIZE_BITS).unpadder()
        plaintext = unpadder.update(padded) + unpadder.finalize()

        decoded = plaintext.decode("utf-8")
        data = json.loads(decoded)
    except ValueError as exc:
        raise SaveCryptoError(
            "Unable to decrypt this save. It may be corrupted or from an "
            "unsupported R.E.P.O. version."
        ) from exc

    if not isinstance(data, dict):
        raise SaveCryptoError("The decrypted save root is not a JSON object.")

    return data


def encrypt_save(data: dict[str, Any]) -> bytes:
    """Encode and encrypt a save using the game-compatible ES3 container.

    Args:
        data: Validated save data supplied by the caller-owned repository.

    Returns:
        A new random-IV encrypted container compatible with observed R.E.P.O. saves.

    Raises:
        SaveCryptoError: The supplied object cannot be serialized.
    """
    try:
        plaintext = json.dumps(
            data,
            ensure_ascii=False,
            indent=4,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise SaveCryptoError("The edited save cannot be serialized.") from exc

    iv = os.urandom(ES3_COMPAT_IV_SIZE_BYTES)
    key = _derive_key(ES3_PASSWORD.encode("utf-8"), iv)

    padder = PKCS7(ES3_COMPAT_AES_BLOCK_SIZE_BITS).padder()
    padded = padder.update(plaintext) + padder.finalize()

    encryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    ciphertext = encryptor.update(padded) + encryptor.finalize()

    return iv + ciphertext
