"""Installed R.E.P.O. cosmetic catalog discovery and derived metadata cache.

The persistent JSON cache is a performance artifact containing derived catalog/
presentation metadata only. It is not mutation authorization, ownership evidence, or
an independent source of trust. Any save-mutation path must preserve its own validation
boundary and must not broaden write capability merely because an ID is present in cached
metadata.
"""

from __future__ import annotations

import json
import os
import re
import struct
import tempfile
from collections import Counter
from collections.abc import Iterable
from contextlib import AbstractContextManager, suppress
from pathlib import Path
from typing import Final

from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.game.discovery import GameInstallation, discover_game_installation
from repo_save_editor.services.items.unity_serialized import (
    MONO_BEHAVIOUR_CLASS_ID,
    MonoBehaviourPrefix,
    ObjectRecord,
    PPtr,
    SerializedFileIndex,
    parse_mono_behaviour_prefix,
    parse_mono_script,
)

STEAM_APP_ID: Final = "3241660"
LEVEL0_RELATIVE_PATH: Final = Path("REPO_Data/level0")
META_MANAGER_CLASS: Final = "MetaManager"
COSMETIC_ASSET_CLASS: Final = "CosmeticAsset"
MAX_VECTOR_COUNT: Final = 100_000
MAX_OPEN_FILES: Final = 128
CACHE_SCHEMA_VERSION: Final = 1
PARSER_SCHEMA_VERSION: Final = 1
CACHE_FILE_NAME: Final = "installed-cosmetics.json"
APP_MANIFEST_NAME: Final = f"appmanifest_{STEAM_APP_ID}.acf"
MANIFEST_VALUE_PATTERN: Final = re.compile(
    r'"(?P<key>appid|buildid)"\s+"(?P<value>[^"]+)"', re.IGNORECASE
)


class InstalledCosmeticCatalogError(ValueError):
    """Installed cosmetic metadata is missing, ambiguous, malformed, or unsupported."""


class _Resolver(AbstractContextManager["_Resolver"]):
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir.resolve()
        self._indexes: dict[str, SerializedFileIndex] = {}
        self._external_paths: dict[tuple[str, int], Path] = {}

    def __exit__(self, *_exc: object) -> None:
        for index in self._indexes.values():
            index.close()
        self._indexes.clear()

    def open(self, path: Path) -> SerializedFileIndex:
        resolved = path.resolve()
        key = os.path.normcase(os.fspath(resolved))
        if key not in self._indexes:
            if len(self._indexes) >= MAX_OPEN_FILES:
                raise InstalledCosmeticCatalogError("Too many serialized files were required.")
            if not resolved.is_file():
                raise InstalledCosmeticCatalogError("A required serialized file is missing.")
            self._indexes[key] = SerializedFileIndex(resolved)
        return self._indexes[key]

    def external_path(self, source: SerializedFileIndex, file_id: int) -> Path:
        source_key = os.path.normcase(os.fspath(source.path.resolve()))
        cache_key = (source_key, file_id)
        cached = self._external_paths.get(cache_key)
        if cached is not None:
            return cached

        names = source.external_names(file_id)
        matches: dict[str, Path] = {}
        for name in names:
            candidate = (self.data_dir / name).resolve()
            if candidate.is_file():
                matches[os.path.normcase(os.fspath(candidate))] = candidate
        if len(matches) != 1:
            raise InstalledCosmeticCatalogError(
                "A serialized external FileID could not be resolved uniquely."
            )
        resolved = next(iter(matches.values()))
        self._external_paths[cache_key] = resolved
        return resolved

    def target_index(self, source: SerializedFileIndex, file_id: int) -> SerializedFileIndex:
        if file_id == 0:
            return source
        if file_id < 0:
            raise InstalledCosmeticCatalogError(
                "Negative serialized external FileID is unsupported."
            )
        return self.open(self.external_path(source, file_id))

    def resolve(
        self,
        source: SerializedFileIndex,
        pointer: PPtr,
    ) -> tuple[SerializedFileIndex, ObjectRecord]:
        if pointer.path_id == 0:
            raise InstalledCosmeticCatalogError("A required serialized pointer is null.")
        target = self.target_index(source, pointer.file_id)
        try:
            record = target.find_records({pointer.path_id})[pointer.path_id]
        except KeyError as error:
            raise InstalledCosmeticCatalogError(
                "A required serialized pointer could not be resolved."
            ) from error
        return target, record


def _script_identity(
    resolver: _Resolver,
    source: SerializedFileIndex,
    record: ObjectRecord,
) -> tuple[MonoBehaviourPrefix, str, Path]:
    prefix = parse_mono_behaviour_prefix(source, record)
    if prefix.script.path_id == 0:
        raise InstalledCosmeticCatalogError("MonoBehaviour has a null script pointer.")
    script_index, script_record = resolver.resolve(source, prefix.script)
    script = parse_mono_script(script_index, script_record)
    return prefix, script.class_name, script_index.path.resolve()


