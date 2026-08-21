"""Narrow read-only primitives for inspected Unity serialized files.

This is not a general Unity asset parser. Unsupported or malformed layouts fail closed,
while Items and Cosmetics retain ownership of their respective metadata semantics.
"""

from __future__ import annotations

import mmap
import struct
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Final, cast

SERIALIZED_FILE_VERSION: Final = 22
UNITY_VERSION: Final = "2022.3.67f2"
TARGET_PLATFORM: Final = 19  # StandaloneWindows64 in the known build
GAME_OBJECT_CLASS_ID: Final = 1
TRANSFORM_CLASS_ID: Final = 4
MATERIAL_CLASS_ID: Final = 21
MESH_RENDERER_CLASS_ID: Final = 23
TEXTURE2D_CLASS_ID: Final = 28
MESH_FILTER_CLASS_ID: Final = 33
MESH_CLASS_ID: Final = 43
RESOURCE_MANAGER_CLASS_ID: Final = 147
MONO_BEHAVIOUR_CLASS_ID: Final = 114
MONO_SCRIPT_CLASS_ID: Final = 115
MAX_TYPES: Final = 16_384
MAX_OBJECTS: Final = 4_000_000
MAX_STRING_BYTES: Final = 16_384
MAX_TYPETREE_NODES: Final = 1_000_000
MAX_TYPETREE_STRINGS: Final = 64 * 1024 * 1024
MAX_RESOURCE_MANAGER_BYTES: Final = 128 * 1024 * 1024
MAX_RESOURCE_KEY_OCCURRENCES: Final = 16
_OBJECT_RECORD = struct.Struct("<qqIi")


class UnityMetadataError(ValueError):
    """Unsupported, incomplete, malformed, or conflicting installed metadata."""


@dataclass(frozen=True, slots=True)
class PPtr:
    """Unity object reference expressed as external file ID and object path ID."""

    file_id: int
    path_id: int


@dataclass(frozen=True, slots=True)
class ObjectRecord:
    """Validated byte range and class identity for one serialized Unity object."""

    path_id: int
    byte_start: int
    byte_size: int
    class_id: int


@dataclass(frozen=True, slots=True)
class ExternalReference:
    """Names recorded for one external serialized-file dependency."""

    asset_path: str
    path: str


@dataclass(frozen=True, slots=True)
class MonoBehaviourPrefix:
    """Common MonoBehaviour header plus the offset where script fields begin."""

    game_object: PPtr
    script: PPtr
    name: str
    field_offset: int


@dataclass(frozen=True, slots=True)
class MonoScriptData:
    """Runtime script identity used to resolve component semantics dynamically."""

    name: str
    class_name: str
    namespace: str
    assembly_name: str


class _Reader:
    __slots__ = ("_data", "_end", "endian", "pos")

    def __init__(
        self,
        data: mmap.mmap,
        start: int,
        end: int,
        *,
        endian: str,
    ) -> None:
        if not (0 <= start <= end <= len(data)):
            raise UnityMetadataError("Reader bounds are outside the file.")
        self._data = data
        self.pos = start
        self._end = end
        self.endian = endian

    @property
    def remaining(self) -> int:
        return self._end - self.pos

    def _take(self, size: int) -> bytes:
        if size < 0 or self.pos + size > self._end:
            raise UnityMetadataError("Serialized data is truncated.")
        start = self.pos
        self.pos += size
        return self._data[start : start + size]

    def skip(self, size: int) -> None:
        self._take(size)

    def align4(self) -> None:
        aligned = (self.pos + 3) & ~3
        if aligned > self._end:
            raise UnityMetadataError("Alignment runs past serialized data.")
        self.pos = aligned

    def unpack(self, fmt: str) -> tuple[object, ...]:
        parser = struct.Struct(self.endian + fmt)
        return parser.unpack(self._take(parser.size))

    def u8(self) -> int:
        return self._take(1)[0]

    def i16(self) -> int:
        return int(cast(int, self.unpack("h")[0]))

    def i32(self) -> int:
        return int(cast(int, self.unpack("i")[0]))

    def u32(self) -> int:
        return int(cast(int, self.unpack("I")[0]))

    def i64(self) -> int:
        return int(cast(int, self.unpack("q")[0]))

    def u64(self) -> int:
        return int(cast(int, self.unpack("Q")[0]))

    def bytes(self, size: int) -> bytes:
        return self._take(size)

    def cstring(self, *, maximum: int = MAX_STRING_BYTES) -> str:
        limit = min(self._end, self.pos + maximum + 1)
        nul = self._data.find(b"\0", self.pos, limit)
        if nul < 0:
            raise UnityMetadataError("Serialized string is missing a bounded terminator.")
        raw = self._data[self.pos : nul]
        self.pos = nul + 1
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError as error:
            raise UnityMetadataError("Serialized string is not valid UTF-8.") from error

    def aligned_string(self) -> str:
        size = self.i32()
        if size < 0 or size > MAX_STRING_BYTES:
            raise UnityMetadataError("Serialized string length is outside the supported bound.")
        raw = self._take(size)
        self.align4()
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError as error:
            raise UnityMetadataError("Serialized string is not valid UTF-8.") from error


