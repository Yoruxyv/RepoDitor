"""Read-only cosmetic Sprite response for the trusted Electron main process."""

from __future__ import annotations

import base64

from repo_save_editor.services.cosmetics.installed_artwork import (
    CosmeticArtworkError,
    DecodedCosmeticArtwork,
    prepare_installed_cosmetic_artwork,
)

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
    if not value.isascii() or not value.isdecimal() or (value != "0" and value.startswith("0")):
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


__all__ = ["get_cosmetic_artwork", "serialize_cosmetic_artwork"]
