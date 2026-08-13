from __future__ import annotations

import json
import os
import struct
from collections.abc import Iterable
from pathlib import Path

import pytest

from repo_save_editor.services.cosmetics import installed_catalog
from repo_save_editor.services.cosmetics.installed_catalog import (
    CACHE_SCHEMA_VERSION,
    PARSER_SCHEMA_VERSION,
    discover_installed_cosmetic_catalog,
)
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.game.discovery import GameInstallation

_HEADER = struct.Struct(">IIIIB3sIqqq")
_OBJECT = struct.Struct("<qqIi")
UNITY_VERSION = "2022.3.67f2"


def _align(value: int, boundary: int) -> int:
    return (value + boundary - 1) & ~(boundary - 1)


def _aligned_string(value: str) -> bytes:
    raw = value.encode("utf-8")
    data = struct.pack("<i", len(raw)) + raw
    return data + (b"\0" * (_align(len(data), 4) - len(data)))


def _pptr(file_id: int, path_id: int) -> bytes:
    return struct.pack("<iq", file_id, path_id)


def _mono_behaviour_prefix(script_file_id: int, script_path_id: int, name: str = "") -> bytes:
    return (
        _pptr(0, 0) + b"\x01\0\0\0" + _pptr(script_file_id, script_path_id) + _aligned_string(name)
    )


def _mono_script(name: str, class_name: str) -> bytes:
    return (
        _aligned_string(name)
        + struct.pack("<i", 0)
        + (b"\0" * 16)
        + _aligned_string(class_name)
        + _aligned_string("")
        + _aligned_string("Assembly-CSharp")
    )


def _cosmetic_asset(
    name: str,
    *,
    object_name: str = "",
    script_file_id: int = 1,
    script_path_id: int = 1002,
    status: int = 2,
    cosmetic_type: int = 3,
    rarity: int = 4,
) -> bytes:
    return (
        _mono_behaviour_prefix(script_file_id, script_path_id, name=object_name)
        + struct.pack("<i", status)
        + _aligned_string(name)
        + struct.pack("<ii", cosmetic_type, rarity)
    )


def _serialized_type(class_id: int) -> bytes:
    data = struct.pack("<iBh", class_id, 0, -1)
    if class_id == 114:
        data += b"\0" * 16
    return data + (b"\0" * 16)


def _write_serialized_file(
    path: Path,
    objects: Iterable[tuple[int, int, bytes]],
    *,
    externals: tuple[tuple[str, str], ...] = (),
    unity_version: str = UNITY_VERSION,
    serialized_version: int = 22,
) -> None:
    object_list = list(objects)
    class_ids = tuple(dict.fromkeys(class_id for _path_id, class_id, _data in object_list))
    type_ids = {class_id: index for index, class_id in enumerate(class_ids)}

    payload = bytearray()
    records: list[bytes] = []
    for path_id, class_id, data in object_list:
        aligned_start = _align(len(payload), 8)
        if aligned_start > len(payload):
            payload.extend(b"\0" * (aligned_start - len(payload)))
        relative_start = len(payload)
        payload.extend(data)
        records.append(_OBJECT.pack(path_id, relative_start, len(data), type_ids[class_id]))

    metadata = bytearray()
    metadata.extend(unity_version.encode("ascii") + b"\0")
    metadata.extend(struct.pack("<iB", 19, 0))
    metadata.extend(struct.pack("<i", len(class_ids)))
    for class_id in class_ids:
        metadata.extend(_serialized_type(class_id))
    metadata.extend(struct.pack("<i", len(object_list)))
    absolute = 48 + len(metadata)
    if absolute % 4:
        metadata.extend(b"\0" * (4 - absolute % 4))
    metadata.extend(b"".join(records))
    metadata.extend(struct.pack("<i", 0))
    metadata.extend(struct.pack("<i", len(externals)))
    for asset_path, external_path in externals:
        metadata.extend(asset_path.encode("utf-8") + b"\0")
        metadata.extend(b"\0" * 16)
        metadata.extend(struct.pack("<i", 0))
        metadata.extend(external_path.encode("utf-8") + b"\0")
    metadata.extend(struct.pack("<i", 0))
    metadata.extend(b"\0")

    data_offset = _align(48 + len(metadata), 16)
    file_size = data_offset + len(payload)
    header = _HEADER.pack(
        0,
        0,
        serialized_version,
        0,
        0,
        b"\0\0\0",
        len(metadata),
        file_size,
        data_offset,
        0,
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + metadata + (b"\0" * (data_offset - 48 - len(metadata))) + payload)


