"""Bounded Sprite decoding and source revisions with synthetic artwork only."""

from __future__ import annotations

import os
import struct
from pathlib import Path
from types import SimpleNamespace

import pytest

from repo_save_editor.desktop_api.discovery.maps import get_native_map_artwork
from repo_save_editor.services.game import map_artwork as art
from repo_save_editor.services.game.maps import GameMap, MapCatalog
from repo_save_editor.services.unity_artwork import SUNSTONE_UNITY_VERSION, ArtworkFileIndex
from repo_save_editor.services.unity_serialized import ObjectRecord
from tests.unity_serialized_fixture import aligned_string, pptr, write_serialized_file


def catalog(tmp_path: Path) -> MapCatalog:
    data = tmp_path / "steamapps/common/REPO/REPO_Data"
    sources = (
        tmp_path / "steamapps/appmanifest_3241660.acf",
        data / "Managed/Assembly-CSharp.dll",
        data / "level0",
        data / "sharedassets0.assets",
        data / "globalgamemanagers.assets",
    )
    for p in sources:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"synthetic")
    for name in ("globalgamemanagers", "resources.assets", "resources.assets.resS"):
        (data / name).write_bytes(b"synthetic")
    return MapCatalog(
        data / "level0", (GameMap("Future", "Future", True, ("Level/Future/preview",)),), sources
    )


def test_revision_watches_all_sources_and_never_enables_legacy_art(tmp_path: Path) -> None:
    c = catalog(tmp_path)
    revision = art.artwork_revision(c)
    assert revision is not None
    assert len(art.artwork_sources(c)) == 8
    for source in art.artwork_sources(c):
        before = art.artwork_revision(c)
        source.write_bytes(source.read_bytes() + b"change")
        assert art.artwork_revision(c) != before
    assert art.artwork_revision(MapCatalog(c.path, c.maps)) is None
    art.artwork_sources(c)[-1].unlink()
    assert art.artwork_revision(c) is None


def test_source_directory_link_is_rejected(tmp_path: Path) -> None:
    c = catalog(tmp_path)
    data = c.path.parent
    moved = data.with_name("other")
    data.rename(moved)
    try:
        data.symlink_to(moved, target_is_directory=True)
    except OSError:
        pytest.skip("Directory symlinks unavailable")
    assert art.artwork_revision(c) is None


def source_objects(tmp_path: Path):
    key = "level/future/preview"
    manager_path, source = tmp_path / "manager", tmp_path / "resources.assets"
    # Exact resource key is deliberately shared by Texture2D and Sprite objects.
    write_serialized_file(
        manager_path,
        [
            (
                1,
                147,
                struct.pack("<i", 2)
                + aligned_string(key)
                + pptr(1, 2)
                + aligned_string(key)
                + pptr(1, 3),
            )
        ],
        externals=(("", "resources.assets"),),
        unity_version=SUNSTONE_UNITY_VERSION,
    )
    write_serialized_file(
        source, [(2, 28, b"texture"), (3, 213, b"sprite")], unity_version=SUNSTONE_UNITY_VERSION
    )
    stream = tmp_path / "resources.assets.resS"
    stream.write_bytes(b"stream")
    texture = SimpleNamespace(
        m_TextureFormat=12,
        m_MipCount=1,
        m_Width=4,
        m_Height=4,
        m_StreamData=SimpleNamespace(path=stream.name, offset=0, size=6),
    )
    pointer = SimpleNamespace(m_FileID=0, m_PathID=2, deref_parse_as_object=lambda: texture)
    sprite = SimpleNamespace(
        m_Name="preview",
        m_SpriteAtlas=None,
        m_AtlasTags=[],
        m_RD=SimpleNamespace(texture=pointer, alphaTexture=None),
    )
    env = SimpleNamespace(
        file=SimpleNamespace(objects={3: SimpleNamespace(parse_as_object=lambda: sprite)})
    )
    return manager_path, source, stream, texture, sprite, env


