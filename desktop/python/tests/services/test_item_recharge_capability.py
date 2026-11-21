from __future__ import annotations

import os
import struct
from collections.abc import Iterable
from dataclasses import replace
from pathlib import Path

import pytest

from repo_save_editor.services.game.discovery import discover_game_installation
from repo_save_editor.services.items import recharge_capability, recharge_evidence
from repo_save_editor.services.items.installed_metadata import (
    InstalledItemCatalogError,
    _parse_game_object,
    _read_game_object_name,
    discover_installed_item_catalog,
    discover_item_recharge_capabilities,
)
from repo_save_editor.services.items.installed_metadata import (
    discover_installed_item_metadata as discover_reviewed_item_metadata,
)
from repo_save_editor.services.items.models import InstalledItemMetadata, ItemRechargeCapability
from repo_save_editor.services.items.recharge_capability import (
    discover_installed_item_metadata_with_evidence,
    discover_installed_recharge_capabilities,
)
from repo_save_editor.services.items.runtime_metadata import discover_installed_item_metadata
from repo_save_editor.services.native_artwork_cache import artwork_cache_root
from repo_save_editor.services.unity_artwork import SUNSTONE_UNITY_VERSION
from repo_save_editor.services.unity_serialized import (
    UNITY_VERSION,
    SerializedFileIndex,
    UnityMetadataError,
)
from tests.unity_serialized_fixture import (
    aligned_string as _aligned_string,
)
from tests.unity_serialized_fixture import (
    mono_script as _mono_script,
)
from tests.unity_serialized_fixture import (
    pptr as _pptr,
)
from tests.unity_serialized_fixture import (
    write_serialized_file as _write_serialized_file,
)


def _game_object(name: str, components: Iterable[int]) -> bytes:
    component_ids = tuple(components)
    return (
        struct.pack("<i", len(component_ids))
        + b"".join(_pptr(0, path_id) for path_id in component_ids)
        + struct.pack("<i", 0)
        + _aligned_string(name)
    )


def _mono_behaviour(
    name: str,
    game_object_id: int,
    script_id: int,
    *,
    battery_bars: int | None = None,
    exceptional_flag: int = 0,
) -> bytes:
    data = _pptr(0, game_object_id) + b"\x01\0\0\0" + _pptr(1, script_id)
    data += _aligned_string(name)
    if battery_bars is not None:
        data += struct.pack("<iB", battery_bars, exceptional_flag)
    return data


def _build_assets(
    root: Path,
    *,
    prefix_objects: Iterable[tuple[int, int, bytes]] = (),
    unity_version: str = UNITY_VERSION,
) -> tuple[Path, Path]:
    resources = root / "resources.assets"
    globals_ = root / "globalgamemanagers.assets"

    _write_serialized_file(
        globals_,
        [
            (1001, 115, _mono_script("Item", "Item")),
            (1002, 115, _mono_script("ItemBattery", "ItemBattery")),
        ],
        unity_version=unity_version,
    )
    _write_serialized_file(
        resources,
        [
            *prefix_objects,
            (1, 1, _game_object("Item Rechargeable", (11, 12))),
            (11, 114, _mono_behaviour("Item Rechargeable", 1, 1001)),
            (12, 114, _mono_behaviour("", 1, 1002, battery_bars=5)),
            (2, 1, _game_object("Item Not Rechargeable", (21,))),
            (21, 114, _mono_behaviour("Item Not Rechargeable", 2, 1001)),
            (3, 1, _game_object("Item Drone Battery", (31, 32))),
            (31, 114, _mono_behaviour("Item Drone Battery", 3, 1001)),
            (
                32,
                114,
                _mono_behaviour(
                    "",
                    3,
                    1002,
                    battery_bars=12,
                    exceptional_flag=1,
                ),
            ),
            (4, 1, _game_object("Item Conflict", (41, 42))),
            (41, 114, _mono_behaviour("Item Conflict", 4, 1001)),
            (42, 114, _mono_behaviour("", 4, 1002, battery_bars=6)),
            (5, 1, _game_object("Item Conflict", ())),
        ],
        externals=(("", "globalgamemanagers.assets"),),
        unity_version=unity_version,
    )
    return resources, globals_


