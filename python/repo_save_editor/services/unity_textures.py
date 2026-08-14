"""Narrow Unity object relationships needed for installed material-texture fallbacks.

This module intentionally supports only the validated Unity 2022.3 serialized layouts
used by RepoDitor's local presentation fallback. It is not a general asset extractor.
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass
from typing import Final

from repo_save_editor.services.texture_codec import MAX_TEXTURE_DIMENSION, top_mip_size
from repo_save_editor.services.unity_serialized import (
    GAME_OBJECT_CLASS_ID,
    MATERIAL_CLASS_ID,
    MESH_CLASS_ID,
    MESH_FILTER_CLASS_ID,
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
MAX_MESH_BYTES: Final = 2 * 1024 * 1024
MAX_MESH_VERTEX_BYTES: Final = 16 * 1024 * 1024
MAX_MESH_STREAM_PATH_BYTES: Final = 4_096
MAX_MESH_VERTICES: Final = 65_536
MAX_MESH_CHANNELS: Final = 32
MAX_MESH_STREAMS: Final = 8
MAX_PLATFORM_BLOB_BYTES: Final = 16 * 1024 * 1024
DXT_FORMATS: Final = {10: "DXT1", 12: "DXT5"}
_VERTEX_FORMAT_BYTES: Final = {
    0: 4,  # Float32
    1: 2,  # Float16
    2: 1,  # UNorm8
    3: 1,  # SNorm8
    4: 2,  # UNorm16
    5: 2,  # SNorm16
    6: 1,  # UInt8
    7: 1,  # SInt8
    8: 2,  # UInt16
    9: 2,  # SInt16
    10: 4,  # UInt32
    11: 4,  # SInt32
}


@dataclass(frozen=True, slots=True)
class GameObjectData:
    name: str
    components: tuple[PPtr, ...]


@dataclass(frozen=True, slots=True)
class TransformData:
    game_object: PPtr
    children: tuple[PPtr, ...]


@dataclass(frozen=True, slots=True)
class MeshVertexData:
    path_id: int
    positions: tuple[tuple[float, float, float], ...]
    normals: tuple[tuple[float, float, float], ...]
    uv0: tuple[tuple[float, float], ...]


@dataclass(frozen=True, slots=True)
class MeshStreamMetadata:
    path: str
    offset: int
    size: int


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


def mesh_filter_mesh(
    index: SerializedFileIndex,
    game_object_record: ObjectRecord,
) -> ObjectRecord:
    """Resolve the unique local Mesh owned by one renderer GameObject."""
    game_object = parse_game_object(index, game_object_record)
    components = index.find_records({pointer.path_id for pointer in game_object.components})
    filters = [record for record in components.values() if record.class_id == MESH_FILTER_CLASS_ID]
    if len(filters) != 1:
        raise UnityMetadataError(
            "Renderer GameObject MeshFilter relationship is missing or ambiguous."
        )

    reader = index.object_reader(filters[0])
    owner = read_pptr(reader)
    mesh_pointer = read_pptr(reader)
    if owner != PPtr(0, game_object_record.path_id):
        raise UnityMetadataError("MeshFilter does not point back to its GameObject.")
    if mesh_pointer.file_id != 0 or mesh_pointer.path_id == 0:
        raise UnityMetadataError("MeshFilter contains an unsupported Mesh pointer.")
    mesh = index.find_records({mesh_pointer.path_id})[mesh_pointer.path_id]
    if mesh.class_id != MESH_CLASS_ID:
        raise UnityMetadataError("MeshFilter pointer does not resolve to a Mesh.")
    return mesh


def _align16(value: int) -> int:
    return (value + 15) & ~15


def _mesh_stream_candidate(raw: bytes, offset: int, endian: str) -> MeshStreamMetadata | None:
    if offset < 0 or offset + 16 > len(raw):
        return None
    stream_offset, stream_size, path_size = struct.unpack_from(endian + "QIi", raw, offset)
    if not 0 < stream_size <= MAX_MESH_VERTEX_BYTES:
        return None
    if not 0 < path_size <= MAX_MESH_STREAM_PATH_BYTES:
        return None
    path_start = offset + 16
    path_end = path_start + path_size
    padded_end = (path_end + 3) & ~3
    if path_end > len(raw) or padded_end != len(raw):
        return None
    if any(raw[path_end:padded_end]):
        return None
    try:
        path = raw[path_start:path_end].decode("utf-8")
    except UnicodeDecodeError:
        return None
    if not path or "\0" in path or any(ord(character) < 0x20 for character in path):
        return None
    return MeshStreamMetadata(path, stream_offset, stream_size)


def parse_mesh_stream_metadata(
    index: SerializedFileIndex,
    record: ObjectRecord,
) -> MeshStreamMetadata | None:
    """Resolve the optional tail StreamedResource used by Unity 2022.3 Mesh data."""
    if record.class_id != MESH_CLASS_ID:
        raise UnityMetadataError("Expected a Mesh record.")
    if record.byte_size <= 0 or record.byte_size > MAX_MESH_BYTES:
        raise UnityMetadataError("Mesh record size is outside the supported bound.")
    reader = index.object_reader(record)
    raw = reader.bytes(record.byte_size)
    candidates: list[MeshStreamMetadata] = []
    for offset in range(0, max(0, len(raw) - 15), 4):
        candidate = _mesh_stream_candidate(raw, offset, reader.endian)
        if candidate is not None and candidate not in candidates:
            candidates.append(candidate)
    if len(candidates) > 1:
        raise UnityMetadataError("Mesh streamed vertex relationship is ambiguous.")
    return candidates[0] if candidates else None


def _mesh_vertex_candidate(
    raw: bytes,
    offset: int,
    endian: str,
    path_id: int,
    *,
    stream_data: bytes | None,
) -> MeshVertexData | None:
    if offset < 0 or offset + 12 > len(raw):
        return None
    vertex_count, channel_count = struct.unpack_from(endian + "Ii", raw, offset)
    if not 3 <= vertex_count <= MAX_MESH_VERTICES or not 5 <= channel_count <= MAX_MESH_CHANNELS:
        return None

    channels_start = offset + 8
    channels_end = channels_start + channel_count * 4
    if channels_end + 4 > len(raw):
        return None
    channels = [
        tuple(raw[position : position + 4])
        for position in range(channels_start, channels_end, 4)
    ]

    def channel_shape(channel_index: int) -> tuple[int, int]:
        _stream, _channel_offset, format_id, raw_dimension = channels[channel_index]
        return format_id, raw_dimension & 0x0F

    position_format, position_dimension = channel_shape(0)
    normal_format, normal_dimension = channel_shape(1)
    uv_format, uv_dimension = channel_shape(4)
    if (
        position_format != 0
        or position_dimension != 3
        or normal_format not in (0, 1)
        or normal_dimension not in (3, 4)
        or uv_format not in (0, 1)
        or uv_dimension != 2
    ):
        return None

    active = []
    for channel in channels:
        stream, channel_offset, format_id, raw_dimension = channel
        dimension = raw_dimension & 0x0F
        if dimension == 0:
            continue
        component_size = _VERTEX_FORMAT_BYTES.get(format_id)
        if component_size is None or dimension > 4 or stream >= MAX_MESH_STREAMS:
            return None
        active.append((stream, channel_offset, component_size, dimension))
    if not active:
        return None

    stream_count = 1 + max(stream for stream, _offset, _size, _dimension in active)
    stream_offsets: list[int] = []
    stream_strides: list[int] = []
    cursor = 0
    for stream in range(stream_count):
        members = [entry for entry in active if entry[0] == stream]
        if not members:
            return None
        stride = sum(
            component_size * dimension
            for _stream, _offset, component_size, dimension in members
        )
        if stride <= 0 or stride > 255:
            return None
        for _stream, channel_offset, component_size, dimension in members:
            if channel_offset + component_size * dimension > stride:
                return None
        stream_offsets.append(cursor)
        stream_strides.append(stride)
        cursor = _align16(cursor + vertex_count * stride)

    minimum_size = max(
        stream_offsets[stream] + vertex_count * stream_strides[stream]
        for stream in range(stream_count)
    )
    data_size = struct.unpack_from(endian + "i", raw, channels_end)[0]
    if data_size < 0 or data_size > MAX_MESH_VERTEX_BYTES:
        return None
    if data_size == 0:
        if stream_data is None:
            return None
        data = stream_data
    else:
        data_start = channels_end + 4
        data_end = data_start + data_size
        if data_end > len(raw):
            return None
        data = raw[data_start:data_end]
    if len(data) < minimum_size or len(data) > _align16(minimum_size):
        return None

    def read_channel(
        channel_index: int,
        components: int,
    ) -> tuple[tuple[float, ...], ...] | None:
        stream, channel_offset, format_id, raw_dimension = channels[channel_index]
        dimension = raw_dimension & 0x0F
        if format_id not in (0, 1) or dimension < components or stream >= len(stream_offsets):
            return None
        component_size = _VERTEX_FORMAT_BYTES[format_id]
        stride = stream_strides[stream]
        start = stream_offsets[stream] + channel_offset
        item_size = components * component_size
        format_character = "f" if format_id == 0 else "e"
        values: list[tuple[float, ...]] = []
        for vertex in range(vertex_count):
            position = start + vertex * stride
            if position < 0 or position + item_size > len(data):
                return None
            value = tuple(
                float(item)
                for item in struct.unpack_from(
                    endian + (format_character * components), data, position
                )
            )
            if not all(math.isfinite(item) for item in value):
                return None
            values.append(value)
        return tuple(values)

    positions_raw = read_channel(0, 3)
    normals_raw = read_channel(1, 3)
    uv_raw = read_channel(4, 2)
    if positions_raw is None or normals_raw is None or uv_raw is None:
        return None
    positions = tuple((value[0], value[1], value[2]) for value in positions_raw)
    normals = tuple((value[0], value[1], value[2]) for value in normals_raw)
    uv0 = tuple((value[0], value[1]) for value in uv_raw)
    if any(abs(component) > 1_000_000 for value in positions for component in value):
        return None
    if any(
        not 0.25 <= sum(component * component for component in value) <= 2.25
        for value in normals
    ):
        return None
    return MeshVertexData(path_id, positions, normals, uv0)


def parse_mesh_vertex_data(
    index: SerializedFileIndex,
    record: ObjectRecord,
    *,
    stream_data: bytes | None = None,
) -> MeshVertexData:
    """Parse the bounded VertexData needed for installed UV framing."""
    if record.class_id != MESH_CLASS_ID:
        raise UnityMetadataError("Expected a Mesh record.")
    if record.byte_size <= 0 or record.byte_size > MAX_MESH_BYTES:
        raise UnityMetadataError("Mesh record size is outside the supported bound.")
    if stream_data is not None and len(stream_data) > MAX_MESH_VERTEX_BYTES:
        raise UnityMetadataError("Mesh streamed vertex data exceeds the supported bound.")
    reader = index.object_reader(record)
    raw = reader.bytes(record.byte_size)
    candidates: list[MeshVertexData] = []
    for offset in range(0, max(0, len(raw) - 11), 4):
        candidate = _mesh_vertex_candidate(
            raw,
            offset,
            reader.endian,
            record.path_id,
            stream_data=stream_data,
        )
        if candidate is not None:
            candidates.append(candidate)
    if len(candidates) != 1:
        raise UnityMetadataError("Mesh VertexData relationship is missing or ambiguous.")
    return candidates[0]


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
    "MeshVertexData",
    "Texture2DMetadata",
    "material_main_texture",
    "mesh_filter_mesh",
    "parse_game_object",
    "parse_mesh_vertex_data",
    "parse_texture2d",
    "parse_transform",
    "read_game_object_name",
    "renderer_materials",
]
