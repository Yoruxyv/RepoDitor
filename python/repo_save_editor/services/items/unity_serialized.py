"""Narrow read-only Unity metadata reader for installed item recharge capability.

This is deliberately not a general Unity asset parser. It supports only the
validated R.E.P.O. build layout required to map installed Item definitions to
their same-identity prefab GameObjects and inspect ItemBattery components.
Any unsupported, incomplete, or conflicting metadata fails closed.
"""

from __future__ import annotations

import mmap
import struct
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Final

from repo_save_editor.services.items.models import ItemRechargeCapability

SERIALIZED_FILE_VERSION: Final = 22
UNITY_VERSION: Final = "2022.3.67f2"
TARGET_PLATFORM: Final = 19  # StandaloneWindows64 in the known build
GAME_OBJECT_CLASS_ID: Final = 1
MONO_BEHAVIOUR_CLASS_ID: Final = 114
MONO_SCRIPT_CLASS_ID: Final = 115
GLOBAL_MANAGERS_NAME: Final = "globalgamemanagers.assets"
ITEM_CLASS: Final = "Item"
ITEM_BATTERY_CLASS: Final = "ItemBattery"
MAX_TYPES: Final = 16_384
MAX_OBJECTS: Final = 4_000_000
MAX_COMPONENTS: Final = 4_096
MAX_STRING_BYTES: Final = 16_384
MAX_TYPETREE_NODES: Final = 1_000_000
MAX_TYPETREE_STRINGS: Final = 64 * 1024 * 1024
KNOWN_BATTERY_BARS: Final = frozenset({5, 6, 8, 10, 12, 15, 18, 20})
_OBJECT_RECORD = struct.Struct("<qqIi")


class UnityMetadataError(ValueError):
    """Unsupported, incomplete, malformed, or conflicting installed metadata."""


@dataclass(frozen=True, slots=True)
class PPtr:
    file_id: int
    path_id: int


@dataclass(frozen=True, slots=True)
class ObjectRecord:
    path_id: int
    byte_start: int
    byte_size: int
    class_id: int


@dataclass(frozen=True, slots=True)
class GameObjectData:
    name: str
    components: tuple[PPtr, ...]


@dataclass(frozen=True, slots=True)
class MonoBehaviourPrefix:
    game_object: PPtr
    script: PPtr
    name: str
    field_offset: int


@dataclass(frozen=True, slots=True)
class MonoScriptData:
    name: str
    class_name: str
    namespace: str
    assembly_name: str


@dataclass(frozen=True, slots=True)
class VariantResult:
    has_battery: bool | None
    battery_metadata: tuple[int, int] | None


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
        return int(self.unpack("h")[0])

    def i32(self) -> int:
        return int(self.unpack("i")[0])

    def u32(self) -> int:
        return int(self.unpack("I")[0])

    def i64(self) -> int:
        return int(self.unpack("q")[0])

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
    """Minimal index over a supported Unity serialized file."""

    def __init__(self, path: Path) -> None:
        self.path = path
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
        externals: list[str] = []
        for _ in range(external_count):
            reader.cstring()
            reader.skip(16)
            reader.i32()
            externals.append(reader.cstring())
        self.externals = tuple(externals)

        ref_type_count = reader.i32()
        if not 0 <= ref_type_count <= MAX_TYPES:
            raise UnityMetadataError("Reference type count is outside the supported bound.")
        for _ in range(ref_type_count):
            self._skip_serialized_type(reader, ref_type=True)
        reader.cstring()  # userInformation
        if reader.pos > metadata_end:
            raise UnityMetadataError("Serialized metadata extends past the declared metadata size.")
        self.data_offset = data_offset

    def find_records(self, path_ids: set[int]) -> dict[int, ObjectRecord]:
        if not path_ids:
            return {}
        remaining = set(path_ids)
        found: dict[int, ObjectRecord] = {}
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
            if path_id not in path_ids:
                continue
            if path_id in found:
                raise UnityMetadataError("A required serialized object path ID is duplicated.")
            found[path_id] = ObjectRecord(path_id, byte_start, byte_size, types[type_id])
            remaining.discard(path_id)
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
        return _Reader(
            self._data,
            record.byte_start,
            record.byte_start + record.byte_size,
            endian="<",
        )

    def external_name(self, file_id: int) -> str:
        if file_id <= 0 or file_id > len(self.externals):
            raise UnityMetadataError("A required external PPtr file ID is invalid.")
        raw = self.externals[file_id - 1].replace("\\", "/")
        # Unity external paths may be archive:/..., Windows, or simple names.
        posix_name = PurePosixPath(raw).name
        windows_name = PureWindowsPath(raw).name
        return windows_name or posix_name


