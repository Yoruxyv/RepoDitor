"""Sunstone Texture2D field offsets, verified without changing legacy layouts."""

from __future__ import annotations

import struct
from pathlib import Path

import pytest

from repo_save_editor.services.unity_serialized import (
    SUNSTONE_UNITY_VERSION,
    UNITY_VERSION,
    SerializedFileIndex,
    UnityMetadataError,
)
from repo_save_editor.services.unity_textures import parse_texture2d
from tests.unity_serialized_fixture import aligned_string, write_serialized_file


def _texture_bytes(*, legacy: bool) -> bytes:
    """Construct metadata with the offsets observed in the installed Sunstone file.

    The Sunstone record matches the 160-byte observed record size, with a
    512x512 DXT5 texture, 10 mips, a streamed 349552-byte payload, and no
    fallback booleans between the forced-format integer and the dimensions.
    """
    prefix = struct.pack("<i", 0)
    if legacy:
        prefix += bytes((0, 0, 0, 0))
    return (
        aligned_string("Upgrade_Health_Albedo")
        + prefix
        + struct.pack("<iiiiii", 512, 512, 349552, 0, 12, 10)
        + bytes((0, 0, 0, 0))
        + struct.pack("<iii", 0, 0, 0)
        + struct.pack("<ii", 1, 2)
        + struct.pack("<iifiii", 0, 1, 0.0, 0, 0, 0)
        + struct.pack("<ii", 0, 1)
        + struct.pack("<i", 0)  # platform blob size
        + struct.pack("<i", 0)  # inline data size
        + struct.pack("<QI", 0x2E0E5420, 349552)
        + aligned_string("resources.assets.resS")
    )


def _parse(tmp_path: Path, *, version: str, payload: bytes):
    path = tmp_path / "texture.assets"
    write_serialized_file(path, [(4233, 28, payload)], unity_version=version)
    with SerializedFileIndex(path) as index:
        assert index.unity_version == version
        return parse_texture2d(index, index.find_records({4233})[4233])


@pytest.mark.parametrize(
    ("version", "legacy"),
    [(UNITY_VERSION, True), (SUNSTONE_UNITY_VERSION, False)],
)
def test_explicit_version_layouts_decode_the_same_texture(
    tmp_path: Path, version: str, legacy: bool
) -> None:
    payload = _texture_bytes(legacy=legacy)
    assert len(payload) == (164 if legacy else 160)

    value = _parse(tmp_path, version=version, payload=payload)

    assert value.path_id == 4233
    assert value.name == "Upgrade_Health_Albedo"
    assert (value.width, value.height) == (512, 512)
    assert value.texture_format == "DXT5"
    assert value.mip_count == 10
    assert value.inline_data_size == 0
    assert value.top_mip_size == 262144
    assert value.stream_size == 349552
    assert value.stream_offset == 0x2E0E5420
    assert value.stream_path == "resources.assets.resS"


@pytest.mark.parametrize(
    ("version", "legacy"),
    [(UNITY_VERSION, False), (SUNSTONE_UNITY_VERSION, True)],
)
def test_layout_is_not_autodetected_on_wrong_version(
    tmp_path: Path, version: str, legacy: bool
) -> None:
    with pytest.raises(UnityMetadataError):
        _parse(tmp_path, version=version, payload=_texture_bytes(legacy=legacy))


@pytest.mark.parametrize(
    ("offset", "replacement"),
    [
        (4, 0),  # Invalid width
        (0x1C, 2),  # Invalid boolean flag
        (0x64, 8),  # Too-short stream for DXT5 top mip
    ],
)
def test_sunstone_bad_metadata_still_fails_closed(
    tmp_path: Path, offset: int, replacement: int
) -> None:
    payload = bytearray(_texture_bytes(legacy=False))
    name_end = len(aligned_string("Upgrade_Health_Albedo"))
    struct.pack_into("<i", payload, name_end + offset, replacement)
    with pytest.raises(UnityMetadataError):
        _parse(tmp_path, version=SUNSTONE_UNITY_VERSION, payload=bytes(payload))
