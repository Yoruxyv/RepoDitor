"""Lazy, fail-soft installed material-albedo fallback for player upgrades."""

from __future__ import annotations

import hashlib
import json
import math
import os
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Final

from repo_save_editor.services.game.discovery import GameInstallation, discover_game_installation
from repo_save_editor.services.game.installed_build import (
    ValidatedInstalledBuild,
    validated_installed_build,
)
from repo_save_editor.services.player.installed_upgrades import upgrade_item_candidates
from repo_save_editor.services.player.upgrades import UPGRADE_PREFIX
from repo_save_editor.services.texture_codec import (
    TextureDecodeError,
    crop_rgba,
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
    MeshVertexData,
    Texture2DMetadata,
    material_main_texture,
    mesh_filter_mesh,
    parse_game_object,
    parse_mesh_stream_metadata,
    parse_mesh_vertex_data,
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
MAX_BATCH_UPGRADES: Final = 64
MAX_BATCH_PNG_BYTES: Final = 16 * 1024 * 1024
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
    png_width: int
    png_height: int
    source_identity: str
    watches: tuple[SourceWatch, ...]


class UpgradePreparationStage(StrEnum):
    """Structured installed-art preparation stages exposed to desktop adapters."""

    DISCOVERING = "discovering"
    VALIDATING = "validating"
    INDEXING = "indexing"
    RESOLVING = "resolving"
    DECODING = "decoding"


@dataclass(frozen=True, slots=True)
class UpgradeTextureBatchResult:
    """Fail-soft result for one bounded installed-upgrade preparation batch."""

    installation_found: bool
    build_verified: bool
    assets_ready: bool
    textures: tuple[tuple[str, DecodedUpgradeTexture | None], ...]


PreparationStageCallback = Callable[[UpgradePreparationStage, bool, bool], None]
PreparationTextureCallback = Callable[[str, DecodedUpgradeTexture | None], None]


@dataclass(frozen=True, slots=True)
class _VisualFraming:
    mesh_path_id: int
    uv_bounds: tuple[float, float, float, float]
    source_path: Path | None = None


@dataclass(frozen=True, slots=True)
class _ResolvedUpgradeVisual:
    texture: Texture2DMetadata
    framing: _VisualFraming | None


def validate_upgrade_texture_key(key: str) -> None:
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
    build: ValidatedInstalledBuild | None = None,
) -> tuple[Path, Path, Path, Path, Path, Path, str]:
    resolved_build = build if build is not None else validated_installed_build(installation)
    if resolved_build is None:
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
        resolved_build.manifest_path.resolve(strict=True),
        resolved_build.build_id,
    )


def _candidate_prefab_names(key: str) -> tuple[str, ...]:
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
        renderers.extend(
            (component_record, record.path_id)
            for component_record in component_records.values()
            if component_record.class_id == MESH_RENDERER_CLASS_ID
        )
        child_transforms = index.find_records({pointer.path_id for pointer in transform.children})
        children = []
        for child_pointer in transform.children:
            child_transform = child_transforms[child_pointer.path_id]
            if child_transform.class_id != TRANSFORM_CLASS_ID:
                raise UnityMetadataError("Transform child pointer has an unsupported class.")
            children.append(parse_transform(index, child_transform))
        child_game_objects = index.find_records({child.game_object.path_id for child in children})
        for child in children:
            child_game_object = child_game_objects[child.game_object.path_id]
            if child_game_object.class_id != GAME_OBJECT_CLASS_ID:
                raise UnityMetadataError("Transform child does not resolve to a GameObject.")
            pending.append(child_game_object)
    if not renderers:
        raise UnityMetadataError("Upgrade prefab contains no MeshRenderer candidates.")
    return tuple(renderers)


