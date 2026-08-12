"""Create the minimal supported Unity metadata used by RepoDitor's desktop E2E test."""

from __future__ import annotations

import struct
import sys
from collections.abc import Iterable
from pathlib import Path

_HEADER = struct.Struct(">IIIIB3sIqqq")
_OBJECT = struct.Struct("<qqIi")
UNITY_VERSION = "2022.3.67f2"
STEAM_APP_ID = "3241660"
VALIDATED_BUILD_ID = "23363152"


def _align(value: int, boundary: int) -> int:
    return (value + boundary - 1) & ~(boundary - 1)


def _aligned_string(value: str) -> bytes:
    raw = value.encode("utf-8")
    data = struct.pack("<i", len(raw)) + raw
    return data + (b"\0" * (_align(len(data), 4) - len(data)))


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
) -> bytes:
    data = _pptr(0, game_object_id) + b"\x01\0\0\0" + _pptr(1, script_id)
    data += _aligned_string(name)
    if battery_bars is not None:
        data += struct.pack("<iB", battery_bars, 0)
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
    metadata.extend(b"\0" * ((4 - absolute % 4) % 4))
    metadata.extend(b"".join(records))
    metadata.extend(struct.pack("<i", 0))
    metadata.extend(struct.pack("<i", len(externals)))
    for external in externals:
        metadata.extend(b"\0")
        metadata.extend(b"\0" * 16)
        metadata.extend(struct.pack("<i", 0))
        metadata.extend(external.encode("utf-8") + b"\0")
    metadata.extend(struct.pack("<i", 0))
    metadata.extend(b"\0")

    data_offset = _align(48 + len(metadata), 16)
    file_size = data_offset + len(payload)
    header = _HEADER.pack(0, 0, 22, 0, 0, b"\0\0\0", len(metadata), file_size, data_offset, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + metadata + (b"\0" * (data_offset - 48 - len(metadata))) + payload)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: create-recharge-game-assets.py <game-root>")
    game_root = Path(sys.argv[1]).resolve()
    data_root = game_root / "REPO_Data"

    _write_serialized_file(
        data_root / "globalgamemanagers.assets",
        [
            (1001, 115, _mono_script("Item", "Item")),
            (1002, 115, _mono_script("ItemBattery", "ItemBattery")),
        ],
    )
    _write_serialized_file(
        data_root / "resources.assets",
        [
            (1, 1, _game_object("Item Cart Medium", (11,))),
            (11, 114, _mono_behaviour("Item Cart Medium", 1, 1001)),
            (2, 1, _game_object("Item Health Pack Medium", (21,))),
            (21, 114, _mono_behaviour("Item Health Pack Medium", 2, 1001)),
            (3, 1, _game_object("Item Melee Inflatable Hammer", (31, 32))),
            (31, 114, _mono_behaviour("Item Melee Inflatable Hammer", 3, 1001)),
            (32, 114, _mono_behaviour("", 3, 1002, battery_bars=10)),
        ],
        externals=("globalgamemanagers.assets",),
    )

    steamapps = game_root.parent.parent
    if steamapps.name.casefold() != "steamapps":
        raise SystemExit("game root must be under <library>/steamapps/common/REPO")
    (steamapps / f"appmanifest_{STEAM_APP_ID}.acf").write_text(
        f'"AppState"\n{{\n    "appid" "{STEAM_APP_ID}"\n    "buildid" "{VALIDATED_BUILD_ID}"\n}}\n',
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