def _meta_manager_payload(pointers: Iterable[tuple[int, int]], *, decoy: bytes = b"") -> bytes:
    pointer_list = tuple(pointers)
    return (
        _mono_behaviour_prefix(1, 1001, name="MetaManager")
        + decoy
        + struct.pack("<i", len(pointer_list))
        + b"".join(_pptr(file_id, path_id) for file_id, path_id in pointer_list)
    )


def _build_install(
    tmp_path: Path,
    *,
    names: tuple[str, ...] = ("Hat", "Hat", "Glasses"),
    pointers: tuple[tuple[int, int], ...] | None = None,
    extra_meta_managers: int = 0,
    include_meta_manager: bool = True,
    target_class_id: int = 114,
    target_script_class: str = "CosmeticAsset",
    malformed_name_index: int | None = None,
    unresolved_target_external: bool = False,
    target_external_reference: tuple[str, str] | None = None,
    unity_version: str = UNITY_VERSION,
    serialized_version: int = 22,
    build_id: str = "900001",
    malformed_vector: bool = False,
) -> tuple[Path, Path, Path, Path]:
    steamapps = tmp_path / "steamapps"
    game_root = steamapps / "common" / "REPO"
    data_dir = game_root / "REPO_Data"
    catalog_path = data_dir / "StreamingAssets" / "aa" / "catalog.json"
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    catalog_path.write_text("{}", encoding="utf-8")
    manifest = steamapps / "appmanifest_3241660.acf"
    manifest.write_text(
        f'"AppState"\n{{\n"appid" "3241660"\n"buildid" "{build_id}"\n}}\n',
        encoding="utf-8",
    )

    globals_path = data_dir / "globalgamemanagers.assets"
    _write_serialized_file(
        globals_path,
        [
            (1001, 115, _mono_script("MetaManager", "MetaManager")),
            (1002, 115, _mono_script("CosmeticAsset", target_script_class)),
        ],
        unity_version=unity_version,
        serialized_version=serialized_version,
    )

    target_path = data_dir / "sharedassets9.assets"
    target_objects: list[tuple[int, int, bytes]] = []
    target_ids: list[int] = []
    for position, name in enumerate(names):
        path_id = 7000 + position * 17
        target_ids.append(path_id)
        if target_class_id == 114:
            actual_name = "" if malformed_name_index == position else name
            payload = _cosmetic_asset(actual_name)
        else:
            payload = struct.pack("<i", 0)
        target_objects.append((path_id, target_class_id, payload))
    _write_serialized_file(
        target_path,
        target_objects,
        externals=(("archive:/CAB/globalgamemanagers.assets", "globalgamemanagers.assets"),),
        unity_version=unity_version,
        serialized_version=serialized_version,
    )

    if pointers is None:
        pointers = tuple((2, path_id) for path_id in target_ids)

    meta_objects: list[tuple[int, int, bytes]] = []
    if include_meta_manager:
        meta_payload = (
            _mono_behaviour_prefix(1, 1001, name="MetaManager")
            + struct.pack("<i", installed_catalog.MAX_VECTOR_COUNT + 1)
            if malformed_vector
            else _meta_manager_payload(pointers, decoy=struct.pack("<i", -77))
        )
        meta_objects.append((4001, 114, meta_payload))
    meta_objects.extend(
        (
            4100 + number,
            114,
            _meta_manager_payload(pointers, decoy=struct.pack("<i", -88 - number)),
        )
        for number in range(extra_meta_managers)
    )
    level0_path = data_dir / "level0"
    target_external = (
        ("archive:/CAB/missing-target.assets", "missing-target.assets")
        if unresolved_target_external
        else ("archive:/CAB/sharedassets9.assets", "sharedassets9.assets")
    )
    if target_external_reference is not None:
        target_external = target_external_reference
    _write_serialized_file(
        level0_path,
        meta_objects,
        externals=(
            ("archive:/CAB/globalgamemanagers.assets", "globalgamemanagers.assets"),
            target_external,
        ),
        unity_version=unity_version,
        serialized_version=serialized_version,
    )
    return game_root, level0_path, target_path, manifest