def _read_pptr(reader: _Reader) -> PPtr:
    return PPtr(reader.i32(), reader.i64())


def _read_game_object_name(index: SerializedFileIndex, record: ObjectRecord) -> str:
    """Read only a GameObject name for broad candidate discovery.

    Empty names are valid for unrelated installed GameObjects. Structural
    corruption still raises so variant completeness never depends on silently
    skipping unreadable records. Component PPtrs are consumed but deliberately
    not semantically validated until a requested prefab identity is matched.
    """
    if record.class_id != GAME_OBJECT_CLASS_ID:
        raise UnityMetadataError("Expected a GameObject record during name discovery.")
    reader = index.object_reader(record)
    component_count = reader.i32()
    if not 0 <= component_count <= MAX_COMPONENTS:
        raise UnityMetadataError("GameObject component count is outside the supported bound.")
    for _ in range(component_count):
        _read_pptr(reader)
    reader.i32()  # m_Layer
    return reader.aligned_string()


def _parse_game_object(index: SerializedFileIndex, record: ObjectRecord) -> GameObjectData:
    if record.class_id != GAME_OBJECT_CLASS_ID:
        raise UnityMetadataError("Matched prefab path ID is not a GameObject.")
    reader = index.object_reader(record)
    component_count = reader.i32()
    if not 0 <= component_count <= MAX_COMPONENTS:
        raise UnityMetadataError("GameObject component count is outside the supported bound.")
    components = tuple(_read_pptr(reader) for _ in range(component_count))
    if any(pointer.file_id != 0 or pointer.path_id == 0 for pointer in components):
        raise UnityMetadataError("GameObject contains an unsupported or null component pointer.")
    reader.i32()  # m_Layer
    name = reader.aligned_string()
    if not name:
        raise UnityMetadataError("Matched prefab GameObject has no name.")
    return GameObjectData(name, components)


def _parse_mono_behaviour_prefix(
    index: SerializedFileIndex,
    record: ObjectRecord,
) -> MonoBehaviourPrefix:
    if record.class_id != MONO_BEHAVIOUR_CLASS_ID:
        raise UnityMetadataError("Expected a MonoBehaviour component record.")
    reader = index.object_reader(record)
    game_object = _read_pptr(reader)
    enabled = reader.u8()
    if enabled not in (0, 1):
        raise UnityMetadataError("MonoBehaviour enabled flag is not boolean-like.")
    reader.align4()
    script = _read_pptr(reader)
    name = reader.aligned_string()
    return MonoBehaviourPrefix(game_object, script, name, reader.pos - record.byte_start)


def _parse_mono_script(index: SerializedFileIndex, record: ObjectRecord) -> MonoScriptData:
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


def _item_battery_metadata(
    index: SerializedFileIndex,
    record: ObjectRecord,
    field_offset: int,
) -> tuple[int, int]:
    absolute = record.byte_start + field_offset
    if field_offset < 0 or absolute + 5 > record.byte_start + record.byte_size:
        raise UnityMetadataError("ItemBattery prefix is truncated.")
    battery_bars = struct.unpack_from("<i", index._data, absolute)[0]
    exceptional_flag = index._data[absolute + 4]
    if battery_bars not in KNOWN_BATTERY_BARS:
        raise UnityMetadataError("ItemBattery batteryBars is outside the known-build guard set.")
    if exceptional_flag not in (0, 1):
        raise UnityMetadataError("ItemBattery exceptional flag is malformed.")
    return battery_bars, exceptional_flag


def _unknown_capabilities(item_names: tuple[str, ...]) -> dict[str, ItemRechargeCapability]:
    return dict.fromkeys(item_names, ItemRechargeCapability.UNKNOWN)


