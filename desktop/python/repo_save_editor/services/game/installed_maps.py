"""Reviewed RunManager normal-level roster and authored Level presentation metadata."""

from __future__ import annotations

import hashlib
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path

from repo_save_editor.services.game.discovery import GameInstallation
from repo_save_editor.services.game.installed_build import (
    SUNSTONE_ARTWORK_ASSEMBLY_SHA256,
    SUNSTONE_ARTWORK_BUILD_ID,
    owned_file,
    validated_installed_artwork_build,
)
from repo_save_editor.services.unity_artwork import SUNSTONE_UNITY_VERSION, ArtworkFileIndex
from repo_save_editor.services.unity_serialized import (
    ObjectRecord,
    PPtr,
    UnityMetadataError,
    _Reader,
    parse_mono_behaviour_prefix,
    parse_mono_script,
    read_pptr,
)

MAX_LEVELS = 128
MAX_OBJECT_BYTES = 256 * 1024
SOURCE_NAMES = ("level0", "sharedassets0.assets", "globalgamemanagers.assets")


@dataclass(frozen=True, slots=True)
class InstalledLevel:
    """One normal-level roster entry and its original loading-image resource paths."""

    family: str
    name: str
    loading_paths: tuple[str, ...]


def _vector(reader: _Reader) -> tuple[PPtr, ...]:
    count = reader.i32()
    if not 0 <= count <= MAX_LEVELS:
        raise UnityMetadataError("Installed level vector exceeds its bound.")
    values = tuple(read_pptr(reader) for _ in range(count))
    if any(p.file_id < 0 or p.path_id == 0 for p in values) or len(set(values)) != count:
        raise UnityMetadataError("Installed level vector contains null or duplicate entries.")
    return values


def normal_level_pointers(reader: _Reader) -> tuple[PPtr, ...]:
    """Read the reviewed RunManager prefix; special rosters are distinct vectors."""
    reader.i32()  # splashScreenLatestVersion
    read_pptr(reader)  # levelCurrent
    reader.i32()  # levelsCompleted
    for _ in range(6):
        read_pptr(reader)  # lobby/menu/recording/splash/tutorial references
    _vector(reader)  # levelShop
    _vector(reader)  # levelArena
    normal = _vector(reader)  # levels
    if not normal:
        raise UnityMetadataError("Installed normal-level roster is empty.")
    return normal


def _label(value: str, maximum: int) -> str:
    if not value or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise UnityMetadataError("Installed level label is malformed.")
    return value


def _prefab_path(reader: _Reader) -> str:
    name, path = reader.aligned_string(), reader.aligned_string()
    bundle = read_pptr(reader)
    finalized = reader.u8()
    reader.align4()
    if bundle != PPtr(0, 0) or finalized not in (0, 1):
        return ""  # A bundled PrefabRef needs a different source adapter.
    if not name and not path:
        return ""
    if (
        len(path) > 512
        or "\\" in path
        or ":" in path
        or any(ord(c) < 32 for c in path)
        or any(p in ("", ".", "..") for p in path.split("/"))
        or path.rsplit("/", 1)[-1] != name
    ):
        raise UnityMetadataError("Installed loading-image resource path is unsafe.")
    return path


def level_metadata(reader: _Reader, asset_name: str) -> InstalledLevel:
    """Read authored names and three Sprite PrefabRefs, without filtering by status."""
    family = _label(asset_name.removeprefix("Level - "), 64)
    if any(c in family for c in "/\\"):
        raise UnityMetadataError("Installed map family is malformed.")
    reader.i32()  # status is not roster membership; Desert legitimately has status 0.
    name = _label(reader.aligned_string(), 128)
    read_pptr(reader)  # NarrativeNameLocalized
    reader.i32()
    reader.i32()  # ModuleAmount / PassageMaxAmount
    if reader.u8() not in (0, 1):
        raise UnityMetadataError("Invalid Level.HasEnemies flag.")
    reader.align4()
    paths = tuple(dict.fromkeys(p for p in (_prefab_path(reader) for _ in range(3)) if p))
    return InstalledLevel(family, name, paths)