def _expected(names: tuple[str, ...]) -> tuple[InstalledCosmeticMetadata, ...]:
    return tuple(
        InstalledCosmeticMetadata(
            cosmetic_id=position,
            asset_name=name,
            cosmetic_type=3,
            rarity=4,
            status=2,
        )
        for position, name in enumerate(names)
    )


def test_dynamic_count_and_duplicate_names_preserve_distinct_position_ids(tmp_path: Path) -> None:
    names = ("Same", "Same", "Third", "Fourth")
    game_root, _level0, _target, _manifest = _build_install(tmp_path, names=names)

    result = discover_installed_cosmetic_catalog(game_root, cache_dir=tmp_path / "cache")

    assert result == _expected(names)
    assert len(result or ()) == 4
    assert result is not None
    assert result[0].asset_name == result[1].asset_name
    assert result[0].cosmetic_id != result[1].cosmetic_id


def test_cosmetic_cache_identity_uses_object_name_not_duplicate_display_name(
    tmp_path: Path,
) -> None:
    game_root, _level0, target_path, _manifest = _build_install(tmp_path, names=("Same", "Same"))
    _write_serialized_file(
        target_path,
        [
            (7000, 114, _cosmetic_asset("Same", object_name="Hat Alpha")),
            (7017, 114, _cosmetic_asset("Same", object_name="Hat Beta(Clone)")),
        ],
        externals=(("archive:/CAB/globalgamemanagers.assets", "globalgamemanagers.assets"),),
    )

    result = discover_installed_cosmetic_catalog(game_root, cache_dir=tmp_path / "cache")

    assert result is not None
    assert [entry.asset_name for entry in result] == ["Same", "Same"]
    assert [entry.icon_cache_key for entry in result] == ["hat alpha.png", "hat beta.png"]


@pytest.mark.parametrize(
    ("include_meta_manager", "extra_meta_managers"),
    [(False, 0), (True, 1)],
)
def test_missing_or_ambiguous_meta_manager_fails_soft(
    tmp_path: Path,
    include_meta_manager: bool,
    extra_meta_managers: int,
) -> None:
    game_root, _level0, _target, _manifest = _build_install(
        tmp_path,
        include_meta_manager=include_meta_manager,
        extra_meta_managers=extra_meta_managers,
    )

    assert discover_installed_cosmetic_catalog(game_root, cache_dir=tmp_path / "cache") is None


@pytest.mark.parametrize(
    "pointers",
    [
        ((2, 7000), (2, 0), (2, 7034)),
        ((2, 7000), (2, 7000), (2, 7034)),
    ],
)
def test_null_or_duplicate_catalog_pointer_fails_soft(
    tmp_path: Path,
    pointers: tuple[tuple[int, int], ...],
) -> None:
    game_root, _level0, _target, _manifest = _build_install(tmp_path, pointers=pointers)

    assert discover_installed_cosmetic_catalog(game_root, cache_dir=tmp_path / "cache") is None


def test_malformed_pointer_vector_fails_soft(tmp_path: Path) -> None:
    game_root, _level0, _target, _manifest = _build_install(tmp_path, malformed_vector=True)

    assert discover_installed_cosmetic_catalog(game_root, cache_dir=tmp_path / "cache") is None


def test_external_resolution_can_use_asset_path_when_path_is_stale(tmp_path: Path) -> None:
    names = ("A", "B")
    game_root, _level0, _target, _manifest = _build_install(
        tmp_path,
        names=names,
        target_external_reference=(
            "archive:/CAB/sharedassets9.assets",
            "stale-name.assets",
        ),
    )

    assert discover_installed_cosmetic_catalog(
        game_root, cache_dir=tmp_path / "cache"
    ) == _expected(names)


def test_unresolved_external_fails_soft(tmp_path: Path) -> None:
    game_root, _level0, _target, _manifest = _build_install(
        tmp_path,
        unresolved_target_external=True,
    )

    assert discover_installed_cosmetic_catalog(game_root, cache_dir=tmp_path / "cache") is None


@pytest.mark.parametrize(
    ("target_class_id", "target_script_class"),
    [(1, "CosmeticAsset"), (114, "NotCosmeticAsset")],
)
def test_wrong_target_type_or_script_class_fails_soft(
    tmp_path: Path,
    target_class_id: int,
    target_script_class: str,
) -> None:
    game_root, _level0, _target, _manifest = _build_install(
        tmp_path,
        target_class_id=target_class_id,
        target_script_class=target_script_class,
    )

    assert discover_installed_cosmetic_catalog(game_root, cache_dir=tmp_path / "cache") is None