def _normalize_item_names(item_names: Iterable[str]) -> tuple[tuple[str, ...], dict[str, str]]:
    names: list[str] = []
    by_identity: dict[str, str] = {}
    for value in item_names:
        if not isinstance(value, str) or not value.strip():
            raise UnityMetadataError("Item definition names must be non-empty text.")
        name = value.strip()
        identity = name.casefold()
        owner = by_identity.setdefault(identity, name)
        if owner != name:
            raise UnityMetadataError("Requested item definition names collide case-insensitively.")
        if owner == name and name not in names:
            names.append(name)
    return tuple(names), by_identity


def _resolve_mono_scripts(
    resources: SerializedFileIndex,
    globals_: SerializedFileIndex,
    prefixes: Iterable[MonoBehaviourPrefix],
) -> dict[int, MonoScriptData]:
    script_ids: set[int] = set()
    for prefix in prefixes:
        if prefix.script.path_id == 0:
            raise UnityMetadataError("MonoBehaviour contains a null script pointer.")
        if resources.external_name(prefix.script.file_id).casefold() != GLOBAL_MANAGERS_NAME:
            raise UnityMetadataError(
                "MonoBehaviour script pointer targets an unsupported external file."
            )
        script_ids.add(prefix.script.path_id)
    script_records = globals_.find_records(script_ids)
    return {
        path_id: _parse_mono_script(globals_, record) for path_id, record in script_records.items()
    }


def _classify_variants(
    resources: SerializedFileIndex,
    globals_: SerializedFileIndex,
    variants_by_item: dict[str, tuple[ObjectRecord, ...]],
) -> dict[str, ItemRechargeCapability]:
    game_objects: dict[int, GameObjectData] = {}
    item_variant_ids: dict[str, tuple[int, ...]] = {}
    for item_name, records in variants_by_item.items():
        ids: list[int] = []
        for record in records:
            game_object = _parse_game_object(resources, record)
            if game_object.name.casefold() != item_name.casefold():
                raise UnityMetadataError(
                    "Matched prefab GameObject identity changed during inspection."
                )
            game_objects[record.path_id] = game_object
            ids.append(record.path_id)
        item_variant_ids[item_name] = tuple(ids)

    component_ids = {
        pointer.path_id
        for game_object in game_objects.values()
        for pointer in game_object.components
    }
    component_records = resources.find_records(component_ids)
    mono_prefixes: dict[int, MonoBehaviourPrefix] = {}
    for component_id, record in component_records.items():
        if record.class_id == MONO_BEHAVIOUR_CLASS_ID:
            mono_prefixes[component_id] = _parse_mono_behaviour_prefix(resources, record)
    scripts = _resolve_mono_scripts(resources, globals_, mono_prefixes.values())

    variant_results: dict[int, VariantResult] = {}
    for game_object_id, game_object in game_objects.items():
        battery_metadata: list[tuple[int, int]] = []
        incomplete = False
        for pointer in game_object.components:
            record = component_records[pointer.path_id]
            if record.class_id != MONO_BEHAVIOUR_CLASS_ID:
                continue
            prefix = mono_prefixes[pointer.path_id]
            if prefix.game_object != PPtr(0, game_object_id):
                raise UnityMetadataError(
                    "MonoBehaviour does not point back to its matched GameObject."
                )
            script = scripts[prefix.script.path_id]
            if script.class_name != ITEM_BATTERY_CLASS:
                continue
            try:
                battery_metadata.append(
                    _item_battery_metadata(resources, record, prefix.field_offset)
                )
            except UnityMetadataError:
                incomplete = True
                break
        if incomplete:
            variant_results[game_object_id] = VariantResult(None, None)
        elif not battery_metadata:
            variant_results[game_object_id] = VariantResult(False, None)
        elif len(set(battery_metadata)) != 1:
            variant_results[game_object_id] = VariantResult(None, None)
        else:
            variant_results[game_object_id] = VariantResult(True, battery_metadata[0])

    results: dict[str, ItemRechargeCapability] = {}
    for item_name, variant_ids in item_variant_ids.items():
        item_variants = [variant_results[path_id] for path_id in variant_ids]
        presence = {result.has_battery for result in item_variants}
        if None in presence or len(presence) != 1:
            results[item_name] = ItemRechargeCapability.UNKNOWN
            continue
        if not item_variants[0].has_battery:
            results[item_name] = ItemRechargeCapability.NOT_RECHARGEABLE
            continue
        metadata = {result.battery_metadata for result in item_variants}
        exceptional = any(
            result.battery_metadata is None or result.battery_metadata[1] != 0
            for result in item_variants
        )
        results[item_name] = (
            ItemRechargeCapability.RECHARGEABLE
            if len(metadata) == 1 and not exceptional
            else ItemRechargeCapability.UNKNOWN
        )
    return results


