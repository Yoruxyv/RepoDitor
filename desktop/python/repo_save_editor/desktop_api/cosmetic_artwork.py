"""Read-only cosmetic artwork for the trusted desktop hosts."""

from __future__ import annotations

import base64
import hmac
import io
import json
import os
import struct
from hashlib import sha256
from importlib import import_module

from repo_save_editor.desktop_api.cosmetics import _meta_path, get_cosmetics
from repo_save_editor.desktop_api.protocol import DesktopSaveError
from repo_save_editor.services.baked_artwork import (
    MAX_IDENTITIES,
    entry_artwork_revision,
    native_cosmetic_catalog,
    read_bound_cosmetic_png,
    read_bound_cosmetic_pngs,
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
from repo_save_editor.services.native_artwork_cache import native_artwork_cache
from repo_save_editor.storage.repository import read_save_bytes

MAX_ID = 2_000
MAX_NATIVE_BATCH = 64
NATIVE_THUMBNAIL_SIDE = 96
# Reserve space for the JSON envelope and each image's fixed metadata in the 2 MiB frame.
NATIVE_BATCH_BASE64_BUDGET = 2 * 1024 * 1024 - 16384


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


def get_native_cosmetics(*, warm_artwork: bool = False) -> dict[str, object]:
    """Attach private artwork proofs to the independently validated MetaSave view."""
    key = _host_key()
    artwork_revision = entry_artwork_revision() if key is not None else None
    snapshot = None
    incompatible = False

    def mark_incompatible() -> None:
        nonlocal incompatible
        incompatible = True

    with native_artwork_cache("initial_catalog" if warm_artwork else "catalog") as cache:

        def catalog() -> tuple[InstalledCosmeticMetadata, ...] | None:
            nonlocal snapshot
            snapshot = (
                native_cosmetic_catalog(
                    cache, warm_artwork=warm_artwork, on_incompatible=mark_incompatible
                )
                if key is not None
                else None
            )
            return snapshot[0] if snapshot is not None else discover_cosmetic_presentation_catalog()

        response = get_cosmetics(catalog_loader=catalog)
    view = response.get("cosmetics")
    if incompatible and isinstance(view, dict) and not view["catalogAvailable"]:
        view["catalogIssue"] = "incompatible"
    if key is not None and snapshot is not None and isinstance(view, dict):
        _, revision, mappings, warm = snapshot
        fingerprint = view["fingerprint"]
        try:
            current = sha256(read_save_bytes(_meta_path(None))).hexdigest()
        except (DesktopSaveError, OSError, ValueError):
            current = None
        if current != fingerprint:
            return {
                "ok": False,
                "error": {"code": "save_stale", "message": "MetaSave changed during validation."},
            }
        if artwork_revision and artwork_revision == entry_artwork_revision():
            view["artworkRevision"] = artwork_revision
        proofs = {}
        for identity, (filename, png_revision) in mappings.items():
            binding = f"{revision}:{filename}:{png_revision}"
            proofs[identity] = f"{binding}:{_signature(key, fingerprint, identity, binding)}"
        view["artworkProofs"] = proofs
        # Leave headroom in the existing 2 MiB sidecar frame for base64 expansion.
        if warm and len(json.dumps(response)) <= 1024 * 1024:
            view["artworkPreviews"] = {
                identity: image
                for identity, png in warm.items()
                if (image := _native_image(int(identity), revision, png)) is not None
            }
    return response


def _native_image(cosmetic_id: int, revision: str, png: bytes | None) -> dict[str, object] | None:
    if png is None or len(png) < 57 or not png.startswith(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR"):
        return None
    width, height = struct.unpack_from(">II", png, 16)
    if not (0 < width <= 2048 and 0 < height <= 2048 and width * height <= 1024 * 1024):
        return None
    if max(width, height) > NATIVE_THUMBNAIL_SIDE:
        # The native catalog displays 48 px thumbnails. Keep 2x density without
        # transferring every full-size installed texture through the sidecar frame.
        try:
            image_module = import_module("PIL.Image")
            with (
                image_module.open(io.BytesIO(png), formats=("PNG",)) as source,
                source.convert("RGBA") as image,
                io.BytesIO() as output,
            ):
                image.thumbnail(
                    (NATIVE_THUMBNAIL_SIDE, NATIVE_THUMBNAIL_SIDE),
                    image_module.Resampling.LANCZOS,
                )
                width, height = image.size
                image.save(output, format="PNG", compress_level=1)
                png = output.getvalue()
        except (ImportError, OSError, ValueError):
            return None
    return {
        "cosmeticId": cosmetic_id,
        "sourceIdentity": revision,
        "width": width,
        "height": height,
        "pngBase64": base64.b64encode(png).decode("ascii"),
    }


def _authenticated_binding(
    key: bytes, fingerprint: str, proof: str, identity: str
) -> tuple[str, str, str] | None:
    if len(proof) != 227 or not (
        1 <= len(identity) <= 4 and identity.isascii() and identity.isdecimal()
    ):
        return None
    cosmetic_id = int(identity)
    if str(cosmetic_id) != identity or cosmetic_id >= MAX_IDENTITIES:
        return None
    parts = proof.split(":")
    if len(parts) != 4 or not all(
        _hex(part, length) for part, length in zip(parts, (64, 32, 64, 64), strict=True)
    ):
        return None
    revision, filename, png_revision, signature = parts
    if not hmac.compare_digest(
        signature, _signature(key, fingerprint, identity, ":".join(parts[:3]))
    ):
        return None
    return revision, filename, png_revision


def get_native_cosmetic_artwork(fingerprint: str, proof: str, identity: str) -> dict[str, object]:
    """Accept only a host-authenticated installed mapping for the current MetaSave."""
    unavailable: dict[str, object] = {"ok": True, "artwork": None}
    key = _host_key()
    if key is None or not _hex(fingerprint, 64):
        return unavailable
    binding = _authenticated_binding(key, fingerprint, proof, identity)
    if binding is None:
        return unavailable
    revision, filename, png_revision = binding
    try:
        path = _meta_path(None)
        if sha256(read_save_bytes(path)).hexdigest() != fingerprint:
            return unavailable
        with native_artwork_cache("thumbnail") as cache:
            png = read_bound_cosmetic_png(
                revision, filename, png_revision, cache=cache, identity=identity
            )
        image = _native_image(int(identity), revision, png)
        if image is None:
            return unavailable
        if sha256(read_save_bytes(path)).hexdigest() != fingerprint:
            return unavailable
    except (DesktopSaveError, OSError, ValueError):
        return unavailable
    return {
        "ok": True,
        "artwork": image,
    }


def get_native_cosmetic_artwork_batch(fingerprint: str, members: list[str]) -> dict[str, object]:
    """Read independently authenticated thumbnails within one bounded native frame."""
    if not 4 <= len(members) <= 2 * MAX_NATIVE_BATCH or len(members) % 2:
        return {"ok": False}
    count = len(members) // 2
    identities = members[1::2]
    if len(set(identities)) != count or not _hex(fingerprint, 64):
        return {"ok": False}
    unavailable: dict[str, object] = {"ok": True, "artworks": [None] * count}
    key = _host_key()
    if key is None:
        return unavailable
    groups: dict[str, list[tuple[str, str, str]]] = {}
    for proof, identity in zip(members[::2], identities, strict=True):
        binding = _authenticated_binding(key, fingerprint, proof, identity)
        if binding is not None:
            revision, filename, png_revision = binding
            groups.setdefault(revision, []).append((identity, filename, png_revision))
    if len(groups) != 1:
        return unavailable
    ((revision, group),) = groups.items()
    try:
        path = _meta_path(None)
        if sha256(read_save_bytes(path)).hexdigest() != fingerprint:
            return unavailable
        # Catalog preparation retains decoded images in the renderer. Avoid cycling the small
        # persistent thumbnail cache through the entire catalog on every cold navigation.
        pngs = read_bound_cosmetic_pngs(revision, group)
        if sha256(read_save_bytes(path)).hexdigest() != fingerprint:
            return unavailable
    except (DesktopSaveError, OSError, ValueError):
        return unavailable
    remaining = NATIVE_BATCH_BASE64_BUDGET
    images: list[object] = []
    for identity in identities:
        png = pngs.get(identity)
        image = _native_image(int(identity), revision, png) if png is not None else None
        if image is not None:
            size = len(str(image["pngBase64"]))
            if size > remaining:
                # A valid image that does not fit can still use the existing single-image lane.
                images.append(False)
                continue
            remaining -= size
        images.append(image)
    return {"ok": True, "artworks": images}


__all__ = ["get_cosmetic_artwork", "serialize_cosmetic_artwork"]