def test_malformed_metadata_fails_soft(tmp_path: Path) -> None:
    game_root, _level0, _target, _manifest = _build_install(tmp_path, malformed_name_index=1)

    assert discover_installed_cosmetic_catalog(game_root, cache_dir=tmp_path / "cache") is None


@pytest.mark.parametrize(
    ("unity_version", "serialized_version"),
    [("2021.3.0f1", 22), (UNITY_VERSION, 21)],
)
def test_unsupported_serialized_layout_fails_soft(
    tmp_path: Path,
    unity_version: str,
    serialized_version: int,
) -> None:
    game_root, _level0, _target, _manifest = _build_install(
        tmp_path,
        unity_version=unity_version,
        serialized_version=serialized_version,
    )

    assert discover_installed_cosmetic_catalog(game_root, cache_dir=tmp_path / "cache") is None


def test_cache_hit_avoids_rescan(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    names = ("A", "B", "C")
    game_root, _level0, _target, _manifest = _build_install(tmp_path, names=names)
    cache_dir = tmp_path / "cache"
    assert discover_installed_cosmetic_catalog(game_root, cache_dir=cache_dir) == _expected(names)

    def fail_scan(_installation: object) -> object:
        raise AssertionError("cache hit unexpectedly rescanned serialized files")

    monkeypatch.setattr(installed_catalog, "_scan_catalog", fail_scan)
    assert discover_installed_cosmetic_catalog(game_root, cache_dir=cache_dir) == _expected(names)


def test_empty_cached_catalog_is_rejected_and_rebuilt(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    names = ("A", "B")
    game_root, _level0, _target, _manifest = _build_install(tmp_path, names=names)
    cache_dir = tmp_path / "cache"
    cache_path = cache_dir / "installed-cosmetics.json"
    assert discover_installed_cosmetic_catalog(game_root, cache_dir=cache_dir) == _expected(names)

    payload = json.loads(cache_path.read_text(encoding="utf-8"))
    payload["catalog"] = []
    cache_path.write_text(json.dumps(payload), encoding="utf-8")

    original = installed_catalog._scan_catalog
    calls = 0

    def counted_scan(
        installation: GameInstallation,
    ) -> tuple[tuple[InstalledCosmeticMetadata, ...], tuple[Path, ...]]:
        nonlocal calls
        calls += 1
        return original(installation)

    monkeypatch.setattr(installed_catalog, "_scan_catalog", counted_scan)
    assert discover_installed_cosmetic_catalog(game_root, cache_dir=cache_dir) == _expected(names)
    assert calls == 1
    replacement = json.loads(cache_path.read_text(encoding="utf-8"))
    assert [row["assetName"] for row in replacement["catalog"]] == list(names)


def test_cache_invalidates_when_steam_build_changes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    names = ("A", "B")
    game_root, _level0, _target, manifest = _build_install(tmp_path, names=names)
    cache_dir = tmp_path / "cache"
    assert discover_installed_cosmetic_catalog(game_root, cache_dir=cache_dir) == _expected(names)
    manifest.write_text(
        '"AppState"\n{\n"appid" "3241660"\n"buildid" "900002"\n}\n',
        encoding="utf-8",
    )

    original = installed_catalog._scan_catalog
    calls = 0

    def counted_scan(
        installation: GameInstallation,
    ) -> tuple[tuple[InstalledCosmeticMetadata, ...], tuple[Path, ...]]:
        nonlocal calls
        calls += 1
        return original(installation)

    monkeypatch.setattr(installed_catalog, "_scan_catalog", counted_scan)
    assert discover_installed_cosmetic_catalog(game_root, cache_dir=cache_dir) == _expected(names)
    assert calls == 1


def test_cache_invalidates_when_level0_or_resolved_external_identity_changes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    names = ("A", "B")
    game_root, level0, target, _manifest = _build_install(tmp_path, names=names)
    cache_dir = tmp_path / "cache"
    assert discover_installed_cosmetic_catalog(game_root, cache_dir=cache_dir) == _expected(names)

    original = installed_catalog._scan_catalog
    calls = 0

    def counted_scan(
        installation: GameInstallation,
    ) -> tuple[tuple[InstalledCosmeticMetadata, ...], tuple[Path, ...]]:
        nonlocal calls
        calls += 1
        return original(installation)

    monkeypatch.setattr(installed_catalog, "_scan_catalog", counted_scan)

    for path in (level0, target):
        stat = path.stat()
        os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))
        assert discover_installed_cosmetic_catalog(game_root, cache_dir=cache_dir) == _expected(
            names
        )
    assert calls == 2


