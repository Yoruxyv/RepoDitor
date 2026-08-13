"""Minimal Unity serialized-file builders shared by metadata tests."""

from __future__ import annotations

import struct
from collections.abc import Iterable
from pathlib import Path

UNITY_VERSION = "2022.3.67f2"
_HEADER = struct.Struct(">IIIIB3sIqqq")
_OBJECT = struct.Struct("<qqIi")


def align(value: int, boundary: int) -> int:
    return (value + boundary - 1) & ~(boundary - 1)


def aligned_string(value: str) -> bytes:
    raw = value.encode("utf-8")
    data = struct.pack("<i", len(raw)) + raw
    return data + (b"\0" * (align(len(data), 4) - len(data)))


def pptr(file_id: int, path_id: int) -> bytes:
    return struct.pack("<iq", file_id, path_id)


def mono_script(name: str, class_name: str) -> bytes:
    return (
        aligned_string(name)
        + struct.pack("<i", 0)
        + (b"\0" * 16)
        + aligned_string(class_name)
        + aligned_string("")
        + aligned_string("Assembly-CSharp")
    )


def _serialized_type(class_id: int) -> bytes:
    data = struct.pack("<iBh", class_id, 0, -1)
    if class_id == 114:
        data += b"\0" * 16
    return data + (b"\0" * 16)


def write_serialized_file(
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
        aligned_start = align(len(payload), 8)
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

    data_offset = align(48 + len(metadata), 16)
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
