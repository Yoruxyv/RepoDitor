"""Narrow Unity object relationships needed for installed material-texture fallbacks.

This module intentionally supports only the validated Unity 2022.3 serialized layouts
used by RepoDitor's local presentation fallback. It is not a general asset extractor.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Final

from repo_save_editor.services.texture_codec import MAX_TEXTURE_DIMENSION, top_mip_size
from repo_save_editor.services.unity_serialized import (
    GAME_OBJECT_CLASS_ID,
    MATERIAL_CLASS_ID,
    MESH_RENDERER_CLASS_ID,
    TEXTURE2D_CLASS_ID,
    TRANSFORM_CLASS_ID,
    ObjectRecord,
    PPtr,
    SerializedFileIndex,
    UnityMetadataError,
    read_pptr,
)

MAX_COMPONENTS: Final = 4_096
MAX_TRANSFORM_CHILDREN: Final = 4_096
MAX_RENDERER_MATERIALS: Final = 64
MAX_RENDERER_BYTES: Final = 2 * 1024 * 1024
MAX_MATERIAL_BYTES: Final = 2 * 1024 * 1024
MAX_PLATFORM_BLOB_BYTES: Final = 16 * 1024 * 1024
DXT_FORMATS: Final = {10: "DXT1", 12: "DXT5"}


@dataclass(frozen=True, slots=True)
class GameObjectData:
    name: str
    components: tuple[PPtr, ...]


@dataclass(frozen=True, slots=True)
class TransformData:
    game_object: PPtr
    children: tuple[PPtr, ...]


@dataclass(frozen=True, slots=True)
class Texture2DMetadata:
    path_id: int
    name: str
    width: int
    height: int
    texture_format: str
    mip_count: int
    stream_path: str
    stream_offset: int
    stream_size: int
    inline_data_size: int
    top_mip_size: int


def read_game_object_name(index: SerializedFileIndex, record: ObjectRecord) -> str:
    if record.class_id != GAME_OBJECT_CLASS_ID:
        raise UnityMetadataError("Expected a GameObject record.")
    reader = index.object_reader(record)
    component_count = reader.i32()
    if not 0 <= component_count <= MAX_COMPONENTS:
        raise UnityMetadataError("GameObject component count is outside the supported bound.")
    reader.skip(component_count * 12)
    reader.i32()  # m_Layer
    return reader.aligned_string()


def parse_game_object(index: SerializedFileIndex, record: ObjectRecord) -> GameObjectData:
    if record.class_id != GAME_OBJECT_CLASS_ID:
        raise UnityMetadataError("Expected a GameObject record.")
    reader = index.object_reader(record)
    component_count = reader.i32()
    if not 0 <= component_count <= MAX_COMPONENTS:
        raise UnityMetadataError("GameObject component count is outside the supported bound.")
    components = tuple(read_pptr(reader) for _ in range(component_count))
    if any(pointer.file_id != 0 or pointer.path_id == 0 for pointer in components):
        raise UnityMetadataError("GameObject contains an unsupported or null component pointer.")
    reader.i32()  # m_Layer
    name = reader.aligned_string()
    if not name:
        raise UnityMetadataError("Matched prefab GameObject has no name.")
    return GameObjectData(name, components)


def parse_transform(index: SerializedFileIndex, record: ObjectRecord) -> TransformData:
    if record.class_id != TRANSFORM_CLASS_ID:
        raise UnityMetadataError("Expected a Transform record.")
    reader = index.object_reader(record)
    game_object = read_pptr(reader)
    if game_object.file_id != 0 or game_object.path_id == 0:
        raise UnityMetadataError("Transform contains an unsupported GameObject pointer.")
    # m_LocalRotation (4 floats), m_LocalPosition (3), m_LocalScale (3).
    reader.skip(40)
    child_count = reader.i32()
    if not 0 <= child_count <= MAX_TRANSFORM_CHILDREN:
        raise UnityMetadataError("Transform child count is outside the supported bound.")
    children = tuple(read_pptr(reader) for _ in range(child_count))
    if any(pointer.file_id != 0 or pointer.path_id == 0 for pointer in children):
        raise UnityMetadataError("Transform contains an unsupported child pointer.")
    return TransformData(game_object, children)


def renderer_materials(
    index: SerializedFileIndex,
    record: ObjectRecord,
    *,
    game_object_id: int,
) -> tuple[PPtr, ...]:
    """Resolve the unique local material vector from a validated MeshRenderer."""
    if record.class_id != MESH_RENDERER_CLASS_ID:
        raise UnityMetadataError("Expected an evidence-backed MeshRenderer record.")
    if record.byte_size <= 0 or record.byte_size > MAX_RENDERER_BYTES:
        raise UnityMetadataError("MeshRenderer record size is outside the supported bound.")
    reader = index.object_reader(record)
    game_object = read_pptr(reader)
    if game_object != PPtr(0, game_object_id):
        raise UnityMetadataError("MeshRenderer does not point back to its GameObject.")

    candidates: list[tuple[PPtr, ...]] = []
    start = record.byte_start
    end = start + record.byte_size
    for absolute in range((start + 3) & ~3, end - 3, 4):
        pointers = index.read_pptr_vector(record, absolute, maximum=MAX_RENDERER_MATERIALS)
        if pointers is None:
            continue
        if any(pointer.file_id != 0 or pointer.path_id == 0 for pointer in pointers):
            continue
        try:
            resolved = index.find_records({pointer.path_id for pointer in pointers})
        except UnityMetadataError:
            continue
        if all(resolved[pointer.path_id].class_id == MATERIAL_CLASS_ID for pointer in pointers):
            if pointers not in candidates:
                candidates.append(pointers)
    if len(candidates) != 1:
        raise UnityMetadataError("MeshRenderer material relationship is missing or ambiguous.")
    return candidates[0]


def material_main_texture(
    index: SerializedFileIndex,
    record: ObjectRecord,
) -> PPtr:
    """Resolve the unique `_MainTex` Texture2D pointer without parsing unrelated properties."""
    if record.class_id != MATERIAL_CLASS_ID:
        raise UnityMetadataError("Expected a Material record.")
    if record.byte_size <= 0 or record.byte_size > MAX_MATERIAL_BYTES:
        raise UnityMetadataError("Material record size is outside the supported bound.")
    raw = index.object_reader(record).bytes(record.byte_size)
    key = b"\x08\x00\x00\x00_MainTex"
    # The aligned string is 12 bytes exactly (4-byte length + 8 ASCII bytes).
    matches: list[PPtr] = []
    cursor = 0
    while True:
        position = raw.find(key, cursor)
        if position < 0:
            break
        pointer_offset = position + len(key)
        if pointer_offset + 12 <= len(raw):
            file_id, path_id = struct.unpack_from("<iq", raw, pointer_offset)
            pointer = PPtr(file_id, path_id)
            if file_id != 0 or path_id == 0:
                cursor = position + 1
                continue
            try:
                texture = index.find_records({path_id})[path_id]
            except UnityMetadataError:
                cursor = position + 1
                continue
            if texture.class_id == TEXTURE2D_CLASS_ID and pointer not in matches:
                matches.append(pointer)
        cursor = position + 1
    if len(matches) != 1:
        raise UnityMetadataError("Material `_MainTex` relationship is missing or ambiguous.")
    return matches[0]


def parse_texture2d(index: SerializedFileIndex, record: ObjectRecord) -> Texture2DMetadata:
    """Parse only the proven Unity 2022.3 Texture2D metadata layout."""
    if record.class_id != TEXTURE2D_CLASS_ID:
        raise UnityMetadataError("Material texture pointer does not resolve to Texture2D.")
    reader = index.object_reader(record)
    name = reader.aligned_string()

    # Unity 2022.3 serializes two fallback fields before the image dimensions:
    # m_ForcedFallbackFormat (int) followed by two boolean flags and alignment.
    # These fields are presentation metadata only, but consuming them is required to
    # reach the evidence-backed width/height/format layout used by this fallback.
    reader.i32()  # m_ForcedFallbackFormat
    fallback_flags = (reader.u8(), reader.u8())
    if any(flag not in (0, 1) for flag in fallback_flags):
        raise UnityMetadataError("Texture2D fallback metadata is malformed.")
    reader.align4()

    width = reader.i32()
    height = reader.i32()
    complete_image_size = reader.i32()
    mips_stripped = reader.i32()
    texture_format_id = reader.i32()
    mip_count = reader.i32()
    texture_format = DXT_FORMATS.get(texture_format_id)
    if texture_format is None:
        raise UnityMetadataError("Texture2D format is not an evidence-backed DXT1/DXT5 format.")
    if (
        not name
        or width <= 0
        or height <= 0
        or width > MAX_TEXTURE_DIMENSION
        or height > MAX_TEXTURE_DIMENSION
        or complete_image_size <= 0
        or mips_stripped < 0
        or not 1 <= mip_count <= 32
    ):
        raise UnityMetadataError("Texture2D dimensions or mip metadata are malformed.")

    boolean_flags = tuple(reader.u8() for _ in range(4))
    if any(flag not in (0, 1) for flag in boolean_flags):
        raise UnityMetadataError("Texture2D boolean metadata is malformed.")
    reader.align4()

    # The validated 2022.3 layout contains three int32 fields between the four
    # boolean flags and m_ImageCount.  Only their placement matters to this narrow
    # parser; the fallback does not consume their semantics.
    reader.skip(12)
    image_count = reader.i32()
    texture_dimension = reader.i32()
    if image_count != 1 or texture_dimension != 2:
        raise UnityMetadataError("Texture2D image/dimension metadata is malformed.")

    # GLTextureSettings: filter, aniso, mip bias, wrap U/V/W.
    reader.skip(24)
    reader.i32()  # m_LightmapFormat
    reader.i32()  # m_ColorSpace
    platform_blob_size = reader.i32()
    if not 0 <= platform_blob_size <= MAX_PLATFORM_BLOB_BYTES:
        raise UnityMetadataError("Texture2D platform blob is outside the supported bound.")
    reader.skip(platform_blob_size)
    reader.align4()

    inline_data_size = reader.i32()
    if inline_data_size != 0:
        raise UnityMetadataError("Inline Texture2D payloads are not supported by this fallback.")
    stream_offset = reader.u64()
    stream_size = reader.u32()
    stream_path = reader.aligned_string()
    required = top_mip_size(width, height, texture_format)
    if stream_offset < 0 or stream_size < required or not stream_path:
        raise UnityMetadataError("Texture2D stream metadata is malformed or truncated.")
    if complete_image_size < required:
        raise UnityMetadataError("Texture2D complete image size is smaller than its top mip.")
    return Texture2DMetadata(
        record.path_id,
        name,
        width,
        height,
        texture_format,
        mip_count,
        stream_path,
        stream_offset,
        stream_size,
        inline_data_size,
        required,
    )


__all__ = [
    "GameObjectData",
    "Texture2DMetadata",
    "material_main_texture",
    "parse_game_object",
    "parse_texture2d",
    "parse_transform",
    "read_game_object_name",
    "renderer_materials",
]
