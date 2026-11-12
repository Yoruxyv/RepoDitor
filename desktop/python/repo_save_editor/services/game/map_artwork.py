"""Bounded loading-Sprite previews from reviewed installed LegacyResources assets.

Map discovery remains independent. This source adapter decodes original Sprites;
it does not render scenes, write game data or own a presentation cache.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import struct
from contextlib import ExitStack
from importlib import import_module
from pathlib import Path
from typing import Any

from repo_save_editor.services.game.installed_build import (
    owned_file,
)
from repo_save_editor.services.game.maps import (
    MAX_MAP_FAMILIES,
    MapCatalog,
    discover_installed_maps,
)
from repo_save_editor.services.unity_artwork import SUNSTONE_UNITY_VERSION, ArtworkFileIndex
from repo_save_editor.services.unity_serialized import (
    MAX_RESOURCE_MANAGER_BYTES,
    RESOURCE_MANAGER_CLASS_ID,
    SERIALIZED_FILE_VERSION,
    ObjectRecord,
    _normalize_resource_keys,
    _Reader,
    _resource_key_matches,
)

MAX_PREVIEW_SIDE = 1024
MAX_NATIVE_BYTES = 512 * 1024 * 1024
MAX_STREAM_BYTES = 16 * 1024 * 1024
MAX_OBJECT_BYTES = 64 * 1024
MAX_PNG_BYTES = 2 * 1024 * 1024
MAX_NATIVE_PNG_BYTES = 1024 * 1024


class _MapSpriteIndex(ArtworkFileIndex):
    """Retain reviewed metadata while selecting native objects for UnityPy."""

    def _parse_types(self, reader: _Reader) -> None:
        super()._parse_types(reader)
        self._type_end = reader.pos

    def native_subset(self, records: tuple[ObjectRecord, ...]) -> bytes:
        """Build an ephemeral format-22 file; preserve original IDs, types and object bytes."""
        if (
            not records
            or len(records) > 2 * MAX_MAP_FAMILIES
            or self._type_end - 48 > MAX_OBJECT_BYTES
        ):
            raise ValueError("Native loading-art subset exceeds its metadata bound.")
        ids = {r.path_id for r in records}
        if len(ids) != len(records) or self.find_records(ids) != {r.path_id: r for r in records}:
            raise ValueError("Native loading-art subset has invalid source records.")
        metadata = bytearray(self._data[48 : self._type_end])
        metadata.extend(struct.pack("<i", len(records)))
        metadata.extend(b"\0" * (-len(metadata) % 4))
        payload = bytearray()
        for record in records:
            if (
                record.class_id not in (28, 213)
                or not 0 < record.byte_size <= MAX_OBJECT_BYTES
                or self.types.count(record.class_id) != 1
            ):
                raise ValueError("Unsupported native loading-art object or type.")
            payload.extend(b"\0" * (-len(payload) % 8))
            metadata.extend(
                struct.pack(
                    "<qqIi",
                    record.path_id,
                    len(payload),
                    record.byte_size,
                    self.types.index(record.class_id),
                )
            )
            payload.extend(self.object_reader(record).bytes(record.byte_size))
        # Only native, local references are admitted; no script, external or ref-type tables are needed.
        metadata.extend(struct.pack("<iii", 0, 0, 0) + b"\0")
        data_offset = (48 + len(metadata) + 15) & ~15
        header = struct.pack(
            ">IIIIB3sIqqq",
            0,
            0,
            SERIALIZED_FILE_VERSION,
            0,
            0,
            b"\0" * 3,
            len(metadata),
            data_offset + len(payload),
            data_offset,
            0,
        )
        return header + metadata + b"\0" * (data_offset - 48 - len(metadata)) + payload


def _native_environment(
    manager: ArtworkFileIndex, index: _MapSpriteIndex, asset_paths: tuple[str, ...]
) -> Any:
    """Let UnityPy parse the admitted Sprites before selecting their local texture descriptors."""
    selected = {}
    for asset_path in asset_paths:
        try:
            record = _loading_sprite_record(manager, index, asset_path)
            selected[record.path_id] = record
        except (ValueError, KeyError):
            continue
    if not selected:
        return None
    unity = import_module("UnityPy")
    sprites = unity.load(io.BytesIO(index.native_subset(tuple(selected.values()))))
    for record in tuple(selected.values()):
        try:
            sprite = sprites.file.objects[record.path_id].parse_as_object()
            pointer = sprite.m_RD.texture
            if pointer.m_FileID != 0 or pointer.m_PathID == 0:
                continue
            texture = index.find_records({pointer.m_PathID})[pointer.m_PathID]
            if texture.class_id == 28 and 0 < texture.byte_size <= MAX_OBJECT_BYTES:
                selected[texture.path_id] = texture
        except (ValueError, KeyError, IndexError, TypeError, AttributeError):
            continue
    return unity.load(io.BytesIO(index.native_subset(tuple(selected.values()))))


def _watch(root: Path, path: Path) -> dict[str, str]:
    info = owned_file(root, path).stat()
    return {
        "path": str(path),
        "size": str(info.st_size),
        "mtimeNs": str(info.st_mtime_ns),
        "device": str(info.st_dev),
        "inode": str(info.st_ino),
        "ctimeNs": str(info.st_ctime_ns),
    }


def _preview(sprite: Any, texture: Any) -> tuple[bytes, int, int]:
    """Use UnityPy's authored Sprite crop/mask/orientation, then reduce for display."""
    rect = sprite.m_RD.textureRect
    if not all(math.isfinite(v) for v in (rect.x, rect.y, rect.width, rect.height)) or not (
        0 <= rect.x < rect.x + rect.width <= texture.m_Width
        and 0 <= rect.y < rect.y + rect.height <= texture.m_Height
    ):
        raise ValueError("Loading Sprite crop is outside its texture.")
    with sprite.image as native, native.convert("RGBA") as picture:
        with picture.getchannel("A") as alpha:
            if alpha.getbbox() is None:
                raise ValueError("Loading Sprite is fully transparent.")
        image_module = import_module("PIL.Image")
        picture.thumbnail((MAX_PREVIEW_SIDE, MAX_PREVIEW_SIDE), image_module.Resampling.LANCZOS)
        with io.BytesIO() as output:
            picture.save(output, format="PNG")
            png = output.getvalue()
        if len(png) > MAX_PNG_BYTES:
            raise ValueError("Map preview exceeds its output bound.")
        return png, picture.width, picture.height


