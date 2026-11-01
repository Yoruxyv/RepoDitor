"""Sunstone prefab hierarchy regression: RectTransform is a Transform subclass."""

from __future__ import annotations

import struct
from pathlib import Path

import pytest

from repo_save_editor.services.unity_artwork import (
    RECT_TRANSFORM_CLASS_ID,
    SUNSTONE_UNITY_VERSION,
    ArtworkFileIndex,
)
from repo_save_editor.services.unity_serialized import (
    UNITY_VERSION,
    UnityMetadataError,
)
from repo_save_editor.services.unity_textures import find_prefab_renderers, parse_transform
from tests.unity_serialized_fixture import aligned_string, pptr, write_serialized_file


def _game_object(name: str, components: list[int]) -> bytes:
    return (
        struct.pack("<i", len(components))
        + b"".join(pptr(0, component) for component in components)
        + struct.pack("<i", 0)
        + aligned_string(name)
    )


def _transform(game_object: int, children: list[int]) -> bytes:
    return (
        pptr(0, game_object)
        + (b"\0" * 40)
        + struct.pack("<i", len(children))
        + b"".join(pptr(0, child) for child in children)
    )


@pytest.mark.parametrize("version", [UNITY_VERSION, SUNSTONE_UNITY_VERSION])
@pytest.mark.parametrize(("root_class", "child_class"), [(4, 224), (224, 4), (224, 224)])
def test_mixed_transform_hierarchy_reaches_mesh_renderers(
    tmp_path: Path, root_class: int, child_class: int, version: str
) -> None:
    path = tmp_path / "mixed.assets"
    write_serialized_file(
        path,
        [
            (1, 1, _game_object("Root", [10])),
            (10, root_class, _transform(1, [11])),
            (2, 1, _game_object("Icon Panel", [11, 20])),
            (11, child_class, _transform(2, [12])),
            (3, 1, _game_object("Actual Mesh", [12, 30])),
            (12, 4, _transform(3, [])),
            (20, 23, pptr(0, 2)),
            (30, 23, pptr(0, 3)),
        ],
        unity_version=version,
    )
    with ArtworkFileIndex(path) as index:
        root = index.find_records({1})[1]
        records = find_prefab_renderers(index, root)
        assert {(record.path_id, owner) for record, owner in records} == {(20, 2), (30, 3)}
        child = index.find_records({11})[11]
        parsed = parse_transform(index, child)
        assert parsed.game_object.path_id == 2
        assert tuple(pointer.path_id for pointer in parsed.children) == (12,)
        assert child.class_id in {4, RECT_TRANSFORM_CLASS_ID}


def test_unrelated_class_is_not_accepted_as_transform(tmp_path: Path) -> None:
    path = tmp_path / "wrong-class.assets"
    write_serialized_file(
        path,
        [(1, 1, _game_object("Root", [10])), (10, 4, _transform(1, [20])), (20, 23, pptr(0, 1))],
    )
    with ArtworkFileIndex(path) as index:
        root = index.find_records({1})[1]
        with pytest.raises(UnityMetadataError, match="unsupported class"):
            find_prefab_renderers(index, root)
        with pytest.raises(UnityMetadataError, match="Expected a Transform"):
            parse_transform(index, index.find_records({20})[20])


def test_mixed_transform_components_cannot_be_ambiguous(tmp_path: Path) -> None:
    path = tmp_path / "ambiguous.assets"
    write_serialized_file(
        path,
        [
            (1, 1, _game_object("Root", [10, 11])),
            (10, 4, _transform(1, [])),
            (11, 224, _transform(1, [])),
        ],
    )
    with ArtworkFileIndex(path) as index, pytest.raises(UnityMetadataError, match="ambiguous"):
        find_prefab_renderers(index, index.find_records({1})[1])


def test_rect_transform_children_still_reject_missing_pointer(tmp_path: Path) -> None:
    path = tmp_path / "missing-child.assets"
    write_serialized_file(
        path,
        [(1, 1, _game_object("Root", [10])), (10, 224, _transform(1, [999]))],
    )
    with (
        ArtworkFileIndex(path) as index,
        pytest.raises(UnityMetadataError, match="could not be resolved"),
    ):
        find_prefab_renderers(index, index.find_records({1})[1])
