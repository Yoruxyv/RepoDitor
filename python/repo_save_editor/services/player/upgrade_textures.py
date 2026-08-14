"""Lazy, fail-soft installed material-albedo fallback for player upgrades."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Final

from repo_save_editor.services.game.discovery import GameInstallation, discover_game_installation
from repo_save_editor.services.game.installed_build import validated_installed_build
from repo_save_editor.services.player.installed_upgrades import upgrade_item_candidates
from repo_save_editor.services.player.upgrades import UPGRADE_PREFIX
from repo_save_editor.services.texture_codec import (
    TextureDecodeError,
    decode_texture_rgba,
    encode_rgba_png,
    flip_rgba_vertical,
)
from repo_save_editor.services.unity_serialized import (
    GAME_OBJECT_CLASS_ID,
    MESH_RENDERER_CLASS_ID,
    TRANSFORM_CLASS_ID,
    ObjectRecord,
    SerializedFileIndex,
    UnityMetadataError,
    find_resource_manager_pointer,
)
from repo_save_editor.services.unity_textures import (
    Texture2DMetadata,
    material_main_texture,
    parse_game_object,
    parse_texture2d,
    parse_transform,
    read_game_object_name,
    renderer_materials,
)

RESOURCES_RELATIVE_PATH: Final = Path("REPO_Data/resources.assets")
RESOURCE_MANAGER_RELATIVE_PATH: Final = Path("REPO_Data/globalgamemanagers")
ASSEMBLY_RELATIVE_PATH: Final = Path("REPO_Data/Managed/Assembly-CSharp.dll")
VALIDATED_ASSEMBLY_SHA256: Final = (
    "ce995a182ddc884ea965e87786f1986248d9616300fa825bcc04bca671ee6526"
)
MAX_UPGRADE_KEY_BYTES: Final = 512
MAX_PREFAB_OBJECTS: Final = 512
MAX_STREAM_BYTES: Final = 64 * 1024 * 1024
HASH_CHUNK_BYTES: Final = 1024 * 1024


class UpgradeTextureError(ValueError):
    """Unsupported or malformed optional installed visual metadata."""


@dataclass(frozen=True, slots=True)
class SourceWatch:
    path: Path
    size: int
    mtime_ns: int


@dataclass(frozen=True, slots=True)
class DecodedUpgradeTexture:
    save_key: str
    texture: Texture2DMetadata
    png: bytes
    source_identity: str
    watches: tuple[SourceWatch, ...]


def _validate_upgrade_key(key: str) -> None:
    if (
        not isinstance(key, str)
        or not key.startswith(UPGRADE_PREFIX)
        or key == UPGRADE_PREFIX
        or "\0" in key
        or len(key.encode("utf-8")) > MAX_UPGRADE_KEY_BYTES
    ):
        raise UpgradeTextureError("Upgrade identity is outside the supported bound.")


def _inside(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
    except ValueError:
        return False
    return candidate != root


def _regular_owned_file(root: Path, relative: Path) -> Path:
    candidate = root / relative
    try:
        if candidate.is_symlink():
            raise UpgradeTextureError("Installed source file may not be a symbolic link.")
        resolved = candidate.resolve(strict=True)
        root_resolved = root.resolve(strict=True)
        if not _inside(root_resolved, resolved) or not resolved.is_file():
            raise UpgradeTextureError("Installed source file is outside the validated game root.")
    except OSError as error:
        raise UpgradeTextureError("Installed source file is unavailable.") from error
    return resolved


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            while chunk := handle.read(HASH_CHUNK_BYTES):
                digest.update(chunk)
    except OSError as error:
        raise UpgradeTextureError("Installed managed assembly is unavailable.") from error
    return digest.hexdigest()


def _validated_paths(
    installation: GameInstallation,
) -> tuple[Path, Path, Path, Path, Path, Path, str]:
    build = validated_installed_build(installation)
    if build is None:
        raise UpgradeTextureError("Installed Steam build is not the validated build.")
    try:
        game_root = installation.root.resolve(strict=True)
        data_root = (game_root / "REPO_Data").resolve(strict=True)
    except OSError as error:
        raise UpgradeTextureError("Validated game root is unavailable.") from error
    if not data_root.is_dir() or not _inside(game_root, data_root):
        raise UpgradeTextureError("REPO_Data is outside the validated game root.")

    resources = _regular_owned_file(game_root, RESOURCES_RELATIVE_PATH)
    resource_manager = _regular_owned_file(game_root, RESOURCE_MANAGER_RELATIVE_PATH)
    assembly = _regular_owned_file(game_root, ASSEMBLY_RELATIVE_PATH)
    if _sha256_file(assembly) != VALIDATED_ASSEMBLY_SHA256:
        raise UpgradeTextureError("Installed managed assembly does not match the validated build.")
    return (
        game_root,
        data_root,
        resources,
        resource_manager,
        assembly,
        build.manifest_path.resolve(strict=True),
        build.build_id,
    )


def _candidate_prefab_names(key: str, _game_dir: Path | None) -> tuple[str, ...]:
    # ResourceManager is the authoritative installed prefab map for this visual path.
    # Search only the semantic candidates derived from the dynamic save key, then let
    # the installed m_Container entry choose the unique canonical prefab. This avoids
    # rescanning the entire installed Item catalog for every lazy texture request.
    return upgrade_item_candidates(key)


def _find_prefab(
    managers: SerializedFileIndex,
    resources: SerializedFileIndex,
    names: tuple[str, ...],
) -> ObjectRecord:
    resource_keys = tuple(f"items/{name}".casefold() for name in names)
    matched_key, pointer = find_resource_manager_pointer(managers, resource_keys)
    external_names = {name.casefold() for name in managers.external_names(pointer.file_id)}
    if external_names != {RESOURCES_RELATIVE_PATH.name.casefold()}:
        raise UnityMetadataError("ResourceManager prefab pointer targets an unsupported file.")
    prefab = resources.find_records({pointer.path_id})[pointer.path_id]
    if prefab.class_id != GAME_OBJECT_CLASS_ID:
        raise UnityMetadataError("ResourceManager prefab pointer does not resolve to a GameObject.")
    actual_name = read_game_object_name(resources, prefab)
    expected_name = matched_key.removeprefix("items/")
    if actual_name.casefold() != expected_name:
        raise UnityMetadataError(
            "ResourceManager prefab identity does not match the installed item."
        )
    return prefab


def _find_renderers(
    index: SerializedFileIndex,
    root_record: ObjectRecord,
) -> tuple[tuple[ObjectRecord, int], ...]:
    pending = [root_record]
    visited: set[int] = set()
    renderers: list[tuple[ObjectRecord, int]] = []
    while pending:
        record = pending.pop()
        if record.path_id in visited:
            raise UnityMetadataError("Prefab Transform hierarchy contains a cycle.")
        visited.add(record.path_id)
        if len(visited) > MAX_PREFAB_OBJECTS:
            raise UnityMetadataError("Prefab hierarchy exceeds the supported bound.")
        game_object = parse_game_object(index, record)
        component_records = index.find_records(
            {pointer.path_id for pointer in game_object.components}
        )
        transforms = [
            component_record
            for component_record in component_records.values()
            if component_record.class_id == TRANSFORM_CLASS_ID
        ]
        if len(transforms) != 1:
            raise UnityMetadataError("Prefab GameObject Transform relationship is ambiguous.")
        transform = parse_transform(index, transforms[0])
        if transform.game_object.path_id != record.path_id:
            raise UnityMetadataError("Transform does not point back to its GameObject.")
        for component_record in component_records.values():
            if component_record.class_id == MESH_RENDERER_CLASS_ID:
                renderers.append((component_record, record.path_id))
        child_transforms = index.find_records(
            {pointer.path_id for pointer in transform.children}
        )
        children = []
        for child_pointer in transform.children:
            child_transform = child_transforms[child_pointer.path_id]
            if child_transform.class_id != TRANSFORM_CLASS_ID:
                raise UnityMetadataError("Transform child pointer has an unsupported class.")
            children.append(parse_transform(index, child_transform))
        child_game_objects = index.find_records(
            {child.game_object.path_id for child in children}
        )
        for child in children:
            child_game_object = child_game_objects[child.game_object.path_id]
            if child_game_object.class_id != GAME_OBJECT_CLASS_ID:
                raise UnityMetadataError("Transform child does not resolve to a GameObject.")
            pending.append(child_game_object)
    if not renderers:
        raise UnityMetadataError("Upgrade prefab contains no MeshRenderer candidates.")
    return tuple(renderers)


def _resolve_texture_metadata(
    resources_path: Path,
    resource_manager_path: Path,
    names: tuple[str, ...],
) -> Texture2DMetadata:
    with (
        SerializedFileIndex(resource_manager_path) as managers,
        SerializedFileIndex(resources_path) as resources,
    ):
        prefab = _find_prefab(managers, resources, names)
        renderers = _find_renderers(resources, prefab)
        # A production upgrade prefab can contain many renderers for packaging,
        # colliders, decoration, or equip helpers.  Resolve every bounded renderer
        # relationship and retain only unique supported _MainTex Texture2D chains.
        # Ambiguity is enforced at the final texture identity rather than by assuming
        # the entire prefab contains exactly one MeshRenderer.
        textures: dict[int, Texture2DMetadata] = {}
        for renderer, game_object_id in renderers:
            try:
                materials = renderer_materials(
                    resources,
                    renderer,
                    game_object_id=game_object_id,
                )
            except UnityMetadataError:
                continue

            for material_pointer in materials:
                try:
                    material = resources.find_records({material_pointer.path_id})[
                        material_pointer.path_id
                    ]
                    texture_pointer = material_main_texture(resources, material)
                    texture_record = resources.find_records({texture_pointer.path_id})[
                        texture_pointer.path_id
                    ]
                    texture = parse_texture2d(resources, texture_record)
                except UnityMetadataError:
                    continue
                textures.setdefault(texture.path_id, texture)

        if len(textures) != 1:
            raise UnityMetadataError(
                "Upgrade material Texture2D relationship is missing or ambiguous."
            )
        return next(iter(textures.values()))


def _resolve_stream(data_root: Path, metadata: Texture2DMetadata) -> tuple[Path, os.stat_result]:
    raw = metadata.stream_path.replace("\\", "/")
    posix = PurePosixPath(raw)
    windows = PureWindowsPath(raw)
    if (
        not raw
        or "\0" in raw
        or posix.is_absolute()
        or windows.is_absolute()
        or windows.drive
        or any(part == ".." for part in posix.parts)
        or any(part in ("", ".") for part in posix.parts)
    ):
        raise UpgradeTextureError("Texture stream path is unsafe.")
    candidate = data_root.joinpath(*posix.parts)
    try:
        if candidate.is_symlink():
            raise UpgradeTextureError("Texture stream may not be a symbolic link.")
        resolved = candidate.resolve(strict=True)
        if not _inside(data_root, resolved) or not resolved.is_file():
            raise UpgradeTextureError("Texture stream is outside REPO_Data.")
        stat = resolved.stat()
    except OSError as error:
        raise UpgradeTextureError("Texture stream is unavailable.") from error
    if (
        metadata.stream_offset < 0
        or metadata.stream_size < 0
        or metadata.stream_size > MAX_STREAM_BYTES
        or metadata.stream_offset > stat.st_size
        or metadata.stream_size > stat.st_size - metadata.stream_offset
    ):
        raise UpgradeTextureError("Texture stream range is outside the installed file.")
    return resolved, stat


def _watch(path: Path) -> SourceWatch:
    try:
        stat = path.stat()
    except OSError as error:
        raise UpgradeTextureError("Installed source identity is unavailable.") from error
    if not path.is_file() or stat.st_size < 0 or stat.st_mtime_ns < 0:
        raise UpgradeTextureError("Installed source identity is malformed.")
    return SourceWatch(path, stat.st_size, stat.st_mtime_ns)


def _source_identity(
    build_id: str,
    texture: Texture2DMetadata,
    watches: tuple[SourceWatch, ...],
    data_root: Path,
) -> str:
    sources = []
    for watch in watches:
        try:
            relative = watch.path.relative_to(data_root).as_posix()
        except ValueError:
            relative = watch.path.name
        sources.append({"path": relative, "size": watch.size, "mtimeNs": watch.mtime_ns})
    payload = {
        "buildId": build_id,
        "sources": sources,
        "texture": {
            "pathId": texture.path_id,
            "name": texture.name,
            "width": texture.width,
            "height": texture.height,
            "format": texture.texture_format,
            "mipCount": texture.mip_count,
            "streamPath": texture.stream_path.replace("\\", "/"),
            "streamOffset": texture.stream_offset,
            "streamSize": texture.stream_size,
        },
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def decode_installed_upgrade_texture(
    key: str,
    game_dir: Path | None = None,
) -> DecodedUpgradeTexture | None:
    """Resolve and decode one upgrade albedo from the user's validated installation.

    Any discovery/layout/security/decoder failure returns ``None``. This presentation-only
    path never affects save opening or mutation authorization.
    """
    try:
        _validate_upgrade_key(key)
        discovery = discover_game_installation(game_dir)
        installation = discovery.installation
        if installation is None:
            raise UpgradeTextureError("R.E.P.O. installation is unavailable.")
        (
            _game_root,
            data_root,
            resources,
            resource_manager,
            assembly,
            manifest,
            build_id,
        ) = _validated_paths(installation)
        names = _candidate_prefab_names(key, game_dir)
        texture = _resolve_texture_metadata(resources, resource_manager, names)
        stream, _stream_stat = _resolve_stream(data_root, texture)
        with stream.open("rb") as handle:
            handle.seek(texture.stream_offset)
            compressed = handle.read(texture.top_mip_size)
        if len(compressed) != texture.top_mip_size:
            raise UpgradeTextureError("Texture top mip could not be read completely.")
        rgba = decode_texture_rgba(
            compressed,
            texture.width,
            texture.height,
            texture.texture_format,
        )
        rgba = flip_rgba_vertical(rgba, texture.width, texture.height)
        png = encode_rgba_png(rgba, texture.width, texture.height)
        watches = (
            _watch(manifest),
            _watch(assembly),
            _watch(resources),
            _watch(resource_manager),
            _watch(stream),
        )
        source_identity = _source_identity(build_id, texture, watches, data_root)
        return DecodedUpgradeTexture(key, texture, png, source_identity, watches)
    except (
        OSError,
        OverflowError,
        TextureDecodeError,
        UnityMetadataError,
        UpgradeTextureError,
        ValueError,
    ):
        return None


__all__ = ["DecodedUpgradeTexture", "SourceWatch", "decode_installed_upgrade_texture"]
