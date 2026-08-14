from __future__ import annotations

from pathlib import Path

import pytest
from tests.unity_serialized_fixture import write_serialized_file

from repo_save_editor.services.unity_serialized import SerializedFileIndex, UnityMetadataError


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
