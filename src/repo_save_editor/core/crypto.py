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


# This is the encryption password used by the save format supported by this
# editor. Keeping it here makes compatibility behavior explicit and testable.
ES3_PASSWORD = "Why would you want to cheat?... :o It's no fun. :') :'D"
IV_SIZE = 16
PBKDF2_ITERATIONS = 100
KEY_SIZE = 16


def _derive_key(password: bytes, iv: bytes) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha1",
        password,
        iv,
        PBKDF2_ITERATIONS,
        dklen=KEY_SIZE,
    )


def decrypt_save(blob: bytes) -> dict[str, Any]:
    """Decrypt an ES3 save and return its JSON object."""
    if len(blob) <= IV_SIZE:
        raise SaveCryptoError("The selected file is too small to be a supported save.")

    iv = blob[:IV_SIZE]
    ciphertext = blob[IV_SIZE:]
    key = _derive_key(ES3_PASSWORD.encode("utf-8"), iv)

    try:
        decryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
        padded = decryptor.update(ciphertext) + decryptor.finalize()

        unpadder = PKCS7(128).unpadder()
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
    """Encode and encrypt a save using the supported ES3 container format."""
    try:
        plaintext = json.dumps(
            data,
            ensure_ascii=False,
            indent=4,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise SaveCryptoError("The edited save cannot be serialized.") from exc

    iv = os.urandom(IV_SIZE)
    key = _derive_key(ES3_PASSWORD.encode("utf-8"), iv)

    padder = PKCS7(128).padder()
    padded = padder.update(plaintext) + padder.finalize()

    encryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    ciphertext = encryptor.update(padded) + encryptor.finalize()

    return iv + ciphertext