def discover_item_recharge_capabilities(
    resources_path: Path,
    global_managers_path: Path,
    item_names: Iterable[str],
) -> dict[str, ItemRechargeCapability]:
    """Classify requested installed item types from read-only Unity metadata.

    The validated build proved that every active ``Item`` definition's built-in
    ``m_Name`` is case-insensitively identical to its persisted ``prefabName``.
    This reader therefore verifies the requested identity is backed by exactly
    one installed MonoBehaviour whose MonoScript class is ``Item``, then retains
    every same-identity GameObject variant and inspects its ItemBattery metadata.
    """
    try:
        names, by_identity = _normalize_item_names(item_names)
    except UnityMetadataError:
        return {}
    if not names:
        return {}
    unknown = _unknown_capabilities(names)

    try:
        with (
            SerializedFileIndex(resources_path) as resources,
            SerializedFileIndex(global_managers_path) as globals_,
        ):
            candidate_definitions: dict[str, list[tuple[ObjectRecord, MonoBehaviourPrefix]]] = {
                identity: [] for identity in by_identity
            }
            for record in resources.iter_records(frozenset({MONO_BEHAVIOUR_CLASS_ID})):
                prefix = _parse_mono_behaviour_prefix(resources, record)
                identity = prefix.name.casefold()
                if identity in candidate_definitions:
                    candidate_definitions[identity].append((record, prefix))

            relevant_prefixes = [
                prefix
                for candidates in candidate_definitions.values()
                for _record, prefix in candidates
            ]
            definition_scripts = _resolve_mono_scripts(resources, globals_, relevant_prefixes)

            verified_definition_names: dict[str, str] = {}
            for identity in by_identity:
                item_definitions = [
                    (record, prefix)
                    for record, prefix in candidate_definitions[identity]
                    if definition_scripts[prefix.script.path_id].class_name == ITEM_CLASS
                ]
                if len(item_definitions) != 1:
                    continue
                definition_name = item_definitions[0][1].name
                if definition_name.casefold() != identity:
                    continue
                verified_definition_names[identity] = definition_name

            variants: dict[str, list[ObjectRecord]] = {name: [] for name in names}
            for record in resources.iter_records(frozenset({GAME_OBJECT_CLASS_ID})):
                name = _read_game_object_name(resources, record)
                if not name:
                    continue
                identity = name.casefold()
                definition_name = verified_definition_names.get(identity)
                if definition_name is None:
                    continue
                # Name discovery is intentionally permissive about component
                # pointer semantics. Once the identity is relevant, require
                # the full strict matched-prefab validation before retaining it.
                game_object = _parse_game_object(resources, record)
                if game_object.name.casefold() != identity:
                    raise UnityMetadataError(
                        "Matched prefab GameObject identity changed during discovery."
                    )
                requested_name = by_identity[identity]
                variants[requested_name].append(record)

            ready: dict[str, tuple[ObjectRecord, ...]] = {}
            for name in names:
                identity = name.casefold()
                records = variants[name]
                if identity not in verified_definition_names or not records:
                    continue
                ready[name] = tuple(records)

            classified = _classify_variants(resources, globals_, ready) if ready else {}
            return {name: classified.get(name, ItemRechargeCapability.UNKNOWN) for name in names}
    except (OSError, UnityMetadataError, struct.error, OverflowError, ValueError):
        return unknown


__all__ = [
    "SerializedFileIndex",
    "UnityMetadataError",
    "discover_item_recharge_capabilities",
]
