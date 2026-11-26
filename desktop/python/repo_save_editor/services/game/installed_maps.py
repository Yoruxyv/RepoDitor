"""Reviewed RunManager normal-level roster and authored Level presentation metadata."""

from __future__ import annotations

import hashlib
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path

from repo_save_editor.services.game.discovery import GameInstallation
from repo_save_editor.services.game.installed_build import (
    VALIDATED_BUILD_ID,
    artwork_assembly_matches,
    installed_build_identity,
    owned_file,
    validated_installed_artwork_build,
)
from repo_save_editor.services.unity_artwork import SUNSTONE_UNITY_VERSION, ArtworkFileIndex
from repo_save_editor.services.unity_presentation import PresentationFileIndex, is_sunstone_layout
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


def _level_rosters(reader: _Reader) -> tuple[tuple[PPtr, ...], tuple[PPtr, ...]]:
    reader.i32()  # splashScreenLatestVersion
    read_pptr(reader)  # levelCurrent
    reader.i32()  # levelsCompleted
    for _ in range(6):
        read_pptr(reader)  # lobby/menu/recording/splash/tutorial references
    shop = _vector(reader)
    _vector(reader)  # levelArena
    normal = _vector(reader)  # levels
    if not normal:
        raise UnityMetadataError("Installed normal-level roster is empty.")
    return shop, normal


def normal_level_pointers(reader: _Reader) -> tuple[PPtr, ...]:
    """Read the reviewed RunManager prefix; special rosters are distinct vectors."""
    return _level_rosters(reader)[1]


def _label(value: str, maximum: int) -> str:
    if not value or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise UnityMetadataError("Installed level label is malformed.")
    return value


def _read_prefab(reader: _Reader) -> tuple[str, str, PPtr, int]:
    name, path = reader.aligned_string(), reader.aligned_string()
    bundle = read_pptr(reader)
    finalized = reader.u8()
    reader.align4()
    return name, path, bundle, finalized


def _prefab_path(reader: _Reader) -> str:
    name, path, bundle, finalized = _read_prefab(reader)
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


def _resolve(
    indexes: dict[str, ArtworkFileIndex], index: ArtworkFileIndex, pointer: PPtr
) -> tuple[ArtworkFileIndex, ObjectRecord]:
    target = index if pointer.file_id == 0 else indexes.get(index.external_name(pointer.file_id))
    if target is None or pointer.path_id == 0:
        raise UnityMetadataError("Unsupported installed level reference.")
    return target, target.find_records({pointer.path_id})[pointer.path_id]


def _script_is(
    indexes: dict[str, ArtworkFileIndex],
    index: ArtworkFileIndex,
    record: ObjectRecord,
    expected: str,
) -> bool:
    if record.class_id != 114 or record.byte_size > MAX_OBJECT_BYTES:
        return False
    prefix = parse_mono_behaviour_prefix(index, record)
    target, script_record = _resolve(indexes, index, prefix.script)
    script = parse_mono_script(target, script_record)
    return (script.class_name, script.namespace, script.assembly_name) == (
        expected,
        "",
        "Assembly-CSharp",
    )


def _run_manager(indexes: dict[str, ArtworkFileIndex]) -> _Reader:
    level0 = indexes["level0"]
    managers = [
        r
        for r in level0.iter_records(frozenset({114}))
        if _script_is(indexes, level0, r, "RunManager")
    ]
    if len(managers) != 1:
        raise UnityMetadataError("Installed RunManager is missing or ambiguous.")
    record = managers[0]
    reader = level0.object_reader(record)
    reader.skip(parse_mono_behaviour_prefix(level0, record).field_offset)
    return reader


