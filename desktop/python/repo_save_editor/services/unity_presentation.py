"""Bounded installed Unity layouts for read-only presentation."""

from __future__ import annotations

import struct
from re import fullmatch
from typing import cast

from repo_save_editor.services.unity_artwork import ArtworkFileIndex
from repo_save_editor.services.unity_serialized import (
    MAX_TYPES,
    MONO_BEHAVIOUR_CLASS_ID,
    TARGET_PLATFORM,
    UNITY_VERSION,
    MonoBehaviourPrefix,
    ObjectRecord,
    PPtr,
    SerializedFileIndex,
    UnityMetadataError,
    _Reader,
)


def is_sunstone_layout(version: str) -> bool:
    """Recognize the Unity release family whose structures the readers validate."""
    return fullmatch(r"6000\.3\.[0-9]{1,3}f[0-9]{1,3}", version) is not None


class _RuntimeReader(_Reader):
    __slots__ = ()

    def skip(self, size: int) -> None:
        if size < 0 or size > self.remaining:
            raise UnityMetadataError("Serialized data is truncated.")
        self.pos += size

    def unpack(self, fmt: str) -> tuple[object, ...]:
        fmt = self.endian + fmt
        start = self.pos
        self.skip(struct.calcsize(fmt))
        return struct.unpack_from(fmt, self._data, start)


class RuntimeFileIndex(ArtworkFileIndex):
    """Keep runtime read optimizations outside the evidence-pinned parser."""

    def _metadata_reader(self) -> tuple[_Reader, int, int]:
        reader, data_offset, metadata_end = super()._metadata_reader()
        return (
            _RuntimeReader(self._data, reader.pos, metadata_end, endian=reader.endian),
            data_offset,
            metadata_end,
        )

    def object_reader(self, record: ObjectRecord) -> _Reader:
        return _RuntimeReader(
            self._data, record.byte_start, record.byte_start + record.byte_size, endian="<"
        )


def read_runtime_mono_prefix(
    index: SerializedFileIndex, record: ObjectRecord
) -> MonoBehaviourPrefix:
    """Read the same bounded MonoBehaviour header using one unpack per PPtr."""
    if record.class_id != MONO_BEHAVIOUR_CLASS_ID:
        raise UnityMetadataError("Expected a MonoBehaviour component record.")
    reader = index.object_reader(record)
    game_file, game_path = cast("tuple[int, int]", reader.unpack("iq"))
    if reader.u8() not in (0, 1):
        raise UnityMetadataError("MonoBehaviour enabled flag is not boolean-like.")
    reader.align4()
    script_file, script_path = cast("tuple[int, int]", reader.unpack("iq"))
    return MonoBehaviourPrefix(
        PPtr(game_file, game_path),
        PPtr(script_file, script_path),
        reader.aligned_string(),
        reader.pos - record.byte_start,
    )


class PresentationFileIndex(RuntimeFileIndex):
    """Share format-22 bounds without expanding the evidence-pinned reader."""

    def __enter__(self) -> PresentationFileIndex:
        return self

    def _parse_types(self, reader: _Reader) -> None:
        self.unity_version = reader.cstring(maximum=64)
        if self.unity_version != UNITY_VERSION and not is_sunstone_layout(self.unity_version):
            raise UnityMetadataError("Unsupported presentation Unity version.")
        if reader.i32() != TARGET_PLATFORM:
            raise UnityMetadataError("Unsupported presentation target platform.")
        enable_type_tree = reader.u8()
        if enable_type_tree not in (0, 1):
            raise UnityMetadataError("Serialized-file type-tree flag is malformed.")
        self.enable_type_tree = bool(enable_type_tree)
        type_count = reader.i32()
        if not 0 < type_count <= MAX_TYPES:
            raise UnityMetadataError("Serialized type count is outside the supported bound.")
        self.types = tuple(
            self._skip_serialized_type(reader, ref_type=False) for _ in range(type_count)
        )
