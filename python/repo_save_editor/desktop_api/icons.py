"""Trusted local icon-cache roots for Electron main only."""

from __future__ import annotations

import base64

from repo_save_editor.services.icon_cache import get_icon_cache_roots
from repo_save_editor.services.player.upgrade_textures import (
    DecodedUpgradeTexture,
    decode_installed_upgrade_texture,
)


def get_icon_roots() -> dict[str, object]:
    """Return fixed optional icon roots without exposing them to the renderer."""
    roots = get_icon_cache_roots()
    return {
        "ok": True,
        "roots": (
            None if roots is None else {"item": str(roots.items), "cosmetic": str(roots.cosmetics)}
        ),
    }


def serialize_upgrade_texture(decoded: DecodedUpgradeTexture) -> dict[str, object]:
    """Serialize one decoded visual for the trusted Electron-main boundary."""
    texture = decoded.texture
    return {
        "sourceIdentity": decoded.source_identity,
        "pngBase64": base64.b64encode(decoded.png).decode("ascii"),
        "width": decoded.png_width,
        "height": decoded.png_height,
        "textureName": texture.name,
        "textureFormat": texture.texture_format,
        "mipCount": texture.mip_count,
        "streamSize": texture.stream_size,
        "topMipSize": texture.top_mip_size,
        "watches": [
            {
                "path": str(watch.path),
                "size": str(watch.size),
                "mtimeNs": str(watch.mtime_ns),
            }
            for watch in decoded.watches
        ],
    }


def get_upgrade_texture(save_key: str) -> dict[str, object]:
    """Return one bounded decoded local albedo for Electron main, never a renderer path."""
    decoded = decode_installed_upgrade_texture(save_key)
    return {
        "ok": True,
        "texture": None if decoded is None else serialize_upgrade_texture(decoded),
    }


__all__ = ["get_icon_roots", "get_upgrade_texture", "serialize_upgrade_texture"]
