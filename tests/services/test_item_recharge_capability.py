from __future__ import annotations

import struct
from collections.abc import Iterable
from pathlib import Path

from repo_save_editor.services.items.models import ItemRechargeCapability
from repo_save_editor.services.items.recharge_capability import (
    discover_installed_recharge_capabilities,
)
from repo_save_editor.services.items.unity_serialized import (
    SerializedFileIndex,
    UnityMetadataError,
    _parse_game_object,
    _read_game_object_name,
    discover_installed_item_metadata,
    discover_item_recharge_capabilities,
)

_HEADER = struct.Struct(">IIIIB3sIqqq")
_OBJECT = struct.Struct("<qqIi")
UNITY_VERSION = "2022.3.67f2"


def _align(value: int, boundary: int) -> int:
    return (value + boundary - 1) & ~(boundary - 1)


def _aligned_string(value: str) -> bytes:
    raw = value.encode("utf-8")
    data = struct.pack("<i", len(raw)) + raw
    return data + (b"\0" * ((_align(len(data), 4)) - len(data)))


def _pptr(file_id: int, path_id: int) -> bytes:
    return struct.pack("<iq", file_id, path_id)


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


def _mono_script(name: str, class_name: str) -> bytes:
    return (
        _aligned_string(name)
        + struct.pack("<i", 0)
        + (b"\0" * 16)
        + _aligned_string(class_name)
        + _aligned_string("")
        + _aligned_string("Assembly-CSharp")
    )


def _serialized_type(class_id: int) -> bytes:
    data = struct.pack("<iBh", class_id, 0, -1)
    if class_id == 114:
        data += b"\0" * 16
    return data + (b"\0" * 16)


def _write_serialized_file(
    path: Path,
    objects: list[tuple[int, int, bytes]],
    *,
    externals: tuple[str, ...] = (),
) -> None:
    class_ids = tuple(dict.fromkeys(class_id for _path_id, class_id, _payload in objects))
    type_ids = {class_id: index for index, class_id in enumerate(class_ids)}

    payload = bytearray()
    records: list[bytes] = []
    for path_id, class_id, data in objects:
        aligned_start = _align(len(payload), 8)
        if aligned_start > len(payload):
            payload.extend(b"\0" * (aligned_start - len(payload)))
        relative_start = len(payload)
        payload.extend(data)
        records.append(_OBJECT.pack(path_id, relative_start, len(data), type_ids[class_id]))

    metadata = bytearray()
    metadata.extend(UNITY_VERSION.encode("ascii") + b"\0")
    metadata.extend(struct.pack("<iB", 19, 0))
    metadata.extend(struct.pack("<i", len(class_ids)))
    for class_id in class_ids:
        metadata.extend(_serialized_type(class_id))
    metadata.extend(struct.pack("<i", len(objects)))
    absolute = 48 + len(metadata)
    if absolute % 4:
        metadata.extend(b"\0" * (4 - absolute % 4))
    metadata.extend(b"".join(records))
    metadata.extend(struct.pack("<i", 0))  # script identifiers
    metadata.extend(struct.pack("<i", len(externals)))
    for external in externals:
        metadata.extend(b"\0")
        metadata.extend(b"\0" * 16)
        metadata.extend(struct.pack("<i", 0))
        metadata.extend(external.encode("utf-8") + b"\0")
    metadata.extend(struct.pack("<i", 0))  # ref types
    metadata.extend(b"\0")  # userInformation

    data_offset = _align(48 + len(metadata), 16)
    file_size = data_offset + len(payload)
    header = _HEADER.pack(0, 0, 22, 0, 0, b"\0\0\0", len(metadata), file_size, data_offset, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + metadata + (b"\0" * (data_offset - 48 - len(metadata))) + payload)


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
        externals=("globalgamemanagers.assets",),
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
        externals=("globalgamemanagers.assets",),
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
