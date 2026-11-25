"""Read-only artwork projections for trusted desktop hosts; no renderer paths."""

from __future__ import annotations

import base64
import struct
from collections.abc import Mapping
from hashlib import sha256
from pathlib import Path
from typing import cast

from repo_save_editor.desktop_api.protocol import DesktopSaveError
from repo_save_editor.desktop_api.saves.saves import load_discovered_save
from repo_save_editor.services.artwork.baked_artwork import (
    MAX_NATIVE_ITEM_BATCH,
    discover_baked_artwork,
    read_baked_item_pngs,
)
from repo_save_editor.services.artwork.editor_artwork_cache import cached_editor_images
from repo_save_editor.services.game.installed_build import (
    artwork_installation,
    installed_build_identity,
    owned_file,
    validated_installed_artwork_build,
)
from repo_save_editor.services.icon_cache import get_icon_cache_roots
from repo_save_editor.services.items.discovery import discover_item_type_names
from repo_save_editor.services.items.models import AdvancedSaveError
from repo_save_editor.services.player.installed_upgrades import match_upgrade_items
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
    save_id: str, fingerprint: str, key: str, root: Path | None = None, *, persistent: bool = False
) -> dict[str, object]:
    """Read one selected-save upgrade PNG; never return installed paths or write authority."""
    images = _native_upgrade_images(save_id, fingerprint, [key], root, persistent=persistent)
    return {"ok": True, "artwork": images.get(key)}


def get_native_upgrade_artwork_batch(
    save_id: str,
    fingerprint: str,
    keys: list[str],
    root: Path | None = None,
    *,
    persistent: bool = False,
) -> dict[str, object]:
    """Read a bounded upgrade set under one save and asset admission."""
    if not 2 <= len(keys) <= 16 or len(set(keys)) != len(keys):
        return {"ok": False}
    return _bounded_images(
        keys, _native_upgrade_images(save_id, fingerprint, keys, root, persistent=persistent), 2
    )


def _bounded_images(
    keys: list[str], images: Mapping[str, dict[str, str | int] | bool | None], limit_mib: int
) -> dict[str, object]:
    remaining = limit_mib * 1024 * 1024 - 32768  # Leave room for JSON fields and keys.
    artworks: list[object] = []
    for key in keys:
        image = images.get(key)
        if isinstance(image, dict):
            size = len(cast(str, image["pngBase64"]))
            if size > remaining:
                artworks.append(False)  # The host can retry through the single-image lane.
                continue
            remaining -= size
        artworks.append(image)
    return {"ok": True, "artworks": artworks}


def _valid_native_upgrade_key(key: str) -> bool:
    try:
        validate_upgrade_texture_key(key)
    except ValueError:
        return False
    return not any(c in "/\\" or ord(c) < 32 or 127 <= ord(c) <= 159 for c in key)


def _native_upgrade_images(
    save_id: str, fingerprint: str, keys: list[str], root: Path | None, *, persistent: bool
) -> dict[str, dict[str, str | int] | bool | None]:
    try:
        if len(fingerprint) != 64 or any(c not in "0123456789abcdef" for c in fingerprint):
            return {}
        safe = [key for key in keys if _valid_native_upgrade_key(key)]
        if not safe:
            return {}
        _, data, source = load_discovered_save(save_id, root)
        if sha256(source).hexdigest() != fingerprint:
            return {}
        membership = {upgrade.key for upgrade in discover_player_upgrades(data)}
        if any(key not in membership for key in safe):
            try:
                item_types = discover_item_type_names(data)
            except AdvancedSaveError:
                item_types = ()  # Invalid Items data does not block player-upgrade artwork.
            membership.update(match_upgrade_items(membership, item_types).values())
        admitted = tuple(key for key in safe if key in membership)
        if not admitted:
            return {}
        installation = artwork_installation(None)
        if (
            installation is None
            or installation.steam_library_root is None
            or installation.manifest_path is None
        ):
            return {}
        library = installation.steam_library_root
        owned_file(library, installation.manifest_path)
        reviewed = validated_installed_artwork_build(installation)
        build = reviewed or installed_build_identity(installation)
        if build is None:
            return {}

        def extract(requested: tuple[str, ...]) -> dict[str, dict[str, str | int] | None]:
            batch = prepare_installed_upgrade_textures(
                requested, installation, build, presentation=reviewed is None
            )
            images: dict[str, dict[str, str | int] | None] = dict.fromkeys(batch.missing)
            images.update(
                {
                    key: image
                    for key, decoded in batch.textures
                    if key in requested
                    and decoded is not None
                    and (image := _validated_upgrade_image(library, key, decoded)) is not None
                }
            )
            if persistent and artwork_installation(None) != installation:
                return {}
            return images

        images: Mapping[str, dict[str, str | int] | bool | None] = (
            cached_editor_images("upgrade", admitted, extract, expected_root=installation.root)
            if persistent
            else extract(admitted)
        )
        if load_discovered_save(save_id, root)[2] != source:
            return {}
        return dict(images)
    except (DesktopSaveError, OSError, ValueError, OverflowError):
        return {}