def _front_uv_bounds(mesh: MeshVertexData) -> tuple[float, float, float, float]:
    """Resolve the installed mesh's unique outer +Z-facing UV0 panel."""
    if (
        not mesh.positions
        or len(mesh.positions) != len(mesh.normals)
        or len(mesh.positions) != len(mesh.uv0)
    ):
        raise UnityMetadataError("Mesh framing channels have conflicting vertex counts.")
    maximum_z = max(position[2] for position in mesh.positions)
    minimum_z = min(position[2] for position in mesh.positions)
    plane_tolerance = max(1e-5, (maximum_z - minimum_z) * 1e-4)

    front_uvs: list[tuple[float, float]] = []
    for position, normal, uv in zip(mesh.positions, mesh.normals, mesh.uv0, strict=True):
        length = math.sqrt(sum(component * component for component in normal))
        if length <= 1e-6:
            raise UnityMetadataError("Mesh contains a degenerate normal.")
        normal_x, normal_y, normal_z = (component / length for component in normal)
        if (
            normal_z >= 0.9
            and abs(normal_x) <= 0.1
            and abs(normal_y) <= 0.1
            and position[2] >= maximum_z - plane_tolerance
        ):
            front_uvs.append(uv)

    if not 3 <= len(front_uvs) <= 4_096:
        raise UnityMetadataError("Mesh +Z presentation face is missing or ambiguous.")
    if any(not (0.0 <= u <= 1.0 and 0.0 <= v <= 1.0) for u, v in front_uvs):
        raise UnityMetadataError("Mesh presentation UVs are outside the base texture.")

    u_min = min(uv[0] for uv in front_uvs)
    v_min = min(uv[1] for uv in front_uvs)
    u_max = max(uv[0] for uv in front_uvs)
    v_max = max(uv[1] for uv in front_uvs)
    if u_max - u_min <= 1e-6 or v_max - v_min <= 1e-6:
        raise UnityMetadataError("Mesh presentation UV bounds are degenerate.")
    return (u_min, v_min, u_max, v_max)


def _resolve_upgrade_visual_from_indexes(
    managers: SerializedFileIndex,
    resources: SerializedFileIndex,
    names: tuple[str, ...],
    *,
    data_root: Path | None = None,
) -> _ResolvedUpgradeVisual:
    prefab = _find_prefab(managers, resources, names)
    renderers = _find_renderers(resources, prefab)
    textures: dict[int, Texture2DMetadata] = {}
    framings: dict[int, dict[tuple[int, tuple[float, float, float, float]], _VisualFraming]] = {}
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

            try:
                game_object = resources.find_records({game_object_id})[game_object_id]
                mesh_record = mesh_filter_mesh(resources, game_object)
                mesh_stream = parse_mesh_stream_metadata(resources, mesh_record)
                mesh_stream_path: Path | None = None
                mesh_stream_data: bytes | None = None
                if mesh_stream is not None:
                    if data_root is None:
                        raise UnityMetadataError(
                            "Streamed Mesh framing requires the validated data root."
                        )
                    mesh_stream_path, _mesh_stat = _resolve_stream_range(
                        data_root,
                        mesh_stream.path,
                        mesh_stream.offset,
                        mesh_stream.size,
                    )
                    with mesh_stream_path.open("rb") as handle:
                        handle.seek(mesh_stream.offset)
                        mesh_stream_data = handle.read(mesh_stream.size)
                    if len(mesh_stream_data) != mesh_stream.size:
                        raise UpgradeTextureError(
                            "Mesh streamed vertex data could not be read completely."
                        )
                mesh = parse_mesh_vertex_data(
                    resources,
                    mesh_record,
                    stream_data=mesh_stream_data,
                )
                bounds = _front_uv_bounds(mesh)
            except (OSError, UnityMetadataError, UpgradeTextureError):
                continue
            framing = _VisualFraming(mesh.path_id, bounds, mesh_stream_path)
            framings.setdefault(texture.path_id, {})[(mesh.path_id, bounds)] = framing

    if len(textures) != 1:
        raise UnityMetadataError("Upgrade material Texture2D relationship is missing or ambiguous.")
    texture = next(iter(textures.values()))
    matching_framings = tuple(framings.get(texture.path_id, {}).values())
    framing = matching_framings[0] if len(matching_framings) == 1 else None
    return _ResolvedUpgradeVisual(texture, framing)


def _resolve_upgrade_visual(
    resources_path: Path,
    resource_manager_path: Path,
    names: tuple[str, ...],
    *,
    data_root: Path | None = None,
) -> _ResolvedUpgradeVisual:
    with (
        SerializedFileIndex(resource_manager_path) as managers,
        SerializedFileIndex(resources_path) as resources,
    ):
        return _resolve_upgrade_visual_from_indexes(
            managers,
            resources,
            names,
            data_root=data_root,
        )


