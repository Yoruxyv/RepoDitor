"""Read-only cosmetic artwork for the trusted desktop hosts."""

from __future__ import annotations

import base64
import hmac
import os
import struct
from hashlib import sha256

from repo_save_editor.desktop_api.cosmetics import _meta_path, get_cosmetics
from repo_save_editor.desktop_api.protocol import DesktopSaveError
from repo_save_editor.services.baked_artwork import (
    MAX_IDENTITIES,
    native_cosmetic_catalog,
    read_bound_cosmetic_png,
)
from repo_save_editor.services.cosmetics.installed_artwork import (
    CosmeticArtworkError,
    DecodedCosmeticArtwork,
    prepare_installed_cosmetic_artwork,
)
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.cosmetics.presentation_catalog import (
    discover_cosmetic_presentation_catalog,
)
from repo_save_editor.storage.repository import read_save_bytes

MAX_ID = 2_000


def serialize_cosmetic_artwork(decoded: DecodedCosmeticArtwork) -> dict[str, object]:
    """Serialize validated PNG data and its source validation watches."""
    return {
        "cosmeticId": decoded.cosmetic_id,
        "sourceIdentity": decoded.source_identity,
        "pngBase64": base64.b64encode(decoded.png).decode("ascii"),
        "width": decoded.width,
        "height": decoded.height,
        "watches": [
            {
                "path": str(watch.path),
                "size": str(watch.size),
                "mtimeNs": str(watch.mtime_ns),
            }
            for watch in decoded.watches
        ],
    }


def get_cosmetic_artwork(value: str) -> dict[str, object]:
    """Decode a single installed cosmetic and fail soft on unsupported assets."""
    if (
        len(value) > 4
        or not value.isascii()
        or not value.isdecimal()
        or (value != "0" and value.startswith("0"))
    ):
        return {"ok": False, "error": "invalid_cosmetic_id"}
    cosmetic_id = int(value)
    if cosmetic_id >= MAX_ID:
        return {"ok": False, "error": "invalid_cosmetic_id"}
    try:
        result = prepare_installed_cosmetic_artwork([cosmetic_id])
    except (CosmeticArtworkError, ImportError, OSError, ValueError, RuntimeError):
        return {"ok": True, "artwork": None}
    if len(result) != 1 or result[0].cosmetic_id != cosmetic_id:
        return {"ok": True, "artwork": None}
    return {"ok": True, "artwork": serialize_cosmetic_artwork(result[0])}


def _hex(value: str, length: int) -> bool:
    return len(value) == length and all(c in "0123456789abcdef" for c in value)


def _host_key() -> bytes | None:
    value = os.environ.get("REPODITOR_NATIVE_COSMETIC_KEY", "")
    return bytes.fromhex(value) if _hex(value, 64) else None


def _signature(key: bytes, fingerprint: str, identity: str, binding: str) -> str:
    return hmac.digest(
        key, f"cosmetic-v1:{fingerprint}:{identity}:{binding}".encode(), "sha256"
    ).hex()


def get_native_cosmetics() -> dict[str, object]:
    """Attach private artwork proofs to the independently validated MetaSave view."""
    key = _host_key()
    snapshot = None

    def catalog() -> tuple[InstalledCosmeticMetadata, ...] | None:
        nonlocal snapshot
        snapshot = native_cosmetic_catalog() if key is not None else None
        return snapshot[0] if snapshot is not None else discover_cosmetic_presentation_catalog()

    response = get_cosmetics(catalog_loader=catalog)
    view = response.get("cosmetics")
    if key is not None and snapshot is not None and isinstance(view, dict):
        _, revision, mappings = snapshot
        fingerprint = view["fingerprint"]
        proofs = {}
        for identity, (filename, png_revision) in mappings.items():
            binding = f"{revision}:{filename}:{png_revision}"
            proofs[identity] = f"{binding}:{_signature(key, fingerprint, identity, binding)}"
        view["artworkProofs"] = proofs
    return response


def get_native_cosmetic_artwork(fingerprint: str, proof: str, identity: str) -> dict[str, object]:
    """Accept only a host-authenticated installed mapping for the current MetaSave."""
    unavailable: dict[str, object] = {"ok": True, "artwork": None}
    key = _host_key()
    if (
        key is None
        or not _hex(fingerprint, 64)
        or len(proof) != 227
        or not (1 <= len(identity) <= 4 and identity.isascii() and identity.isdecimal())
    ):
        return unavailable
    cosmetic_id = int(identity)
    if str(cosmetic_id) != identity or cosmetic_id >= MAX_IDENTITIES:
        return unavailable
    parts = proof.split(":")
    if len(parts) != 4 or not all(
        _hex(part, length) for part, length in zip(parts, (64, 32, 64, 64), strict=True)
    ):
        return unavailable
    revision, filename, png_revision, signature = parts
    if not hmac.compare_digest(
        signature, _signature(key, fingerprint, identity, ":".join(parts[:3]))
    ):
        return unavailable
    try:
        path = _meta_path(None)
        if sha256(read_save_bytes(path)).hexdigest() != fingerprint:
            return unavailable
        png = read_bound_cosmetic_png(revision, filename, png_revision)
        if png is None or len(png) < 57 or not png.startswith(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR"):
            return unavailable
        width, height = struct.unpack_from(">II", png, 16)
        if not (0 < width <= 2048 and 0 < height <= 2048 and width * height <= 1024 * 1024):
            return unavailable
        if sha256(read_save_bytes(path)).hexdigest() != fingerprint:
            return unavailable
    except (DesktopSaveError, OSError, ValueError):
        return unavailable
    return {
        "ok": True,
        "artwork": {
            "cosmeticId": cosmetic_id,
            "sourceIdentity": revision,
            "width": width,
            "height": height,
            "pngBase64": base64.b64encode(png).decode("ascii"),
        },
    }


__all__ = ["get_cosmetic_artwork", "serialize_cosmetic_artwork"]