def artwork_sources(catalog: MapCatalog) -> tuple[Path, ...]:
    """Only the reviewed native roster can authorize loading-Sprite previews."""
    if not catalog.source_paths:
        return ()
    data = catalog.path.parent
    return (
        *catalog.source_paths,
        data / "globalgamemanagers",
        data / "resources.assets",
        data / "resources.assets.resS",
    )


def _watches(catalog: MapCatalog) -> list[dict[str, str]]:
    sources = artwork_sources(catalog)
    if not sources:
        return []
    library = catalog.path.parents[4]
    return [_watch(library, p) for p in sources]


def artwork_revision(catalog: MapCatalog) -> str | None:
    """Bind registry/cache entries to all eight inputs without decoding images."""
    try:
        watches = _watches(catalog)
    except (OSError, ValueError):
        return None
    return _revision(watches) if watches else None


def _revision(watches: list[dict[str, str]]) -> str:
    return hashlib.sha256(
        json.dumps(["map-sprite-v1", watches], sort_keys=True).encode()
    ).hexdigest()


def decode_map_artwork(
    *, family: str | None = None, expected_revision: str | None = None
) -> dict[str, object]:
    """Decode a finite installed-map batch in one process; optional sources fail soft."""
    try:
        catalog = discover_installed_maps()
        if catalog is None or not catalog.source_paths:
            return {}
        return _decode(catalog, family=family, expected_revision=expected_revision)
    except (OSError, ValueError, KeyError, IndexError, TypeError, AttributeError, ImportError):
        return {}