def test_private_item_reader_requires_the_exact_reviewed_version_for_both_sources(
    tmp_path: Path,
) -> None:
    resources, managers = _build_assets(tmp_path, unity_version=SUNSTONE_UNITY_VERSION)
    name = "Item Rechargeable"
    for version, expected in (
        (None, ItemRechargeCapability.UNKNOWN),
        (UNITY_VERSION, ItemRechargeCapability.UNKNOWN),
        (SUNSTONE_UNITY_VERSION, ItemRechargeCapability.RECHARGEABLE),
    ):
        result = discover_installed_item_metadata(
            resources, managers, (name,), unity_version=version
        )
        assert result[name].recharge_capability is expected
    legacy = tmp_path / "legacy"
    legacy.mkdir()
    _, wrong_managers = _build_assets(legacy)
    result = discover_installed_item_metadata(
        resources, wrong_managers, (name,), unity_version=SUNSTONE_UNITY_VERSION
    )
    assert result[name].recharge_capability is ItemRechargeCapability.UNKNOWN


def test_runtime_and_evidence_readers_agree_on_legacy_item_metadata(tmp_path: Path) -> None:
    resources, managers = _build_assets(tmp_path)
    names = ("Item Rechargeable", "Item Not Rechargeable", "Item Conflict", "Missing")
    assert discover_installed_item_metadata(resources, managers, names) == (
        discover_reviewed_item_metadata(resources, managers, names)
    )


def test_dynamic_mapping_classifies_rechargeable_not_rechargeable_and_exceptional_unknown(
    tmp_path: Path,
) -> None:
    resources, globals_ = _build_assets(tmp_path)

    result = discover_item_recharge_capabilities(
        resources,
        globals_,
        ("Item Rechargeable", "Item Not Rechargeable", "Item Drone Battery"),
    )

    assert result == {
        "Item Rechargeable": ItemRechargeCapability.RECHARGEABLE,
        "Item Not Rechargeable": ItemRechargeCapability.NOT_RECHARGEABLE,
        "Item Drone Battery": ItemRechargeCapability.UNKNOWN,
    }


def test_complete_catalog_discovers_item_definitions_without_a_candidate_list(
    tmp_path: Path,
) -> None:
    resources, globals_ = _build_assets(tmp_path)

    result = discover_installed_item_catalog(resources, globals_)

    assert {name: metadata.recharge_capability for name, metadata in result.items()} == {
        "Item Conflict": ItemRechargeCapability.UNKNOWN,
        "Item Drone Battery": ItemRechargeCapability.UNKNOWN,
        "Item Not Rechargeable": ItemRechargeCapability.NOT_RECHARGEABLE,
        "Item Rechargeable": ItemRechargeCapability.RECHARGEABLE,
    }


def test_complete_catalog_extraction_failure_cannot_look_like_an_empty_catalog(
    tmp_path: Path,
) -> None:
    resources, globals_ = _build_assets(tmp_path)
    resources.unlink()

    with pytest.raises(InstalledItemCatalogError):
        discover_installed_item_catalog(resources, globals_)


def test_dynamic_mapping_returns_canonical_prefab_icon_key(tmp_path: Path) -> None:
    resources, globals_ = _build_assets(tmp_path)

    result = discover_installed_item_metadata(
        resources, globals_, ("Item Rechargeable", "Item Conflict")
    )

    assert result["Item Rechargeable"].icon_cache_key == "item rechargeable.png"
    assert result["Item Conflict"].icon_cache_key == "item conflict.png"


def test_dynamic_mapping_retains_all_same_identity_variants_and_conflict_is_unknown(
    tmp_path: Path,
) -> None:
    resources, globals_ = _build_assets(tmp_path)

    result = discover_item_recharge_capabilities(resources, globals_, ("Item Conflict",))

    assert result == {"Item Conflict": ItemRechargeCapability.UNKNOWN}


def test_unrelated_empty_game_object_name_does_not_abort_dynamic_mapping(
    tmp_path: Path,
) -> None:
    resources, globals_ = _build_assets(
        tmp_path,
        prefix_objects=((90, 1, _game_object("", ())),),
    )

    result = discover_item_recharge_capabilities(
        resources,
        globals_,
        ("Item Rechargeable", "Item Not Rechargeable", "Item Drone Battery"),
    )

    assert result == {
        "Item Rechargeable": ItemRechargeCapability.RECHARGEABLE,
        "Item Not Rechargeable": ItemRechargeCapability.NOT_RECHARGEABLE,
        "Item Drone Battery": ItemRechargeCapability.UNKNOWN,
    }