def _find_unique_meta_manager(
    resolver: _Resolver,
    level0: SerializedFileIndex,
) -> tuple[ObjectRecord, MonoBehaviourPrefix, Path]:
    matches: list[tuple[ObjectRecord, MonoBehaviourPrefix, Path]] = []
    for record in level0.iter_records(frozenset({MONO_BEHAVIOUR_CLASS_ID})):
        prefix, class_name, script_path = _script_identity(resolver, level0, record)
        if class_name == META_MANAGER_CLASS:
            matches.append((record, prefix, script_path))
    if len(matches) != 1:
        raise InstalledCosmeticCatalogError(
            "Installed level0 does not contain exactly one MetaManager."
        )
    return matches[0]


def _target_is_cosmetic(
    resolver: _Resolver,
    source: SerializedFileIndex,
    pointer: PPtr,
) -> tuple[SerializedFileIndex, ObjectRecord] | None:
    try:
        target_index, target_record = resolver.resolve(source, pointer)
        if target_record.class_id != MONO_BEHAVIOUR_CLASS_ID:
            return None
        _prefix, class_name, _script_path = _script_identity(
            resolver,
            target_index,
            target_record,
        )
        if class_name != COSMETIC_ASSET_CLASS:
            return None
        return target_index, target_record
    except (OSError, struct.error, ValueError):
        return None


def _target_key(index: SerializedFileIndex, record: ObjectRecord) -> tuple[str, int]:
    return os.path.normcase(os.fspath(index.path.resolve())), record.path_id


def _find_cosmetic_vector(
    resolver: _Resolver,
    level0: SerializedFileIndex,
    meta_record: ObjectRecord,
    meta_prefix: MonoBehaviourPrefix,
) -> tuple[PPtr, ...]:
    custom_start = meta_record.byte_start + meta_prefix.field_offset
    record_end = meta_record.byte_start + meta_record.byte_size
    accepted: list[tuple[tuple[PPtr, ...], frozenset[tuple[str, int]]]] = []

    for absolute in range((custom_start + 3) & ~3, record_end - 3, 4):
        pointers = level0.read_pptr_vector(meta_record, absolute, maximum=MAX_VECTOR_COUNT)
        if pointers is None or pointers[0].path_id == 0:
            continue
        first = _target_is_cosmetic(resolver, level0, pointers[0])
        if first is None:
            continue

        resolved: list[tuple[SerializedFileIndex, ObjectRecord]] = [first]
        complete = True
        for pointer in pointers[1:]:
            if pointer.path_id == 0:
                complete = False
                break
            target = _target_is_cosmetic(resolver, level0, pointer)
            if target is None:
                complete = False
                break
            resolved.append(target)
        if not complete:
            continue

        keys = frozenset(_target_key(index, record) for index, record in resolved)
        if len(keys) != len(resolved):
            continue
        accepted.append((pointers, keys))

    if not accepted:
        raise InstalledCosmeticCatalogError(
            "MetaManager has no complete all-CosmeticAsset pointer vector."
        )

    max_count = max(len(pointers) for pointers, _keys in accepted)
    maxima = [(pointers, keys) for pointers, keys in accepted if len(pointers) == max_count]
    if len(maxima) != 1:
        raise InstalledCosmeticCatalogError("The installed cosmetic pointer vector is ambiguous.")

    chosen_pointers, chosen_keys = maxima[0]
    for pointers, keys in accepted:
        if pointers is chosen_pointers:
            continue
        if not keys <= chosen_keys:
            raise InstalledCosmeticCatalogError(
                "MetaManager contains incompatible complete cosmetic pointer vectors."
            )
    return chosen_pointers


def _parse_cosmetic_metadata(
    resolver: _Resolver,
    index: SerializedFileIndex,
    record: ObjectRecord,
    cosmetic_id: int,
) -> tuple[InstalledCosmeticMetadata, Path]:
    prefix, class_name, script_path = _script_identity(resolver, index, record)
    if class_name != COSMETIC_ASSET_CLASS:
        raise InstalledCosmeticCatalogError("A catalog target is not CosmeticAsset.")

    reader = index.object_reader(record)
    reader.pos = record.byte_start + prefix.field_offset
    status = reader.i32()
    asset_name = reader.aligned_string()
    cosmetic_type = reader.i32()
    rarity = reader.i32()
    if not asset_name:
        raise InstalledCosmeticCatalogError("CosmeticAsset metadata has an empty assetName.")
    return (
        InstalledCosmeticMetadata(
            cosmetic_id=cosmetic_id,
            asset_name=asset_name,
            cosmetic_type=cosmetic_type,
            rarity=rarity,
            status=status,
        ),
        script_path,
    )