def _decode(
    catalog: MapCatalog, *, family: str | None = None, expected_revision: str | None = None
) -> dict[str, object]:
    paths = artwork_sources(catalog)
    watches = _watches(catalog)
    if paths[-2].stat().st_size > MAX_NATIVE_BYTES:
        raise ValueError("Map serialized input exceeds its bound.")
    identity = _revision(watches)
    if expected_revision is not None and identity != expected_revision:
        return {}
    maps = tuple(
        m for m in catalog.maps if m.loading_paths and (family is None or family == m.internal_name)
    )
    if not maps or (family is not None and len(maps) != 1):
        return {}
    result: dict[str, object] = {}
    total = 0
    with ExitStack() as stack:
        manager = stack.enter_context(ArtworkFileIndex(paths[-3]))
        index = _MapSpriteIndex(paths[-2])
        stack.enter_context(index)
        if (
            index.unity_version != SUNSTONE_UNITY_VERSION
            or manager.unity_version != SUNSTONE_UNITY_VERSION
        ):
            raise ValueError("Unsupported loading-art source version.")
        # Avoid materializing millions of unrelated UnityPy ObjectReaders from the installed file.
        asset_paths = tuple(m.loading_paths[0] for m in maps)
        env = _native_environment(manager, index, asset_paths)
        if env is None:
            return {}
        stream_handle = stack.enter_context(paths[-1].open("rb"))
        env.register_cab(
            paths[-1].name, import_module("UnityPy.streams").EndianBinaryReader(stream_handle)
        )
        for game_map in maps:
            asset_path = game_map.loading_paths[0]
            try:
                png, width, height = _decode_sprite(manager, index, env, asset_path, paths[-1])
            except (ValueError, KeyError, IndexError, TypeError, AttributeError):
                continue
            finally:
                # This environment belongs to one finite batch; retain at most one source texture.
                for picture in env.file._cache.values():
                    picture.close()
                env.file._cache.clear()
            if family is not None and len(png) > MAX_NATIVE_PNG_BYTES:
                continue
            total += len(png)
            if total > 8 * 1024 * 1024:
                break
            result[game_map.internal_name] = {
                "sourceIdentity": identity,
                "pngBase64": base64.b64encode(png).decode("ascii"),
                "width": width,
                "height": height,
                "watches": watches,
            }
    if watches != _watches(catalog):
        raise ValueError("Installed loading artwork changed during decoding.")
    return result


def _loading_sprite_record(
    manager: ArtworkFileIndex, index: ArtworkFileIndex, asset_path: str
) -> ObjectRecord:
    managers = tuple(manager.iter_records(frozenset({RESOURCE_MANAGER_CLASS_ID})))
    if len(managers) != 1 or not 0 < managers[0].byte_size <= MAX_RESOURCE_MANAGER_BYTES:
        raise ValueError("Loading ResourceManager is missing, ambiguous or oversized.")
    key, raw = _normalize_resource_keys([asset_path.lower()])[0]
    candidates = []
    for _, pointer in _resource_key_matches(manager, managers[0], key, raw):
        if manager.external_names(pointer.file_id) != ("resources.assets",):
            raise ValueError("Unexpected loading-art serialized dependency.")
        record = index.find_records({pointer.path_id})[pointer.path_id]
        if record.class_id == 213:
            candidates.append(record)
    if len(candidates) != 1 or candidates[0].byte_size > MAX_OBJECT_BYTES:
        raise ValueError("Loading Sprite is missing, ambiguous or oversized.")
    return candidates[0]


def _decode_sprite(
    manager: ArtworkFileIndex, index: ArtworkFileIndex, env: Any, asset_path: str, stream_path: Path
) -> tuple[bytes, int, int]:
    record = _loading_sprite_record(manager, index, asset_path)
    sprite = env.file.objects[record.path_id].parse_as_object()
    rd = sprite.m_RD
    if (
        sprite.m_Name != asset_path.rsplit("/", 1)[-1]
        or sprite.m_SpriteAtlas
        or sprite.m_AtlasTags
        or rd.alphaTexture
        or rd.texture.m_FileID != 0
    ):
        raise ValueError("Unsupported loading Sprite dependencies.")
    record = index.find_records({rd.texture.m_PathID})[rd.texture.m_PathID]
    if record.class_id != 28 or record.byte_size > MAX_OBJECT_BYTES:
        raise ValueError("Unsupported loading texture object.")
    texture = rd.texture.deref_parse_as_object()
    if (
        texture.m_TextureFormat != 12
        or texture.m_MipCount != 1
        or not (0 < texture.m_Width <= 4096 and 0 < texture.m_Height <= 4096)
    ):
        raise ValueError("Unsupported loading texture format or dimensions.")
    stream = texture.m_StreamData
    if (
        stream.path != stream_path.name
        or not 0 < stream.size <= MAX_STREAM_BYTES
        or stream.offset < 0
        or stream.offset + stream.size > stream_path.stat().st_size
    ):
        raise ValueError("Unsupported loading texture stream range.")
    return _preview(sprite, texture)