def test_typed_resource_resolution_does_not_choose_the_texture_by_order(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    manager, source, stream, texture, sprite, env = source_objects(tmp_path)
    monkeypatch.setattr(
        art,
        "_preview",
        lambda s, t: (b"synthetic png", 4, 4) if (s, t) == (sprite, texture) else None,
    )
    with ArtworkFileIndex(manager) as m, ArtworkFileIndex(source) as i:
        assert art._decode_sprite(m, i, env, "Level/Future/preview", stream) == (
            b"synthetic png",
            4,
            4,
        )


@pytest.mark.parametrize(
    ("owner", "field", "value"),
    [
        ("texture", "m_TextureFormat", 99),
        ("texture", "m_MipCount", 2),
        ("texture", "m_Width", 8192),
        ("sprite", "m_SpriteAtlas", True),
        ("sprite", "m_AtlasTags", ["unsupported"]),
        ("stream", "path", "../outside"),
        ("stream", "offset", -1),
        ("stream", "size", 999999999),
        ("pointer", "m_FileID", 1),
    ],
)
def test_unsupported_sources_fail_before_image_decode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, owner: str, field: str, value: object
) -> None:
    manager, source, stream, texture, sprite, env = source_objects(tmp_path)
    target = {
        "texture": texture,
        "sprite": sprite,
        "stream": texture.m_StreamData,
        "pointer": sprite.m_RD.texture,
    }[owner]
    setattr(target, field, value)
    monkeypatch.setattr(
        art, "_preview", lambda *_: pytest.fail("Unsupported input reached decoding")
    )
    with (
        ArtworkFileIndex(manager) as m,
        ArtworkFileIndex(source) as i,
        pytest.raises(ValueError, match="Unsupported"),
    ):
        art._decode_sprite(m, i, env, "Level/Future/preview", stream)


def test_crop_alpha_and_output_bounds() -> None:
    image = pytest.importorskip("PIL.Image")
    picture = image.new("RGBA", (1600, 800), (50, 70, 90, 255))
    sprite = SimpleNamespace(
        m_RD=SimpleNamespace(textureRect=SimpleNamespace(x=0, y=0, width=1600, height=800)),
        image=picture,
    )
    texture = SimpleNamespace(m_Width=1600, m_Height=800)
    png, width, height = art._preview(sprite, texture)
    assert (width, height) == (1024, 512)
    assert png.startswith(b"\x89PNG")
    sprite.m_RD.textureRect.width = float("nan")
    with pytest.raises(ValueError, match="crop"):
        art._preview(sprite, texture)
    sprite.m_RD.textureRect.width = 1600
    sprite.image = image.new("RGBA", (1600, 800))
    with pytest.raises(ValueError, match="transparent"):
        art._preview(sprite, texture)


def test_batch_discards_output_when_any_source_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = catalog(tmp_path)
    data = c.path.parent
    write_serialized_file(
        data / "globalgamemanagers", [(1, 147, b"synthetic")], unity_version=SUNSTONE_UNITY_VERSION
    )
    write_serialized_file(
        data / "resources.assets", [(1, 28, b"synthetic")], unity_version=SUNSTONE_UNITY_VERSION
    )
    fake = SimpleNamespace(
        load=lambda _: SimpleNamespace(register_cab=lambda *_: None),
        EndianBinaryReader=lambda _: None,
    )
    monkeypatch.setattr(art, "import_module", lambda _: fake)
    monkeypatch.setattr(
        art,
        "_native_environment",
        lambda *_: SimpleNamespace(register_cab=lambda *_: None, file=SimpleNamespace(_cache={})),
    )

    def changed(*_):
        (data / "level0").write_bytes(b"changed source")
        return b"png", 1, 1

    monkeypatch.setattr(art, "_decode_sprite", changed)
    with pytest.raises(ValueError, match="changed"):
        art._decode(c)
    # No mappings or stream handles survive a failed batch.
    (data / "resources.assets").replace(data / "released.assets")