def _scan_catalog(
    installation: GameInstallation,
) -> tuple[tuple[InstalledCosmeticMetadata, ...], tuple[Path, ...]]:
    game_root = installation.root.resolve()
    data_dir = game_root / "REPO_Data"
    level0_path = game_root / LEVEL0_RELATIVE_PATH
    if not level0_path.is_file():
        raise InstalledCosmeticCatalogError("Installed level0 is missing.")

    relevant_paths: dict[str, Path] = {
        os.path.normcase(os.fspath(level0_path.resolve())): level0_path.resolve()
    }
    with _Resolver(data_dir) as resolver:
        level0 = resolver.open(level0_path)
        meta_record, meta_prefix, meta_script_path = _find_unique_meta_manager(resolver, level0)
        relevant_paths[os.path.normcase(os.fspath(meta_script_path))] = meta_script_path
        pointers = _find_cosmetic_vector(resolver, level0, meta_record, meta_prefix)

        catalog: list[InstalledCosmeticMetadata] = []
        target_keys: list[tuple[str, int]] = []
        for cosmetic_id, pointer in enumerate(pointers):
            target_index, target_record = resolver.resolve(level0, pointer)
            if target_record.class_id != MONO_BEHAVIOUR_CLASS_ID:
                raise InstalledCosmeticCatalogError("A catalog target is not MonoBehaviour.")
            metadata, script_path = _parse_cosmetic_metadata(
                resolver,
                target_index,
                target_record,
                cosmetic_id,
            )
            catalog.append(metadata)
            target_keys.append(_target_key(target_index, target_record))
            target_path = target_index.path.resolve()
            relevant_paths[os.path.normcase(os.fspath(target_path))] = target_path
            relevant_paths[os.path.normcase(os.fspath(script_path))] = script_path

        duplicates = [key for key, count in Counter(target_keys).items() if count > 1]
        if duplicates:
            raise InstalledCosmeticCatalogError("The installed cosmetic catalog repeats a target.")
        if tuple(entry.cosmetic_id for entry in catalog) != tuple(range(len(catalog))):
            raise InstalledCosmeticCatalogError(
                "Installed cosmetic IDs are not contiguous positions."
            )
        return tuple(catalog), tuple(relevant_paths.values())


def _manifest_path(installation: GameInstallation) -> Path | None:
    if installation.steam_library_root is not None:
        return installation.steam_library_root / "steamapps" / APP_MANIFEST_NAME
    root = installation.root
    if (
        root.parent.name.casefold() == "common"
        and root.parent.parent.name.casefold() == "steamapps"
    ):
        return root.parent.parent / APP_MANIFEST_NAME
    return None


def _steam_build_id(installation: GameInstallation) -> str | None:
    manifest = _manifest_path(installation)
    if manifest is None:
        return None
    try:
        text = manifest.read_text(encoding="utf-8", errors="strict")
    except (OSError, UnicodeError):
        return None
    values = {
        match.group("key").casefold(): match.group("value")
        for match in MANIFEST_VALUE_PATTERN.finditer(text)
    }
    app_id = values.get("appid")
    build_id = values.get("buildid")
    if app_id != STEAM_APP_ID or build_id is None or not build_id.isdigit():
        return None
    return build_id


def _default_cache_dir() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "RepoDitor" / "cache" / "cosmetics"
    xdg_cache_home = os.environ.get("XDG_CACHE_HOME")
    if xdg_cache_home:
        return Path(xdg_cache_home) / "repoditor" / "cosmetics"
    return Path.home() / ".cache" / "repoditor" / "cosmetics"


def _cache_path(cache_dir: Path | None) -> Path:
    return (cache_dir if cache_dir is not None else _default_cache_dir()) / CACHE_FILE_NAME


def _relative_file_identity(game_root: Path, path: Path) -> dict[str, object]:
    resolved_root = game_root.resolve()
    resolved = path.resolve()
    if not resolved.is_relative_to(resolved_root):
        raise InstalledCosmeticCatalogError("A relevant serialized file is outside the game root.")
    stat = resolved.stat()
    return {
        "path": resolved.relative_to(resolved_root).as_posix(),
        "size": stat.st_size,
        "mtimeNs": stat.st_mtime_ns,
    }


def _file_identities(game_root: Path, paths: Iterable[Path]) -> tuple[dict[str, object], ...]:
    identities = [_relative_file_identity(game_root, path) for path in paths]
    identities.sort(key=lambda identity: str(identity["path"]).casefold())
    return tuple(identities)