def _resolve_texture_metadata(
    resources_path: Path,
    resource_manager_path: Path,
    names: tuple[str, ...],
) -> Texture2DMetadata:
    """Compatibility helper returning only installed texture metadata."""
    return _resolve_upgrade_visual(resources_path, resource_manager_path, names).texture


def _uv_crop(
    bounds: tuple[float, float, float, float],
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    u_min, v_min, u_max, v_max = bounds
    left = math.floor(u_min * width)
    right = math.ceil(u_max * width)
    top = math.floor((1.0 - v_max) * height)
    bottom = math.ceil((1.0 - v_min) * height)
    if not (0 <= left < right <= width and 0 <= top < bottom <= height):
        raise UpgradeTextureError("Mesh presentation crop is outside the decoded texture.")
    return (left, top, right, bottom)


def _resolve_stream_range(
    data_root: Path,
    stream_path: str,
    stream_offset: int,
    stream_size: int,
) -> tuple[Path, os.stat_result]:
    raw = stream_path.replace("\\", "/")
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
        raise UpgradeTextureError("Installed stream path is unsafe.")
    candidate = data_root.joinpath(*posix.parts)
    try:
        if candidate.is_symlink():
            raise UpgradeTextureError("Installed stream may not be a symbolic link.")
        resolved = candidate.resolve(strict=True)
        if not _inside(data_root, resolved) or not resolved.is_file():
            raise UpgradeTextureError("Installed stream is outside REPO_Data.")
        stat = resolved.stat()
    except OSError as error:
        raise UpgradeTextureError("Installed stream is unavailable.") from error
    if (
        stream_offset < 0
        or stream_size < 0
        or stream_size > MAX_STREAM_BYTES
        or stream_offset > stat.st_size
        or stream_size > stat.st_size - stream_offset
    ):
        raise UpgradeTextureError("Installed stream range is outside the installed file.")
    return resolved, stat


def _resolve_stream(data_root: Path, metadata: Texture2DMetadata) -> tuple[Path, os.stat_result]:
    return _resolve_stream_range(
        data_root,
        metadata.stream_path,
        metadata.stream_offset,
        metadata.stream_size,
    )


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
    framing: _VisualFraming | None,
    png_width: int,
    png_height: int,
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
        "framing": (
            None
            if framing is None
            else {
                "meshPathId": framing.mesh_path_id,
                "uvBounds": framing.uv_bounds,
            }
        ),
        "output": {"width": png_width, "height": png_height},
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


def _decode_resolved_upgrade_texture(
    key: str,
    visual: _ResolvedUpgradeVisual,
    *,
    data_root: Path,
    resources: Path,
    resource_manager: Path,
    assembly: Path,
    manifest: Path,
    build_id: str,
) -> DecodedUpgradeTexture:
    texture = visual.texture
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
    png_width = texture.width
    png_height = texture.height
    applied_framing = visual.framing
    if applied_framing is not None:
        try:
            left, top, right, bottom = _uv_crop(
                applied_framing.uv_bounds,
                texture.width,
                texture.height,
            )
            rgba, png_width, png_height = crop_rgba(
                rgba,
                texture.width,
                texture.height,
                left,
                top,
                right,
                bottom,
            )
        except (TextureDecodeError, UpgradeTextureError):
            applied_framing = None
            png_width = texture.width
            png_height = texture.height
    png = encode_rgba_png(rgba, png_width, png_height)
    watch_paths = [manifest, assembly, resources, resource_manager, stream]
    if (
        applied_framing is not None
        and applied_framing.source_path is not None
        and applied_framing.source_path not in watch_paths
    ):
        watch_paths.append(applied_framing.source_path)
    watches = tuple(_watch(path) for path in watch_paths)
    source_identity = _source_identity(
        build_id,
        texture,
        applied_framing,
        png_width,
        png_height,
        watches,
        data_root,
    )
    return DecodedUpgradeTexture(
        key,
        texture,
        png,
        png_width,
        png_height,
        source_identity,
        watches,
    )


def prepare_installed_upgrade_textures(
    keys: Iterable[str],
    installation: GameInstallation,
    build: ValidatedInstalledBuild,
    *,
    on_stage: PreparationStageCallback | None = None,
    on_texture: PreparationTextureCallback | None = None,
) -> UpgradeTextureBatchResult:
    """Prepare one bounded upgrade set from an already validated installation.

    Discovery and build validation intentionally live outside this function so a
    future bounded installation source can reuse the same asset-preparation path.
    Individual visual failures resolve to ``None`` and never affect save semantics.
    """
    upgrade_keys = tuple(dict.fromkeys(keys))
    if len(upgrade_keys) > MAX_BATCH_UPGRADES:
        raise UpgradeTextureError("Upgrade preparation batch exceeds the supported bound.")
    for key in upgrade_keys:
        validate_upgrade_texture_key(key)

    def stage(value: UpgradePreparationStage) -> None:
        if on_stage is not None:
            on_stage(value, True, True)

    def resolved(key: str, texture: DecodedUpgradeTexture | None) -> None:
        if on_texture is not None:
            on_texture(key, texture)

    stage(UpgradePreparationStage.INDEXING)
    try:
        (
            _game_root,
            data_root,
            resources_path,
            resource_manager_path,
            assembly,
            manifest,
            build_id,
        ) = _validated_paths(installation, build)
        if not upgrade_keys:
            return UpgradeTextureBatchResult(True, True, True, ())

        with (
            SerializedFileIndex(resource_manager_path) as managers,
            SerializedFileIndex(resources_path) as resources,
        ):
            stage(UpgradePreparationStage.RESOLVING)
            outcomes: dict[str, DecodedUpgradeTexture | None] = {}
            pending: list[tuple[str, _ResolvedUpgradeVisual]] = []
            for key in upgrade_keys:
                try:
                    visual = _resolve_upgrade_visual_from_indexes(
                        managers,
                        resources,
                        _candidate_prefab_names(key),
                        data_root=data_root,
                    )
                except (OSError, UnityMetadataError, UpgradeTextureError, ValueError):
                    outcomes[key] = None
                    resolved(key, None)
                    continue
                pending.append((key, visual))

            stage(UpgradePreparationStage.DECODING)
            png_bytes = 0
            budget_exhausted = False
            for key, visual in pending:
                decoded: DecodedUpgradeTexture | None = None
                if not budget_exhausted:
                    try:
                        candidate = _decode_resolved_upgrade_texture(
                            key,
                            visual,
                            data_root=data_root,
                            resources=resources_path,
                            resource_manager=resource_manager_path,
                            assembly=assembly,
                            manifest=manifest,
                            build_id=build_id,
                        )
                        if png_bytes + len(candidate.png) > MAX_BATCH_PNG_BYTES:
                            budget_exhausted = True
                        else:
                            png_bytes += len(candidate.png)
                            decoded = candidate
                    except (
                        OSError,
                        OverflowError,
                        TextureDecodeError,
                        UnityMetadataError,
                        UpgradeTextureError,
                        ValueError,
                    ):
                        decoded = None
                outcomes[key] = decoded
                resolved(key, decoded)
    except (OSError, OverflowError, UnityMetadataError, UpgradeTextureError, ValueError):
        return UpgradeTextureBatchResult(
            True,
            True,
            False,
            tuple((key, None) for key in upgrade_keys),
        )

    return UpgradeTextureBatchResult(
        True,
        True,
        True,
        tuple((key, outcomes.get(key)) for key in upgrade_keys),
    )


def decode_installed_upgrade_texture(
    key: str,
    game_dir: Path | None = None,
) -> DecodedUpgradeTexture | None:
    """Resolve and decode one upgrade albedo from the user's validated installation.

    Any discovery/layout/security/decoder failure returns ``None``. This presentation-only
    path never affects save opening or mutation authorization.
    """
    try:
        validate_upgrade_texture_key(key)
        discovery = discover_game_installation(game_dir)
        installation = discovery.installation
        if installation is None:
            return None
        build = validated_installed_build(installation)
        if build is None:
            return None
        result = prepare_installed_upgrade_textures((key,), installation, build)
    except (OSError, OverflowError, UpgradeTextureError, ValueError):
        return None
    return result.textures[0][1] if result.textures else None


__all__ = [
    "DecodedUpgradeTexture",
    "SourceWatch",
    "UpgradePreparationStage",
    "UpgradeTextureBatchResult",
    "decode_installed_upgrade_texture",
    "prepare_installed_upgrade_textures",
    "validate_upgrade_texture_key",
]