def test_matched_prefab_still_requires_strict_game_object_validation(
    tmp_path: Path,
) -> None:
    resources = tmp_path / "resources.assets"
    globals_ = tmp_path / "globalgamemanagers.assets"
    _write_serialized_file(globals_, [(1001, 115, _mono_script("Item", "Item"))])
    _write_serialized_file(
        resources,
        [
            (1, 1, _game_object("Item Strict", (0,))),
            (11, 114, _mono_behaviour("Item Strict", 1, 1001)),
        ],
        externals=(("", "globalgamemanagers.assets"),),
    )

    with SerializedFileIndex(resources) as index:
        record = next(index.iter_records(frozenset({1})))
        assert _read_game_object_name(index, record) == "Item Strict"
        with pytest.raises(UnityMetadataError, match="unsupported or null component pointer"):
            _parse_game_object(index, record)

    assert discover_item_recharge_capabilities(resources, globals_, ("Item Strict",)) == {
        "Item Strict": ItemRechargeCapability.UNKNOWN
    }


def test_structurally_malformed_unrelated_game_object_fails_soft_to_unknown(
    tmp_path: Path,
) -> None:
    resources, globals_ = _build_assets(
        tmp_path,
        prefix_objects=((90, 1, struct.pack("<i", 1)),),
    )

    assert discover_item_recharge_capabilities(resources, globals_, ("Item Rechargeable",)) == {
        "Item Rechargeable": ItemRechargeCapability.UNKNOWN
    }


def test_metadata_cache_is_keyed_by_build_and_asset_identity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    resources, globals_ = _build_assets(tmp_path)
    resource_identity = recharge_evidence.InstalledFileIdentity(str(resources), 10, 1, 1, 1)
    globals_identity = recharge_evidence.InstalledFileIdentity(str(globals_), 10, 1, 1, 2)
    context = recharge_evidence.RechargeSourceContext(
        tmp_path,
        tmp_path / "manifest.acf",
        "first",
        resources,
        resource_identity,
        globals_,
        globals_identity,
    )
    monkeypatch.setattr(recharge_capability, "resolve_recharge_source_context", lambda _: context)
    scans = 0

    def scan(*_args: object, **_kwargs: object) -> dict[str, InstalledItemMetadata]:
        nonlocal scans
        scans += 1
        return {}

    monkeypatch.setattr(recharge_capability, "discover_installed_item_metadata_from_assets", scan)
    names = ("Item Rechargeable",)
    discover_installed_item_metadata_with_evidence(names)
    discover_installed_item_metadata_with_evidence(names)
    assert scans == 1

    context = replace(context, build_id="second")
    discover_installed_item_metadata_with_evidence(names)
    assert scans == 2

    context = replace(context, resources=replace(resource_identity, mtime_ns=2))
    discover_installed_item_metadata_with_evidence(names)
    assert scans == 3