def verify_resume_levels(root: Path) -> None:
    """Check both selector rosters and their direct typed Level references."""
    data = root / "REPO_Data"
    with ExitStack() as stack:
        indexes: dict[str, ArtworkFileIndex] = {
            name: stack.enter_context(PresentationFileIndex(owned_file(root, data / name)))
            for name in SOURCE_NAMES
        }
        version = indexes["level0"].unity_version
        if not is_sunstone_layout(version) or any(
            index.unity_version != version for index in indexes.values()
        ):
            raise UnityMetadataError("Unsupported Resume level layout.")
        shop, normal = _level_rosters(_run_manager(indexes))
        if not shop:
            raise UnityMetadataError("Installed Shop roster is empty.")
        seen: set[tuple[Path, int]] = set()
        for pointer in (*shop, *normal):
            index, level = _resolve(indexes, indexes["level0"], pointer)
            identity = (index.path, level.path_id)
            if identity in seen or not _script_is(indexes, index, level, "Level"):
                raise UnityMetadataError("Invalid or ambiguous Resume Level.")
            seen.add(identity)
            reader = index.object_reader(level)
            reader.skip(parse_mono_behaviour_prefix(index, level).field_offset)
            reader.i32()  # status does not control roster membership.
            reader.aligned_string()
            read_pptr(reader)
            if reader.i32() <= 0 or reader.i32() < 0 or reader.u8() not in (0, 1):
                raise UnityMetadataError("Invalid Resume Level generation fields.")
            reader.align4()
            for _ in range(5):
                _read_prefab(reader)  # Loading art, connector and blocker.
            for _ in range(2):  # StartRooms and the first normal module pool.
                count = reader.i32()
                if not 0 < count <= MAX_LEVELS:
                    raise UnityMetadataError("Missing or oversized Resume prefab pool.")
                for _ in range(count):
                    if not _prefab_path(reader):
                        raise UnityMetadataError("Unsupported Resume prefab reference.")


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


def _verify_reviewed_assembly(assembly: Path, build_id: str) -> None:
    if assembly.stat().st_size > 32 * 1024 * 1024:
        raise UnityMetadataError("Installed level assembly exceeds its bound.")
    with assembly.open("rb") as handle:
        raw = handle.read(32 * 1024 * 1024 + 1)
    if len(raw) > 32 * 1024 * 1024 or not artwork_assembly_matches(
        build_id, hashlib.sha256(raw).hexdigest()
    ):
        raise UnityMetadataError("Unsupported installed level assembly.")


def read_installed_levels(
    installation: GameInstallation,
    *,
    presentation: bool = False,
) -> tuple[tuple[InstalledLevel, ...], tuple[Path, ...]] | None:
    """Validate the roster independently of other artwork; fail soft to JSON discovery."""
    build = (
        installed_build_identity(installation)
        if presentation
        else validated_installed_artwork_build(installation)
    )
    if build is None or build.build_id == VALIDATED_BUILD_ID:
        return None
    root = installation.root
    library = root.parents[2]
    data = root / "REPO_Data"
    sources = (build.manifest_path, *(data / name for name in SOURCE_NAMES))
    if not presentation:
        sources = (*sources, data / "Managed/Assembly-CSharp.dll")
    before = [(p, owned_file(library, p).stat()) for p in sources]
    if not presentation:
        _verify_reviewed_assembly(sources[-1], build.build_id)
    with ExitStack() as stack:
        index_type = PresentationFileIndex if presentation else ArtworkFileIndex
        indexes = {
            name: stack.enter_context(index_type(owned_file(library, data / name)))
            for name in SOURCE_NAMES
        }
        version = indexes["level0"].unity_version
        if (
            not is_sunstone_layout(version) if presentation else version != SUNSTONE_UNITY_VERSION
        ) or any(i.unity_version != version for i in indexes.values()):
            raise UnityMetadataError("Unsupported installed level layout.")

        level0 = indexes["level0"]
        result = []
        for pointer in normal_level_pointers(_run_manager(indexes)):
            target, record = _resolve(indexes, level0, pointer)
            if not _script_is(indexes, target, record, "Level"):
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
