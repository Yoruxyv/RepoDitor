from __future__ import annotations

import struct
from collections.abc import Iterable
from pathlib import Path

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

from repo_save_editor.services.items.installed_metadata import (
    _parse_game_object,
    _read_game_object_name,
    discover_installed_item_metadata,
    discover_item_recharge_capabilities,
)
from repo_save_editor.services.items.models import ItemRechargeCapability
from repo_save_editor.services.items.recharge_capability import (
    discover_installed_recharge_capabilities,
)
from repo_save_editor.services.unity_serialized import SerializedFileIndex, UnityMetadataError


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
) -> tuple[Path, Path]:
    resources = root / "resources.assets"
    globals_ = root / "globalgamemanagers.assets"

    _write_serialized_file(
        globals_,
        [
            (1001, 115, _mono_script("Item", "Item")),
            (1002, 115, _mono_script("ItemBattery", "ItemBattery")),
        ],
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
    )
    return resources, globals_


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
        try:
            _parse_game_object(index, record)
        except UnityMetadataError as error:
            assert "unsupported or null component pointer" in str(error)
        else:
            raise AssertionError("Matched prefab bypassed strict GameObject validation.")

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


def test_installed_discovery_requires_the_validated_game_build(tmp_path: Path) -> None:
    steamapps = tmp_path / "steamapps"
    game_root = steamapps / "common" / "REPO"
    data_dir = game_root / "REPO_Data"
    resources, globals_ = _build_assets(data_dir)
    assert resources.is_file() and globals_.is_file()
    catalog = data_dir / "StreamingAssets" / "aa" / "catalog.json"
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")
    manifest = steamapps / "appmanifest_3241660.acf"
    manifest.write_text('"AppState" { "buildid" "23363152" }', encoding="utf-8")

    result = discover_installed_recharge_capabilities(("Item Rechargeable",), game_root)
    assert result == {"Item Rechargeable": ItemRechargeCapability.RECHARGEABLE}

    manifest.write_text('"AppState" { "buildid" "99999999" }', encoding="utf-8")
    result = discover_installed_recharge_capabilities(("Item Rechargeable",), game_root)
    assert result == {"Item Rechargeable": ItemRechargeCapability.UNKNOWN}