@pytest.mark.skipif(os.name != "nt", reason="Windows DPAPI and file change-time validation")
def test_native_metadata_cache_reuses_valid_reads_and_rebuilds_after_source_change(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("REPODITOR_E2E", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    (tmp_path / "RepoDitorPreview").mkdir()
    resources, managers = _build_assets(tmp_path)
    manifest = tmp_path / "manifest.acf"
    manifest.write_text("first")
    build = "first"
    names = ("Item Rechargeable", "Item Not Rechargeable")

    def identity(path: Path) -> recharge_evidence.InstalledFileIdentity:
        info = path.stat()
        return recharge_evidence.InstalledFileIdentity(
            str(path), info.st_size, info.st_mtime_ns, info.st_dev, info.st_ino
        )

    def source(_game_dir: Path | None) -> recharge_evidence.RechargeSourceContext:
        return recharge_evidence.RechargeSourceContext(
            tmp_path, manifest, build, resources, identity(resources), managers, identity(managers)
        )

    monkeypatch.setattr(recharge_capability, "resolve_recharge_source_context", source)
    scan = recharge_capability.discover_installed_item_metadata_from_assets
    scans = 0

    def count_scan(
        resources_path: Path,
        global_managers_path: Path,
        item_names: Iterable[str],
        *,
        unity_version: str | None = None,
    ) -> dict[str, InstalledItemMetadata]:
        nonlocal scans
        scans += 1
        return scan(resources_path, global_managers_path, item_names, unity_version=unity_version)

    monkeypatch.setattr(
        recharge_capability, "discover_installed_item_metadata_from_assets", count_scan
    )

    def read(
        order: Iterable[str] = names, *, reuse: bool = True
    ) -> dict[str, InstalledItemMetadata]:
        recharge_capability._cached_item_metadata.cache_clear()
        return discover_installed_item_metadata_with_evidence(order, reuse_native_metadata=reuse)[0]

    before = read()
    assert before[names[0]].recharge_capability is ItemRechargeCapability.RECHARGEABLE
    assert read(reversed(names)) == before
    assert scans == 1

    assert read(reuse=False) == before  # Authoritative callers ignore the native read cache.
    assert scans == 2
    build = "second"
    assert read() == before
    assert scans == 3

    # In-place changes still invalidate the frame when size and mtime match.
    original = resources.stat()
    with resources.open("r+b") as stream:
        stream.seek(8)
        stream.write(struct.pack(">I", 21))
    os.utime(resources, ns=(original.st_atime_ns, original.st_mtime_ns))
    assert resources.stat().st_size == original.st_size
    assert resources.stat().st_mtime_ns == original.st_mtime_ns
    assert read()[names[0]].recharge_capability is ItemRechargeCapability.UNKNOWN
    assert scans == 4
    assert read()[names[0]].recharge_capability is ItemRechargeCapability.UNKNOWN
    assert scans == 5  # Parser-wide failure stays retryable.

    _build_assets(tmp_path)
    assert read() == before
    cache_root = artwork_cache_root(editor=True)
    assert cache_root is not None
    (cache_root / "metadata.bin").write_bytes(b"corrupt")
    assert read() == before
    assert scans == 7


def test_missing_or_unsupported_assets_fail_soft_to_unknown(tmp_path: Path) -> None:
    resources, globals_ = _build_assets(tmp_path)
    names = ("Item Rechargeable", "Item Not Rechargeable")

    globals_.unlink()
    assert set(discover_item_recharge_capabilities(resources, globals_, names).values()) == {
        ItemRechargeCapability.UNKNOWN
    }

    resources, globals_ = _build_assets(tmp_path)
    with resources.open("r+b") as handle:
        handle.seek(8)
        handle.write(struct.pack(">I", 21))
    assert set(discover_item_recharge_capabilities(resources, globals_, names).values()) == {
        ItemRechargeCapability.UNKNOWN
    }


def test_explicit_game_directory_does_not_infer_steam_build_provenance(
    tmp_path: Path,
) -> None:
    steamapps = tmp_path / "steamapps"
    game_root = steamapps / "common" / "REPO"
    data_dir = game_root / "REPO_Data"
    resources, globals_ = _build_assets(data_dir)
    assert resources.is_file()
    assert globals_.is_file()
    catalog = data_dir / "StreamingAssets" / "aa" / "catalog.json"
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")
    manifest = steamapps / "appmanifest_3241660.acf"
    manifest.write_text(
        '"AppState" { "appid" "3241660" "installdir" "REPO" "buildid" "23363152" }',
        encoding="utf-8",
    )

    result = discover_installed_recharge_capabilities(("Item Rechargeable",), game_root)

    assert result == {"Item Rechargeable": ItemRechargeCapability.UNKNOWN}


def test_steam_discovery_requires_the_validated_game_build(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    steamapps = tmp_path / "steamapps"
    game_root = steamapps / "common" / "REPO"
    data_dir = game_root / "REPO_Data"
    resources, globals_ = _build_assets(data_dir)
    assert resources.is_file()
    assert globals_.is_file()
    catalog = data_dir / "StreamingAssets" / "aa" / "catalog.json"
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")
    manifest = steamapps / "appmanifest_3241660.acf"
    manifest.write_text(
        '"AppState" { "appid" "3241660" "installdir" "REPO" "buildid" "23363152" }',
        encoding="utf-8",
    )

    monkeypatch.setattr(
        recharge_evidence,
        "discover_game_installation",
        lambda _game_dir: discover_game_installation(steam_roots=(tmp_path,), environment={}),
    )
    result = discover_installed_recharge_capabilities(("Item Rechargeable",))
    assert result == {"Item Rechargeable": ItemRechargeCapability.RECHARGEABLE}
    metadata, evidence = discover_installed_item_metadata_with_evidence(("Item Rechargeable",))
    assert metadata["Item Rechargeable"].recharge_capability is ItemRechargeCapability.RECHARGEABLE
    assert evidence is not None
    assert evidence.capabilities == (("Item Rechargeable", ItemRechargeCapability.RECHARGEABLE),)

    manifest.write_text(
        '"AppState" { "appid" "3241660" "installdir" "REPO" "buildid" "99999999" }',
        encoding="utf-8",
    )
    result = discover_installed_recharge_capabilities(("Item Rechargeable",))
    assert result == {"Item Rechargeable": ItemRechargeCapability.UNKNOWN}
