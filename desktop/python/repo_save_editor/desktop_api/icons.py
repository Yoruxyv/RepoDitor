"""Read-only artwork projections for trusted desktop hosts; no renderer paths."""

from __future__ import annotations

import base64
import struct
from hashlib import sha256
from pathlib import Path

from repo_save_editor.desktop_api.protocol import DesktopSaveError
from repo_save_editor.desktop_api.saves import load_discovered_save
from repo_save_editor.services.baked_artwork import discover_baked_artwork, read_baked_item_png
from repo_save_editor.services.game.installed_build import (
    artwork_installation,
    owned_file,
    validated_installed_artwork_build,
)
from repo_save_editor.services.icon_cache import get_icon_cache_roots
from repo_save_editor.services.items.discovery import discover_item_type_names
from repo_save_editor.services.items.models import AdvancedSaveError
from repo_save_editor.services.player.upgrade_textures import (
    DecodedUpgradeTexture,
    decode_installed_upgrade_texture,
    prepare_installed_upgrade_textures,
    validate_upgrade_texture_key,
)
from repo_save_editor.services.player.upgrades import discover_player_upgrades


def get_baked_artwork() -> dict[str, object]:
    """Return optional verified mappings for Electron main; never renderer paths."""
    return {"ok": True, "artwork": discover_baked_artwork()}


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


def get_native_upgrade_artwork(
    save_id: str, fingerprint: str, key: str, root: Path | None = None
) -> dict[str, object]:
    """Read one selected-save upgrade PNG; never return installed paths or write authority."""
    unavailable: dict[str, object] = {"ok": True, "artwork": None}
    try:
        if len(fingerprint) != 64 or any(c not in "0123456789abcdef" for c in fingerprint):
            return unavailable
        validate_upgrade_texture_key(key)
        if any(c in "/\\" or ord(c) < 32 or 127 <= ord(c) <= 159 for c in key):
            return unavailable
        _, data, source = load_discovered_save(save_id, root)
        if sha256(source).hexdigest() != fingerprint or key not in {
            upgrade.key for upgrade in discover_player_upgrades(data)
        }:
            return unavailable
        installation = artwork_installation(None)
        if (
            installation is None
            or installation.steam_library_root is None
            or installation.manifest_path is None
        ):
            return unavailable
        library = installation.steam_library_root
        owned_file(library, installation.manifest_path)
        build = validated_installed_artwork_build(installation)
        if build is None:
            return unavailable
        batch = prepare_installed_upgrade_textures((key,), installation, build)
        decoded = batch.textures[0][1] if batch.textures else None
        if decoded is None or not (
            0 < len(decoded.png) <= 1024 * 1024
            and 0 < decoded.png_width <= 2048
            and 0 < decoded.png_height <= 2048
            and decoded.png_width * decoded.png_height <= 1024 * 1024
        ):
            return unavailable
        if load_discovered_save(save_id, root)[2] != source:
            return unavailable
        for watch in decoded.watches:
            info = owned_file(library, watch.path).stat()
            if (info.st_size, info.st_mtime_ns) != (watch.size, watch.mtime_ns):
                return unavailable
        return {
            "ok": True,
            "artwork": {
                "upgradeKey": key,
                "sourceIdentity": sha256(
                    bytes.fromhex(decoded.source_identity) + decoded.png
                ).hexdigest(),
                "width": decoded.png_width,
                "height": decoded.png_height,
                "pngBase64": base64.b64encode(decoded.png).decode("ascii"),
            },
        }
    except (DesktopSaveError, OSError, ValueError, OverflowError):
        return unavailable


def get_native_item_artwork(
    save_id: str, fingerprint: str, name: str, root: Path | None = None
) -> dict[str, object]:
    """Return one installed Item PNG for the selected save. Rust verifies the full image."""
    unavailable: dict[str, object] = {"ok": True, "artwork": None}
    try:
        if (
            len(fingerprint) != 64
            or any(c not in "0123456789abcdef" for c in fingerprint)
            or not name.startswith("Item ")
            or name.startswith("Item Upgrade ")
            or not 5 < len(name.encode()) < 192
            or any(c in "/\\" or ord(c) < 32 or 127 <= ord(c) <= 159 for c in name)
        ):
            return unavailable
        _, data, source = load_discovered_save(save_id, root)
        if sha256(source).hexdigest() != fingerprint or name not in discover_item_type_names(data):
            return unavailable
        artwork = read_baked_item_png(name)
        if artwork is None:
            return unavailable
        png, identity = artwork
        if not png.startswith(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR") or len(png) < 57:
            return unavailable
        width, height = struct.unpack_from(">II", png, 16)
        if not (0 < width <= 2048 and 0 < height <= 2048 and width * height <= 1024 * 1024):
            return unavailable
        if load_discovered_save(save_id, root)[2] != source:
            return unavailable
        return {
            "ok": True,
            "artwork": {
                "itemName": name,
                "sourceIdentity": identity,
                "width": width,
                "height": height,
                "pngBase64": base64.b64encode(png).decode("ascii"),
            },
        }
    except (AdvancedSaveError, DesktopSaveError, OSError, ValueError, OverflowError):
        return unavailable


__all__ = [
    "get_baked_artwork",
    "get_icon_roots",
    "get_native_item_artwork",
    "get_native_upgrade_artwork",
    "get_upgrade_texture",
    "serialize_upgrade_texture",
]