@pytest.mark.parametrize(
    ("field", "value"),
    [("schema", CACHE_SCHEMA_VERSION + 1), ("parserSchema", PARSER_SCHEMA_VERSION + 1)],
)
def test_cache_schema_change_invalidates_existing_cache(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    field: str,
    value: int,
) -> None:
    names = ("A", "B")
    game_root, _level0, _target, _manifest = _build_install(tmp_path, names=names)
    cache_dir = tmp_path / "cache"
    cache_path = cache_dir / "installed-cosmetics.json"
    assert discover_installed_cosmetic_catalog(game_root, cache_dir=cache_dir) == _expected(names)
    payload = json.loads(cache_path.read_text(encoding="utf-8"))
    payload[field] = value
    cache_path.write_text(json.dumps(payload), encoding="utf-8")

    original = installed_catalog._scan_catalog
    calls = 0

    def counted_scan(
        installation: GameInstallation,
    ) -> tuple[tuple[InstalledCosmeticMetadata, ...], tuple[Path, ...]]:
        nonlocal calls
        calls += 1
        return original(installation)

    monkeypatch.setattr(installed_catalog, "_scan_catalog", counted_scan)
    assert discover_installed_cosmetic_catalog(game_root, cache_dir=cache_dir) == _expected(names)
    assert calls == 1


def test_corrupted_or_stale_cache_is_ignored_and_replaced(tmp_path: Path) -> None:
    names = ("A", "B")
    game_root, _level0, _target, _manifest = _build_install(tmp_path, names=names)
    cache_dir = tmp_path / "cache"
    cache_path = cache_dir / "installed-cosmetics.json"
    cache_dir.mkdir(parents=True)
    cache_path.write_text("{broken", encoding="utf-8")

    assert discover_installed_cosmetic_catalog(game_root, cache_dir=cache_dir) == _expected(names)
    payload = json.loads(cache_path.read_text(encoding="utf-8"))
    assert payload["schema"] == CACHE_SCHEMA_VERSION
    assert payload["parserSchema"] == PARSER_SCHEMA_VERSION
    assert payload["catalog"][0]["assetName"] == "A"
    assert "owned" not in cache_path.read_text(encoding="utf-8").casefold()
    assert "artwork" not in cache_path.read_text(encoding="utf-8").casefold()


def test_atomic_cache_replacement_uses_same_directory_temp_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    names = ("A", "B")
    game_root, level0, _target, _manifest = _build_install(tmp_path, names=names)
    cache_dir = tmp_path / "cache"
    assert discover_installed_cosmetic_catalog(game_root, cache_dir=cache_dir) == _expected(names)
    cache_path = cache_dir / "installed-cosmetics.json"

    original_replace = os.replace
    replacements: list[tuple[Path, Path]] = []

    def recording_replace(
        source: str | os.PathLike[str],
        destination: str | os.PathLike[str],
    ) -> None:
        replacements.append((Path(source), Path(destination)))
        original_replace(source, destination)

    monkeypatch.setattr(installed_catalog.os, "replace", recording_replace)
    stat = level0.stat()
    os.utime(level0, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))

    assert discover_installed_cosmetic_catalog(game_root, cache_dir=cache_dir) == _expected(names)
    assert replacements
    temporary, destination = replacements[-1]
    assert destination == cache_path
    assert temporary.parent == cache_path.parent
    assert not temporary.exists()
    assert cache_path.is_file()


def test_missing_or_wrong_manifest_disables_cache_without_blocking_discovery(
    tmp_path: Path,
) -> None:
    names = ("A", "B")
    game_root, _level0, _target, manifest = _build_install(tmp_path, names=names)
    cache_dir = tmp_path / "cache"
    manifest.write_text(
        '"AppState"\n{\n"appid" "999"\n"buildid" "900001"\n}\n',
        encoding="utf-8",
    )

    assert discover_installed_cosmetic_catalog(game_root, cache_dir=cache_dir) == _expected(names)
    assert not (cache_dir / "installed-cosmetics.json").exists()