def read_installed_levels(
    installation: GameInstallation,
) -> tuple[tuple[InstalledLevel, ...], tuple[Path, ...]] | None:
    """Return reviewed installed membership; unsupported builds retain JSON discovery."""
    build = validated_installed_artwork_build(installation)
    if build is None or build.build_id != SUNSTONE_ARTWORK_BUILD_ID:
        return None
    root = installation.root
    library = root.parents[2]
    data = root / "REPO_Data"
    assembly = owned_file(library, data / "Managed/Assembly-CSharp.dll")
    sources = (build.manifest_path, assembly, *(data / name for name in SOURCE_NAMES))
    before = [(p, owned_file(library, p).stat()) for p in sources]
    if assembly.stat().st_size > 32 * 1024 * 1024:
        raise UnityMetadataError("Installed level assembly exceeds its bound.")
    with assembly.open("rb") as handle:
        if hashlib.file_digest(handle, "sha256").hexdigest() != SUNSTONE_ARTWORK_ASSEMBLY_SHA256:
            raise UnityMetadataError("Unsupported installed level assembly.")
    with ExitStack() as stack:
        indexes = {
            name: stack.enter_context(ArtworkFileIndex(owned_file(library, data / name)))
            for name in SOURCE_NAMES
        }
        if any(i.unity_version != SUNSTONE_UNITY_VERSION for i in indexes.values()):
            raise UnityMetadataError("Unsupported installed level layout.")

        def resolve(
            index: ArtworkFileIndex, pointer: PPtr
        ) -> tuple[ArtworkFileIndex, ObjectRecord]:
            target = (
                index if pointer.file_id == 0 else indexes.get(index.external_name(pointer.file_id))
            )
            if target is None or pointer.path_id == 0:
                raise UnityMetadataError("Unsupported installed level reference.")
            return target, target.find_records({pointer.path_id})[pointer.path_id]

        def script_is(index: ArtworkFileIndex, record: ObjectRecord, expected: str) -> bool:
            if record.class_id != 114 or record.byte_size > MAX_OBJECT_BYTES:
                return False
            prefix = parse_mono_behaviour_prefix(index, record)
            target, script_record = resolve(index, prefix.script)
            script = parse_mono_script(target, script_record)
            return (script.class_name, script.namespace, script.assembly_name) == (
                expected,
                "",
                "Assembly-CSharp",
            )

        level0 = indexes["level0"]
        managers = [
            r for r in level0.iter_records(frozenset({114})) if script_is(level0, r, "RunManager")
        ]
        if len(managers) != 1:
            raise UnityMetadataError("Installed RunManager is missing or ambiguous.")
        record = managers[0]
        prefix = parse_mono_behaviour_prefix(level0, record)
        reader = level0.object_reader(record)
        reader.skip(prefix.field_offset)
        result = []
        for pointer in normal_level_pointers(reader):
            target, record = resolve(level0, pointer)
            if not script_is(target, record, "Level"):
                raise UnityMetadataError("Normal-level roster target is not a Level.")
            prefix = parse_mono_behaviour_prefix(target, record)
            reader = target.object_reader(record)
            reader.skip(prefix.field_offset)
            result.append(level_metadata(reader, prefix.name))
        if len({r.family for r in result}) != len(result):
            raise UnityMetadataError("Normal-level roster has duplicate identities.")
    for path, old in before:
        now = owned_file(library, path).stat()
        if (old.st_size, old.st_mtime_ns, old.st_ino, old.st_dev) != (
            now.st_size,
            now.st_mtime_ns,
            now.st_ino,
            now.st_dev,
        ):
            raise UnityMetadataError("Installed level sources changed during discovery.")
    return tuple(result), sources