def _catalog_payload(catalog: Iterable[InstalledCosmeticMetadata]) -> list[dict[str, object]]:
    return [
        {
            "id": entry.cosmetic_id,
            "assetName": entry.asset_name,
            "type": entry.cosmetic_type,
            "rarity": entry.rarity,
            "status": entry.status,
        }
        for entry in catalog
    ]


def _parse_cached_catalog(value: object) -> tuple[InstalledCosmeticMetadata, ...] | None:
    if not isinstance(value, list) or not value:
        return None
    catalog: list[InstalledCosmeticMetadata] = []
    for position, row in enumerate(value):
        if not isinstance(row, dict):
            return None
        cosmetic_id = row.get("id")
        asset_name = row.get("assetName")
        cosmetic_type = row.get("type")
        rarity = row.get("rarity")
        status = row.get("status")
        if (
            type(cosmetic_id) is not int
            or cosmetic_id != position
            or not isinstance(asset_name, str)
            or not asset_name
            or type(cosmetic_type) is not int
            or type(rarity) is not int
            or type(status) is not int
        ):
            return None
        catalog.append(
            InstalledCosmeticMetadata(
                cosmetic_id=cosmetic_id,
                asset_name=asset_name,
                cosmetic_type=cosmetic_type,
                rarity=rarity,
                status=status,
            )
        )
    return tuple(catalog)


def _cache_files_match(game_root: Path, value: object) -> bool:
    if not isinstance(value, list) or not value:
        return False
    root = game_root.resolve()
    seen: set[str] = set()
    for row in value:
        if not isinstance(row, dict):
            return False
        relative = row.get("path")
        size = row.get("size")
        mtime_ns = row.get("mtimeNs")
        if (
            not isinstance(relative, str)
            or not relative
            or type(size) is not int
            or type(mtime_ns) is not int
        ):
            return False
        candidate = (root / Path(relative)).resolve()
        if not candidate.is_relative_to(root):
            return False
        key = os.path.normcase(os.fspath(candidate))
        if key in seen:
            return False
        seen.add(key)
        try:
            stat = candidate.stat()
        except OSError:
            return False
        if not candidate.is_file() or stat.st_size != size or stat.st_mtime_ns != mtime_ns:
            return False
    return True


def _read_cache(
    path: Path,
    *,
    game_root: Path,
    build_id: str,
) -> tuple[InstalledCosmeticMetadata, ...] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8", errors="strict"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    if (
        payload.get("schema") != CACHE_SCHEMA_VERSION
        or payload.get("parserSchema") != PARSER_SCHEMA_VERSION
        or payload.get("steamBuildId") != build_id
    ):
        return None
    cached_root = payload.get("gameRoot")
    if not isinstance(cached_root, str):
        return None
    if os.path.normcase(cached_root) != os.path.normcase(os.fspath(game_root.resolve())):
        return None
    if not _cache_files_match(game_root, payload.get("files")):
        return None
    return _parse_cached_catalog(payload.get("catalog"))


def _write_cache_atomic(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        with suppress(OSError):
            temporary.unlink(missing_ok=True)


def discover_installed_cosmetic_catalog(
    game_dir: Path | None = None,
    *,
    cache_dir: Path | None = None,
) -> tuple[InstalledCosmeticMetadata, ...] | None:
    """Return the complete installed cosmetic catalog, or ``None`` on uncertainty.

    The cache contains derived catalog/presentation metadata only. It is not mutation
    authorization or ownership evidence; mutation callers must keep a separate
    trust/validation boundary and must not infer write permission from cached IDs.
    A cache is used only when a Steam build identity is available; otherwise
    discovery still scans the installed serialized files and fails soft on any
    unsupported layout.
    """
    discovery = discover_game_installation(game_dir)
    installation = discovery.installation
    if installation is None:
        return None

    build_id = _steam_build_id(installation)
    path = _cache_path(cache_dir)
    if build_id is not None:
        cached = _read_cache(path, game_root=installation.root, build_id=build_id)
        if cached is not None:
            return cached

    try:
        catalog, relevant_paths = _scan_catalog(installation)
        if build_id is not None:
            payload: dict[str, object] = {
                "schema": CACHE_SCHEMA_VERSION,
                "parserSchema": PARSER_SCHEMA_VERSION,
                "steamBuildId": build_id,
                "gameRoot": os.fspath(installation.root.resolve()),
                "files": list(_file_identities(installation.root, relevant_paths)),
                "catalog": _catalog_payload(catalog),
            }
            with suppress(OSError):
                _write_cache_atomic(path, payload)
        return catalog
    except (OSError, struct.error, OverflowError, ValueError):
        return None


__all__ = ["InstalledCosmeticCatalogError", "discover_installed_cosmetic_catalog"]