def _validated_upgrade_image(
    library: Path, key: str, decoded: DecodedUpgradeTexture
) -> dict[str, str | int] | None:
    if decoded.save_key != key or not (
        0 < len(decoded.png) <= 1024 * 1024
        and 0 < decoded.png_width <= 2048
        and 0 < decoded.png_height <= 2048
        and decoded.png_width * decoded.png_height <= 1024 * 1024
    ):
        return None
    try:
        for watch in decoded.watches:
            info = owned_file(library, watch.path).stat()
            if (info.st_size, info.st_mtime_ns) != (watch.size, watch.mtime_ns):
                return None
        return {
            "upgradeKey": key,
            "sourceIdentity": sha256(
                bytes.fromhex(decoded.source_identity) + decoded.png
            ).hexdigest(),
            "width": decoded.png_width,
            "height": decoded.png_height,
            "pngBase64": base64.b64encode(decoded.png).decode("ascii"),
        }
    except (OSError, ValueError):
        return None


def get_native_item_artwork(
    save_id: str, fingerprint: str, name: str, root: Path | None = None, *, persistent: bool = False
) -> dict[str, object]:
    """Return one installed Item PNG for the selected save. Rust verifies the full image."""
    image = _native_item_images(save_id, fingerprint, [name], root, persistent=persistent).get(name)
    return {
        "ok": True,
        "artwork": image if isinstance(image, dict) else None,
    }


def get_native_item_artwork_batch(
    save_id: str,
    fingerprint: str,
    names: list[str],
    root: Path | None = None,
    *,
    persistent: bool = False,
) -> dict[str, object]:
    if not 2 <= len(names) <= MAX_NATIVE_ITEM_BATCH or len(set(names)) != len(names):
        return {"ok": False}
    images = _native_item_images(save_id, fingerprint, names, root, persistent=persistent)
    return _bounded_images(names, images, 8)


def _valid_native_item(name: str) -> bool:
    return (
        name.startswith("Item ")
        and not name.startswith("Item Upgrade ")
        and 5 < len(name.encode()) < 192
        and not any(c in "/\\" or ord(c) < 32 or 127 <= ord(c) <= 159 for c in name)
    )


def _native_item_images(
    save_id: str, fingerprint: str, names: list[str], root: Path | None, *, persistent: bool
) -> dict[str, dict[str, str | int] | bool | None]:
    try:
        if len(fingerprint) != 64 or any(c not in "0123456789abcdef" for c in fingerprint):
            return {}
        _, data, source = load_discovered_save(save_id, root)
        if sha256(source).hexdigest() != fingerprint:
            return {}
        membership = set(discover_item_type_names(data))
        allowed = tuple(name for name in names if _valid_native_item(name) and name in membership)
        if not allowed:
            return {}
        installation = artwork_installation(None) if persistent else None
        expected_root = installation.root if installation is not None else None
        images = (
            cached_editor_images(
                "item",
                allowed,
                lambda requested: _extract_native_item_images(
                    requested, expected_root=expected_root
                ),
                expected_root=expected_root,
            )
            if expected_root is not None
            else _extract_native_item_images(allowed)
        )
        if load_discovered_save(save_id, root)[2] != source:
            return {}
        return images
    except (AdvancedSaveError, DesktopSaveError, OSError, ValueError, OverflowError):
        return {}


def _extract_native_item_images(
    names: tuple[str, ...],
    *,
    expected_root: Path | None = None,
) -> dict[str, dict[str, str | int] | bool | None]:
    pngs, deferred, missing = read_baked_item_pngs(names, expected_root=expected_root)
    images: dict[str, dict[str, str | int] | bool | None] = dict.fromkeys(missing)
    images.update(dict.fromkeys(deferred, False))
    for name, (png, identity) in pngs.items():
        if not png.startswith(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR") or len(png) < 57:
            images[name] = True
            continue
        width, height = struct.unpack_from(">II", png, 16)
        if not (0 < width <= 2048 and 0 < height <= 2048 and width * height <= 1024 * 1024):
            images[name] = True
            continue
        images[name] = {
            "itemName": name,
            "sourceIdentity": identity,
            "width": width,
            "height": height,
            "pngBase64": base64.b64encode(png).decode("ascii"),
        }
    return images


__all__ = [
    "get_baked_artwork",
    "get_icon_roots",
    "get_native_item_artwork",
    "get_native_upgrade_artwork",
    "get_upgrade_texture",
    "serialize_upgrade_texture",
]