class SerializedFileIndex:
    """Memory-mapped index over one supported Unity serialized file.

    Construction validates the file header, metadata bounds, object table, and
    external references before consumers can resolve records. Use as a context
    manager so the memory map is released deterministically. Domain services own
    the meaning of resolved objects; this class only provides bounded structure.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self._path_ids_sorted: bool | None = None
        self._handle = path.open("rb")
        try:
            self._data = mmap.mmap(self._handle.fileno(), 0, access=mmap.ACCESS_READ)
        except (OSError, ValueError):
            self._handle.close()
            raise
        try:
            self._parse_metadata()
        except (UnityMetadataError, OverflowError, struct.error, ValueError):
            self._data.close()
            del self._data
            self._handle.close()
            raise

    def __enter__(self) -> SerializedFileIndex:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def close(self) -> None:
        """Release the memory map and underlying installed-file handle."""

        data = getattr(self, "_data", None)
        if data is not None:
            data.close()
            del self._data
        self._handle.close()

    def _skip_typetree_blob(self, reader: _Reader) -> None:
        node_count = reader.i32()
        string_size = reader.i32()
        if not 0 <= node_count <= MAX_TYPETREE_NODES:
            raise UnityMetadataError("Type tree node count is outside the supported bound.")
        if not 0 <= string_size <= MAX_TYPETREE_STRINGS:
            raise UnityMetadataError("Type tree string buffer is outside the supported bound.")
        # Serialized-file format 22 uses the >=19 node shape:
        # hBBIIiiiQ = 32 bytes.
        reader.skip(node_count * 32)
        reader.skip(string_size)

    def _skip_serialized_type(self, reader: _Reader, *, ref_type: bool) -> int:
        class_id = reader.i32()
        reader.u8()  # m_IsStrippedType
        script_type_index = reader.i16()
        if (ref_type and script_type_index >= 0) or (
            not ref_type and class_id == MONO_BEHAVIOUR_CLASS_ID
        ):
            reader.skip(16)  # m_ScriptID
        reader.skip(16)  # m_OldTypeHash
        if self.enable_type_tree:
            self._skip_typetree_blob(reader)
            if ref_type:
                reader.cstring()
                reader.cstring()
                reader.cstring()
            else:
                dependency_count = reader.i32()
                if not 0 <= dependency_count <= MAX_TYPES:
                    raise UnityMetadataError(
                        "Type dependency count is outside the supported bound."
                    )
                reader.skip(dependency_count * 4)
        return class_id

    def _parse_metadata(self) -> None:
        if len(self._data) < 48:
            raise UnityMetadataError("Serialized file is too small for a version-22 header.")
        header = _Reader(self._data, 0, len(self._data), endian=">")
        _legacy_metadata_size = header.u32()
        _legacy_file_size = header.u32()
        version = header.u32()
        _legacy_data_offset = header.u32()
        if version != SERIALIZED_FILE_VERSION:
            raise UnityMetadataError(f"Unsupported serialized-file version {version}.")
        endian_flag = header.u8()
        header.skip(3)
        metadata_size = header.u32()
        file_size = header.i64()
        data_offset = header.i64()
        header.i64()  # reserved/unknown in version 22
        if file_size != len(self._data):
            raise UnityMetadataError("Serialized-file size header does not match the file.")
        if endian_flag != 0:
            raise UnityMetadataError(
                "Only the known little-endian Windows asset layout is supported."
            )
        metadata_end = header.pos + metadata_size
        if (
            metadata_size <= 0
            or metadata_end > data_offset
            or data_offset > file_size
            or data_offset % 16 != 0
            or data_offset - metadata_end >= 16
        ):
            raise UnityMetadataError("Serialized-file metadata/data bounds are invalid.")

        reader = _Reader(self._data, header.pos, metadata_end, endian="<")
        unity_version = reader.cstring(maximum=64)
        if unity_version != UNITY_VERSION:
            raise UnityMetadataError(f"Unsupported Unity version {unity_version!r}.")
        target_platform = reader.i32()
        if target_platform != TARGET_PLATFORM:
            raise UnityMetadataError(f"Unsupported target platform {target_platform}.")
        enable_type_tree = reader.u8()
        if enable_type_tree not in (0, 1):
            raise UnityMetadataError("Serialized-file type-tree flag is malformed.")
        self.enable_type_tree = bool(enable_type_tree)

        type_count = reader.i32()
        if not 0 <= type_count <= MAX_TYPES:
            raise UnityMetadataError("Serialized type count is outside the supported bound.")
        types = [self._skip_serialized_type(reader, ref_type=False) for _ in range(type_count)]
        if not types:
            raise UnityMetadataError("Serialized file contains no object types.")
        self.types = tuple(types)

        object_count = reader.i32()
        if not 0 <= object_count <= MAX_OBJECTS:
            raise UnityMetadataError("Serialized object count is outside the supported bound.")
        reader.align4()
        self.object_count = object_count
        self.object_table_offset = reader.pos
        object_table_end = self.object_table_offset + object_count * _OBJECT_RECORD.size
        if object_table_end > data_offset:
            raise UnityMetadataError("Serialized object table crosses into the data section.")
        reader.pos = object_table_end

        script_count = reader.i32()
        if not 0 <= script_count <= MAX_OBJECTS:
            raise UnityMetadataError("Script identifier count is outside the supported bound.")
        for _ in range(script_count):
            reader.i32()
            reader.align4()
            reader.i64()

        external_count = reader.i32()
        if not 0 <= external_count <= MAX_TYPES:
            raise UnityMetadataError("External file count is outside the supported bound.")
        external_references: list[ExternalReference] = []
        for _ in range(external_count):
            asset_path = reader.cstring()
            reader.skip(16)
            reader.i32()
            path = reader.cstring()
            external_references.append(ExternalReference(asset_path, path))
        self.external_references = tuple(external_references)
        self.externals = tuple(reference.path for reference in external_references)

        ref_type_count = reader.i32()
        if not 0 <= ref_type_count <= MAX_TYPES:
            raise UnityMetadataError("Reference type count is outside the supported bound.")
        for _ in range(ref_type_count):
            self._skip_serialized_type(reader, ref_type=True)
        reader.cstring()  # userInformation
        if reader.pos > metadata_end:
            raise UnityMetadataError("Serialized metadata extends past the declared metadata size.")
        self.data_offset = data_offset

    def _record_at_table_index(self, index: int) -> ObjectRecord:
        if not 0 <= index < self.object_count:
            raise UnityMetadataError(
                "Serialized object table index is outside the supported bound."
            )
        offset = self.object_table_offset + index * _OBJECT_RECORD.size
        path_id, relative_start, byte_size, type_id = _OBJECT_RECORD.unpack_from(self._data, offset)
        if not 0 <= type_id < len(self.types):
            raise UnityMetadataError("Serialized object references an invalid type index.")
        byte_start = self.data_offset + relative_start
        byte_end = byte_start + byte_size
        if relative_start < 0 or byte_start < self.data_offset or byte_end > len(self._data):
            raise UnityMetadataError("Serialized object data is outside the declared file bounds.")
        return ObjectRecord(path_id, byte_start, byte_size, self.types[type_id])

    def _has_sorted_path_ids(self) -> bool:
        cached = self._path_ids_sorted
        if cached is not None:
            return cached
        previous: int | None = None
        offset = self.object_table_offset
        sorted_ids = True
        data_len = len(self._data)
        for _ in range(self.object_count):
            path_id, relative_start, byte_size, type_id = _OBJECT_RECORD.unpack_from(
                self._data, offset
            )
            if not 0 <= type_id < len(self.types):
                raise UnityMetadataError("Serialized object references an invalid type index.")
            byte_start = self.data_offset + relative_start
            byte_end = byte_start + byte_size
            if relative_start < 0 or byte_start < self.data_offset or byte_end > data_len:
                raise UnityMetadataError(
                    "Serialized object data is outside the declared file bounds."
                )
            if previous is not None and path_id <= previous:
                sorted_ids = False
            previous = path_id
            offset += _OBJECT_RECORD.size
        self._path_ids_sorted = sorted_ids
        return sorted_ids

    def _find_sorted_record(self, path_id: int) -> ObjectRecord | None:
        low = 0
        high = self.object_count
        while low < high:
            middle = (low + high) // 2
            offset = self.object_table_offset + middle * _OBJECT_RECORD.size
            candidate = struct.unpack_from("<q", self._data, offset)[0]
            if candidate < path_id:
                low = middle + 1
            else:
                high = middle
        if low >= self.object_count:
            return None
        record = self._record_at_table_index(low)
        return record if record.path_id == path_id else None

    def find_records(self, path_ids: set[int]) -> dict[int, ObjectRecord]:
        """Resolve every requested local path ID or fail on missing ambiguity."""

        if not path_ids:
            return {}
        if self._has_sorted_path_ids():
            sorted_found = {
                path_id: record
                for path_id in path_ids
                if (record := self._find_sorted_record(path_id)) is not None
            }
            if len(sorted_found) != len(path_ids):
                raise UnityMetadataError(
                    "A required serialized object pointer could not be resolved."
                )
            return sorted_found

        remaining = set(path_ids)
        found: dict[int, ObjectRecord] = {}
        for index in range(self.object_count):
            record = self._record_at_table_index(index)
            if record.path_id not in path_ids:
                continue
            if record.path_id in found:
                raise UnityMetadataError("A required serialized object path ID is duplicated.")
            found[record.path_id] = record
            remaining.discard(record.path_id)
        if remaining:
            raise UnityMetadataError("A required serialized object pointer could not be resolved.")
        return found

    def iter_records(self, class_ids: frozenset[int] | None = None) -> Iterable[ObjectRecord]:
        """Yield validated object records, optionally restricted by class ID."""
        offset = self.object_table_offset
        data_len = len(self._data)
        types = self.types
        for _ in range(self.object_count):
            path_id, relative_start, byte_size, type_id = _OBJECT_RECORD.unpack_from(
                self._data, offset
            )
            offset += _OBJECT_RECORD.size
            if not 0 <= type_id < len(types):
                raise UnityMetadataError("Serialized object references an invalid type index.")
            byte_start = self.data_offset + relative_start
            byte_end = byte_start + byte_size
            if relative_start < 0 or byte_start < self.data_offset or byte_end > data_len:
                raise UnityMetadataError(
                    "Serialized object data is outside the declared file bounds."
                )
            class_id = types[type_id]
            if class_ids is None or class_id in class_ids:
                yield ObjectRecord(path_id, byte_start, byte_size, class_id)

    def object_reader(self, record: ObjectRecord) -> _Reader:
        """Return a bounds-checked reader restricted to one object record."""

        return _Reader(
            self._data,
            record.byte_start,
            record.byte_start + record.byte_size,
            endian="<",
        )

    def external_names(self, file_id: int) -> tuple[str, ...]:
        """Return normalized candidate filenames for one external reference."""

        if file_id <= 0 or file_id > len(self.external_references):
            raise UnityMetadataError("A required external PPtr file ID is invalid.")
        reference = self.external_references[file_id - 1]
        names: list[str] = []
        for raw in (reference.path, reference.asset_path):
            normalized = raw.replace("\\", "/").rstrip("/")
            posix_name = PurePosixPath(normalized).name
            windows_name = PureWindowsPath(normalized).name
            name = windows_name or posix_name
            if name and name not in names:
                names.append(name)
        if not names:
            raise UnityMetadataError("A required external PPtr has no usable file name.")
        return tuple(names)

    def external_name(self, file_id: int) -> str:
        """Return the preferred normalized filename for one external reference."""

        return self.external_names(file_id)[0]

    def read_pptr_vector(
        self,
        record: ObjectRecord,
        absolute: int,
        *,
        maximum: int,
    ) -> tuple[PPtr, ...] | None:
        """Read a plausible bounded PPtr vector without claiming field semantics."""

        record_end = record.byte_start + record.byte_size
        if maximum <= 0 or absolute % 4 != 0 or absolute + 4 > record_end:
            return None
        count = struct.unpack_from("<i", self._data, absolute)[0]
        if not 0 < count <= maximum:
            return None
        size = 4 + count * 12
        if absolute + size > record_end:
            return None
        reader = _Reader(self._data, absolute + 4, absolute + size, endian="<")
        pointers = tuple(read_pptr(reader) for _ in range(count))
        if any(pointer.file_id < 0 for pointer in pointers):
            return None
        return pointers


def find_resource_manager_pointer(
    index: SerializedFileIndex,
    resource_keys: Iterable[str],
) -> tuple[str, PPtr]:
    """Resolve one exact ResourceManager container key to its serialized PPtr.

    The validated Unity build serializes each ``m_Container`` entry as an aligned
    string immediately followed by a PPtr.  This intentionally does not attempt to
    parse unrelated ResourceManager fields: it searches only the unique class-147
    object for exact bounded aligned-string encodings and fails closed on missing or
    ambiguous matches.
    """
    keys: list[tuple[str, bytes]] = []
    identities: set[str] = set()
    for value in resource_keys:
        if not isinstance(value, str) or not value or "\0" in value:
            raise UnityMetadataError("ResourceManager key is malformed.")
        raw = value.encode("utf-8")
        if len(raw) > MAX_STRING_BYTES:
            raise UnityMetadataError("ResourceManager key is outside the supported bound.")
        identity = value.casefold()
        if identity in identities:
            continue
        identities.add(identity)
        keys.append((value, raw))
    if not keys:
        raise UnityMetadataError("ResourceManager lookup requires at least one key.")

    managers = tuple(index.iter_records(frozenset({RESOURCE_MANAGER_CLASS_ID})))
    if len(managers) != 1:
        raise UnityMetadataError("ResourceManager object is missing or ambiguous.")
    record = managers[0]
    if record.byte_size <= 0 or record.byte_size > MAX_RESOURCE_MANAGER_BYTES:
        raise UnityMetadataError("ResourceManager object size is outside the supported bound.")
    record_end = record.byte_start + record.byte_size
    matches: list[tuple[str, PPtr]] = []

    for key, raw in keys:
        needle = struct.pack("<i", len(raw)) + raw
        cursor = record.byte_start
        occurrences = 0
        while cursor < record_end:
            position = index._data.find(needle, cursor, record_end)
            if position < 0:
                break
            occurrences += 1
            if occurrences > MAX_RESOURCE_KEY_OCCURRENCES:
                raise UnityMetadataError("ResourceManager key occurs too many times.")
            cursor = position + 1
            # Aligned Unity strings start on a four-byte boundary in this map layout.
            if position % 4 != 0:
                continue
            pointer_offset = (position + len(needle) + 3) & ~3
            if pointer_offset + 12 > record_end:
                continue
            if any(index._data[position + len(needle) : pointer_offset]):
                continue
            file_id, path_id = struct.unpack_from("<iq", index._data, pointer_offset)
            if file_id <= 0 or path_id == 0:
                continue
            matches.append((key, PPtr(file_id, path_id)))

    if len(matches) != 1:
        raise UnityMetadataError("ResourceManager prefab entry is missing or ambiguous.")
    return matches[0]


def read_pptr(reader: _Reader) -> PPtr:
    """Read one Unity 2022.3 PPtr from the current bounded object cursor."""

    return PPtr(reader.i32(), reader.i64())


def parse_mono_behaviour_prefix(
    index: SerializedFileIndex,
    record: ObjectRecord,
) -> MonoBehaviourPrefix:
    """Parse the common header shared by supported MonoBehaviour components."""

    if record.class_id != MONO_BEHAVIOUR_CLASS_ID:
        raise UnityMetadataError("Expected a MonoBehaviour component record.")
    reader = index.object_reader(record)
    game_object = read_pptr(reader)
    enabled = reader.u8()
    if enabled not in (0, 1):
        raise UnityMetadataError("MonoBehaviour enabled flag is not boolean-like.")
    reader.align4()
    script = read_pptr(reader)
    name = reader.aligned_string()
    return MonoBehaviourPrefix(game_object, script, name, reader.pos - record.byte_start)


def parse_mono_script(index: SerializedFileIndex, record: ObjectRecord) -> MonoScriptData:
    """Read the script identity used to classify a MonoBehaviour dynamically."""

    if record.class_id != MONO_SCRIPT_CLASS_ID:
        raise UnityMetadataError("MonoBehaviour script pointer does not resolve to MonoScript.")
    reader = index.object_reader(record)
    name = reader.aligned_string()
    reader.i32()  # m_ExecutionOrder
    reader.skip(16)  # m_PropertiesHash on Unity >= 5
    class_name = reader.aligned_string()
    namespace = reader.aligned_string()
    assembly_name = reader.aligned_string()
    if not class_name or not assembly_name:
        raise UnityMetadataError("MonoScript identity is incomplete.")
    return MonoScriptData(name, class_name, namespace, assembly_name)


__all__ = [
    "GAME_OBJECT_CLASS_ID",
    "MONO_BEHAVIOUR_CLASS_ID",
    "MONO_SCRIPT_CLASS_ID",
    "RESOURCE_MANAGER_CLASS_ID",
    "MonoBehaviourPrefix",
    "MonoScriptData",
    "ObjectRecord",
    "PPtr",
    "SerializedFileIndex",
    "UnityMetadataError",
    "find_resource_manager_pointer",
    "parse_mono_behaviour_prefix",
    "parse_mono_script",
    "read_pptr",
]