def test_native_preview_rechecks_exact_family_revision_and_limits(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    initial = catalog(tmp_path)
    c = MapCatalog(
        initial.path,
        (*initial.maps, GameMap("Other", "Future", True, ("Level/Other/preview",))),
        initial.source_paths,
    )
    for name, class_id in (("globalgamemanagers", 147), ("resources.assets", 28)):
        write_serialized_file(
            c.path.parent / name, [(1, class_id, b"fixture")], unity_version=SUNSTONE_UNITY_VERSION
        )
    revision = art.artwork_revision(c)
    assert revision is not None
    selected: list[tuple[str, ...]] = []
    monkeypatch.setattr(art, "discover_installed_maps", lambda: c)
    monkeypatch.setattr(
        art, "import_module", lambda _: SimpleNamespace(EndianBinaryReader=lambda _: None)
    )

    def environment(_, __, paths):
        selected.append(paths)
        return SimpleNamespace(register_cab=lambda *_: None, file=SimpleNamespace(_cache={}))

    monkeypatch.setattr(art, "_native_environment", environment)
    monkeypatch.setattr(art, "_decode_sprite", lambda *_: (b"png", 1, 1))
    absent = {"ok": True, "artwork": None}
    assert get_native_map_artwork(revision, "future") == absent
    assert get_native_map_artwork("0" * 64, "Future") == absent
    assert selected == []
    assert get_native_map_artwork(revision, "Future") == {
        "ok": True,
        "artwork": {
            "mapFamily": "Future",
            "sourceIdentity": revision,
            "pngBase64": "cG5n",
            "width": 1,
            "height": 1,
        },
    }
    assert selected == [("Level/Future/preview",)]
    monkeypatch.setattr(
        art, "_decode_sprite", lambda *_: (b"x" * (art.MAX_NATIVE_PNG_BYTES + 1), 1, 1)
    )
    assert get_native_map_artwork(revision, "Future") == absent
    source = art.artwork_sources(c)[-1]
    original = source.stat()
    replacement = source.with_suffix(".replacement")
    replacement.write_bytes(source.read_bytes())
    os.utime(replacement, ns=(original.st_atime_ns, original.st_mtime_ns))
    replacement.replace(source)
    assert source.stat().st_mtime_ns == original.st_mtime_ns
    assert art.artwork_revision(c) != revision
    assert get_native_map_artwork(revision, "Future") == absent
    assert len(selected) == 2


def test_native_subset_preserves_ids_classes_and_bytes_without_unrelated_objects(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source.assets"
    write_serialized_file(
        source,
        [
            (7, 28, b"synthetic texture"),
            (19, 213, b"synthetic sprite"),
            *((i, 1, b"unrelated") for i in range(100, 20_100)),
        ],
        unity_version=SUNSTONE_UNITY_VERSION,
    )
    target = tmp_path / "subset.assets"
    index = art._MapSpriteIndex(source)
    with index:
        selected = tuple(index.find_records({7, 19}).values())
        expected = {r.path_id: index.object_reader(r).bytes(r.byte_size) for r in selected}
        target.write_bytes(index.native_subset(selected))
    assert target.stat().st_size < 1024
    with ArtworkFileIndex(target) as subset:
        assert subset.object_count == 2
        assert subset.unity_version == SUNSTONE_UNITY_VERSION
        for record in subset.iter_records():
            assert subset.object_reader(record).bytes(record.byte_size) == expected[record.path_id]
    unity = pytest.importorskip("UnityPy")
    with target.open("rb") as handle:
        native = unity.load(handle)
        assert set(native.file.objects) == {7, 19}
        assert {k: r.get_raw_data() for k, r in native.file.objects.items()} == expected


@pytest.mark.parametrize(
    "case", ["empty", "duplicate", "forged", "wrong-class", "oversized", "too-many"]
)
def test_native_subset_rejects_unadmitted_records(tmp_path: Path, case: str) -> None:
    source = tmp_path / "source.assets"
    write_serialized_file(
        source,
        [
            (1, 28, b"texture"),
            (2, 213, b"sprite"),
            (3, 1, b"not a Sprite"),
            (4, 28, b"x" * (art.MAX_OBJECT_BYTES + 1)),
            *((i, 28, b"texture") for i in range(100, 400)),
        ],
        unity_version=SUNSTONE_UNITY_VERSION,
    )
    index = art._MapSpriteIndex(source)
    with index:
        values = index.find_records({1, 2, 3, 4, *range(100, 400)})
        r = values[1]
        records = {
            "empty": (),
            "duplicate": (r, r),
            "forged": (ObjectRecord(r.path_id, r.byte_start + 1, r.byte_size, r.class_id),),
            "wrong-class": (values[3],),
            "oversized": (values[4],),
            "too-many": tuple(values[i] for i in range(100, 400)),
        }[case]
        with pytest.raises(ValueError, match=r"Native|native"):
            index.native_subset(records)


def test_native_subset_rejects_ambiguous_native_type_definitions(tmp_path: Path) -> None:
    source = tmp_path / "source.assets"
    write_serialized_file(
        source, [(1, 1, b"other"), (2, 28, b"texture")], unity_version=SUNSTONE_UNITY_VERSION
    )
    raw = bytearray(source.read_bytes())
    # Turn the first native type into a second Texture2D definition without changing object bounds.
    first_type = 48 + len(SUNSTONE_UNITY_VERSION.encode()) + 1 + 4 + 1 + 4
    struct.pack_into("<i", raw, first_type, 28)
    source.write_bytes(raw)
    index = art._MapSpriteIndex(source)
    with index, pytest.raises(ValueError, match="Unsupported native"):
        index.native_subset((index.find_records({2})[2],))


def test_native_subset_keeps_validation_of_unselected_object_ranges(tmp_path: Path) -> None:
    source = tmp_path / "source.assets"
    write_serialized_file(
        source, [(1, 28, b"selected"), (2, 1, b"unselected")], unity_version=SUNSTONE_UNITY_VERSION
    )
    with ArtworkFileIndex(source) as index:
        table = index.object_table_offset
    raw = bytearray(source.read_bytes())
    struct.pack_into("<q", raw, table + 24 + 8, len(raw) * 2)
    source.write_bytes(raw)
    index = art._MapSpriteIndex(source)
    with index, pytest.raises(ValueError, match="outside"):
        index.native_subset((index._record_at_table_index(0),))
