"""Create a dynamic cosmetic Unity catalog used only by RepoDitor desktop E2E tests."""

from __future__ import annotations

import struct
import sys
from collections.abc import Iterable
from pathlib import Path

from repo_save_editor.services.cosmetics.installed_catalog import (
    discover_installed_cosmetic_catalog,
)

_HEADER = struct.Struct(">IIIIB3sIqqq")
_OBJECT = struct.Struct("<qqIi")
UNITY_VERSION = "2022.3.67f2"
COSMETIC_COUNT = 28
META_MANAGER_SCRIPT_ID = 1001
COSMETIC_ASSET_SCRIPT_ID = 1002


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


def _cosmetic_asset(name: str, position: int) -> bytes:
    return (
        _mono_behaviour_prefix(
            1, COSMETIC_ASSET_SCRIPT_ID, name=f"E2E Cosmetic Object {position:02d}"
        )
        + struct.pack("<i", 1)
        + _aligned_string(name)
        + struct.pack("<ii", position % 4, position % 3)
    )


def _meta_manager_payload(pointers: Iterable[tuple[int, int]]) -> bytes:
    pointer_list = tuple(pointers)
    return (
        _mono_behaviour_prefix(1, META_MANAGER_SCRIPT_ID, name="MetaManager")
        + struct.pack("<i", -77)
        + struct.pack("<i", len(pointer_list))
        + b"".join(_pptr(file_id, path_id) for file_id, path_id in pointer_list)
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
) -> None:
    object_list = list(objects)
    class_ids = tuple(dict.fromkeys(class_id for _path_id, class_id, _data in object_list))
    type_ids = {class_id: index for index, class_id in enumerate(class_ids)}

    payload = bytearray()
    records: list[bytes] = []
    for path_id, class_id, data in object_list:
        aligned_start = _align(len(payload), 8)
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
    metadata.extend(struct.pack("<i", len(object_list)))
    absolute = 48 + len(metadata)
    metadata.extend(b"\0" * ((4 - absolute % 4) % 4))
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
    header = _HEADER.pack(0, 0, 22, 0, 0, b"\0\0\0", len(metadata), file_size, data_offset, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + metadata + (b"\0" * (data_offset - 48 - len(metadata))) + payload)


def _build_catalog(game_root: Path) -> None:
    data_root = game_root / "REPO_Data"
    scripts_path = data_root / "cosmetic-scripts.assets"
    targets_path = data_root / "sharedassets9.assets"

    _write_serialized_file(
        scripts_path,
        [
            (META_MANAGER_SCRIPT_ID, 115, _mono_script("MetaManager", "MetaManager")),
            (COSMETIC_ASSET_SCRIPT_ID, 115, _mono_script("CosmeticAsset", "CosmeticAsset")),
        ],
    )

    target_ids = tuple(7000 + position * 17 for position in range(COSMETIC_COUNT))
    _write_serialized_file(
        targets_path,
        [
            (
                path_id,
                114,
                _cosmetic_asset(f"E2E Cosmetic {position:02d}", position),
            )
            for position, path_id in enumerate(target_ids)
        ],
        externals=(("archive:/CAB/cosmetic-scripts.assets", "cosmetic-scripts.assets"),),
    )

    _write_serialized_file(
        data_root / "level0",
        [(4001, 114, _meta_manager_payload((2, path_id) for path_id in target_ids))],
        externals=(
            ("archive:/CAB/cosmetic-scripts.assets", "cosmetic-scripts.assets"),
            ("archive:/CAB/sharedassets9.assets", "sharedassets9.assets"),
        ),
    )


def _verify_catalog(game_root: Path) -> None:
    catalog = discover_installed_cosmetic_catalog(
        game_root,
        cache_dir=game_root / ".repoditor-e2e-cache",
    )
    if catalog is None:
        raise SystemExit("synthetic E2E cosmetic catalog was not discoverable")
    if len(catalog) != COSMETIC_COUNT:
        raise SystemExit(f"expected {COSMETIC_COUNT} cosmetics, discovered {len(catalog)}")
    if catalog[27].cosmetic_id != 27:
        raise SystemExit("synthetic E2E cosmetic catalog did not preserve canonical ID 27")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: create-cosmetic-game-assets.py <game-root>")
    game_root = Path(sys.argv[1]).resolve()
    _build_catalog(game_root)
    _verify_catalog(game_root)


if __name__ == "__main__":
    main()
