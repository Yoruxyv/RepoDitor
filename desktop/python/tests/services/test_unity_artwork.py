"""Presentation version support must never change the capability-reader boundary."""

from __future__ import annotations

import struct
from pathlib import Path

import pytest

from repo_save_editor.services.unity_artwork import SUNSTONE_UNITY_VERSION, ArtworkFileIndex
from repo_save_editor.services.unity_serialized import (
    MAX_TYPES,
    UNITY_VERSION,
    SerializedFileIndex,
    UnityMetadataError,
)
from tests.unity_serialized_fixture import write_serialized_file


def test_artwork_read_does_not_enable_sunstone_in_the_capability_reader(tmp_path: Path) -> None:
    path = tmp_path / "sunstone.assets"
    write_serialized_file(path, [(7, 1, b"synthetic")], unity_version=SUNSTONE_UNITY_VERSION)
    with ArtworkFileIndex(path) as artwork:
        assert artwork.unity_version == SUNSTONE_UNITY_VERSION
        assert artwork.find_records({7})[7].class_id == 1
    with pytest.raises(UnityMetadataError, match="Unsupported Unity version"):
        SerializedFileIndex(path)
    assert UNITY_VERSION == "2022.3.67f2"


def test_historical_object_layout_is_identical_in_both_readers(tmp_path: Path) -> None:
    path = tmp_path / "historical.assets"
    write_serialized_file(path, [(9, 4, b"second"), (7, 1, b"first")])
    with SerializedFileIndex(path) as capability, ArtworkFileIndex(path) as artwork:
        assert capability.types == artwork.types
        assert capability.find_records({7, 9}) == artwork.find_records({7, 9})
        assert capability.object_count == artwork.object_count == 2


@pytest.mark.parametrize("version", [UNITY_VERSION, SUNSTONE_UNITY_VERSION])
@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("platform", 999, "Unsupported target platform"),
        ("tree", 2, "type-tree flag"),
        ("count", 0, "no object types"),
        ("count", MAX_TYPES + 1, "type count"),
    ],
)
def test_artwork_header_keeps_validation_and_failure_cleanup(
    tmp_path: Path,
    version: str,
    field: str,
    value: int,
    message: str,
) -> None:
    path = tmp_path / "bad-header.assets"
    write_serialized_file(path, [(7, 1, b"synthetic")], unity_version=version)
    raw = bytearray(path.read_bytes())
    platform = 48 + len(version.encode()) + 1
    offsets = {"platform": platform, "tree": platform + 4, "count": platform + 5}
    struct.pack_into("<B" if field == "tree" else "<i", raw, offsets[field], value)
    path.write_bytes(raw)
    with pytest.raises(UnityMetadataError, match=message):
        ArtworkFileIndex(path)
    # Failed initialization must release its mapping/handle, including on Windows.
    path.replace(tmp_path / "released.assets")


@pytest.mark.parametrize("version", ["6000.3.18f1", "2021.3.67f2"])
def test_neither_reader_accepts_unreviewed_versions(tmp_path: Path, version: str) -> None:
    path = tmp_path / "unknown.assets"
    write_serialized_file(path, [(7, 1, b"synthetic")], unity_version=version)
    for reader in (SerializedFileIndex, ArtworkFileIndex):
        with pytest.raises(UnityMetadataError, match="Unsupported Unity version"):
            reader(path)
