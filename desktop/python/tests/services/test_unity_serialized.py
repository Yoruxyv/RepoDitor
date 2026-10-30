from __future__ import annotations

from pathlib import Path

import pytest

from repo_save_editor.services.unity_serialized import SerializedFileIndex, UnityMetadataError
from tests.unity_serialized_fixture import write_serialized_file


def test_find_records_resolves_sorted_object_table(tmp_path: Path) -> None:
    assets = tmp_path / "sorted.assets"
    write_serialized_file(
        assets,
        [
            (1, 1, b"a"),
            (5, 4, b"b"),
            (9, 28, b"c"),
        ],
    )

    with SerializedFileIndex(assets) as index:
        records = index.find_records({5, 9})

    assert records[5].class_id == 4
    assert records[9].class_id == 28


def test_find_records_keeps_unsorted_object_table_compatible(tmp_path: Path) -> None:
    assets = tmp_path / "unsorted.assets"
    write_serialized_file(
        assets,
        [
            (5, 4, b"b"),
            (1, 1, b"a"),
            (9, 28, b"c"),
        ],
    )

    with SerializedFileIndex(assets) as index:
        records = index.find_records({1, 9})

    assert records[1].class_id == 1
    assert records[9].class_id == 28


def test_find_records_still_rejects_missing_pointer(tmp_path: Path) -> None:
    assets = tmp_path / "missing.assets"
    write_serialized_file(assets, [(1, 1, b"a"), (5, 4, b"b")])

    with (
        SerializedFileIndex(assets) as index,
        pytest.raises(UnityMetadataError, match="could not be resolved"),
    ):
        index.find_records({9})


@pytest.mark.parametrize("unity_version", ["2022.3.67f2", "6000.3.17f1"])
def test_explicit_unity_version_allowlist_preserves_old_and_sunstone(
    tmp_path: Path, unity_version: str
) -> None:
    assets = tmp_path / "supported.assets"
    write_serialized_file(assets, [(7, 1, b"x")], unity_version=unity_version)

    with SerializedFileIndex(assets) as index:
        assert index.object_count == 1
        assert index.find_records({7})[7].class_id == 1


@pytest.mark.parametrize("unity_version", ["6000.3.18f1", "2021.3.67f2"])
def test_unreviewed_unity_versions_remain_rejected(tmp_path: Path, unity_version: str) -> None:
    assets = tmp_path / "unsupported.assets"
    write_serialized_file(assets, [(7, 1, b"x")], unity_version=unity_version)

    with (
        pytest.raises(UnityMetadataError, match="Unsupported Unity version"),
        SerializedFileIndex(assets),
    ):
        pass
