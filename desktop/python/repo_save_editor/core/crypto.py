"""Encryption/decryption helpers for the R.E.P.O. ES3 save container."""

from __future__ import annotations

import hashlib
import json
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.padding import PKCS7

from repo_save_editor.core.json_fields import replace_es3_values


class SaveCryptoError(ValueError):
    """Raised when a save cannot be decrypted, decoded, or encoded."""


# R.E.P.O./ES3 compatibility contract.
#
# These values reproduce the observed R.E.P.O./ES3 save container; they are not
# RepoDitor cryptographic design choices. ES3_PASSWORD is format compatibility
# material, not a user credential or application secret. PBKDF2-HMAC-SHA1/100,
# AES-CBC, and PKCS#7 must remain exact or existing saves will no longer decrypt
# and newly written saves will not match the observed format. See SECURITY.md
# and the shared compatibility vector in compatibility/es3/known-vector.json.
ES3_PASSWORD = "Why would you want to cheat?... :o It's no fun. :') :'D"  # noqa: S105
ES3_COMPAT_IV_SIZE_BYTES = 16
ES3_COMPAT_PBKDF2_HASH = "sha1"
ES3_COMPAT_PBKDF2_ITERATIONS = 100
ES3_COMPAT_KEY_SIZE_BYTES = 16
ES3_COMPAT_AES_BLOCK_SIZE_BITS = 128


def _derive_key(password: bytes, iv: bytes) -> bytes:
    # The low iteration count is format-defined; changing it derives a different key.
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
    plaintext = _decrypt_plaintext(blob)
    try:
        data = json.loads(plaintext.decode("utf-8"))
    except ValueError as exc:
        raise SaveCryptoError("The decrypted save is not valid JSON.") from exc

    if not isinstance(data, dict):
        raise SaveCryptoError("The decrypted save root is not a JSON object.")

    return data


def _decrypt_plaintext(blob: bytes) -> bytes:
    if len(blob) <= ES3_COMPAT_IV_SIZE_BYTES:
        raise SaveCryptoError("The selected file is too small to be a supported save.")

    iv = blob[:ES3_COMPAT_IV_SIZE_BYTES]
    ciphertext = blob[ES3_COMPAT_IV_SIZE_BYTES:]
    key = _derive_key(ES3_PASSWORD.encode("utf-8"), iv)

    try:
        # CBC is format-defined here; this compatibility path does not add authentication.
        decryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
        padded = decryptor.update(ciphertext) + decryptor.finalize()

        unpadder = PKCS7(ES3_COMPAT_AES_BLOCK_SIZE_BITS).unpadder()
        plaintext = unpadder.update(padded) + unpadder.finalize()

        plaintext.decode("utf-8")
    except ValueError as exc:
        raise SaveCryptoError(
            "Unable to decrypt this save. It may be corrupted or from an "
            "unsupported R.E.P.O. version."
        ) from exc

    return plaintext


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

    return _encrypt_plaintext(plaintext)


def _encrypt_plaintext(plaintext: bytes) -> bytes:
    iv = os.urandom(ES3_COMPAT_IV_SIZE_BYTES)
    key = _derive_key(ES3_PASSWORD.encode("utf-8"), iv)

    padder = PKCS7(ES3_COMPAT_AES_BLOCK_SIZE_BITS).padder()
    padded = padder.update(plaintext) + padder.finalize()

    # AES-CBC + PKCS#7 reproduce the observed ES3 container and must remain exact.
    encryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    ciphertext = encryptor.update(padded) + encryptor.finalize()

    return iv + ciphertext


def encrypt_save_fields(data: dict[str, Any], source: bytes, fields: frozenset[str]) -> bytes:
    """Replace only selected ES3 .value fields and preserve all other plaintext bytes."""
    from_source = _decrypt_plaintext(source).decode("utf-8")
    original = json.loads(from_source)
    if set(data) != set(original) or any(
        data[key] != original[key] for key in data.keys() - fields
    ):
        raise SaveCryptoError("An edit changed fields outside the declared write boundary.")
    replacements = {}
    for key in fields & data.keys():
        before, after = original[key], data[key]
        if (
            not isinstance(before, dict)
            or not isinstance(after, dict)
            or "value" not in before
            or set(before) != set(after)
            or any(before[name] != after[name] for name in before.keys() - {"value"})
        ):
            raise SaveCryptoError("An edit changed metadata outside its ES3 value field.")
        if before["value"] != after["value"]:
            replacements[key] = after["value"]
    plaintext = replace_es3_values(from_source, replacements)
    if json.loads(plaintext) != data:
        raise SaveCryptoError("Preserved JSON does not match the requested edit.")
    return _encrypt_plaintext(plaintext.encode("utf-8"))
