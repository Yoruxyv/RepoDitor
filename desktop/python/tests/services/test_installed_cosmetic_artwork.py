"""Focused tests for source-backed, read-only cosmetic Sprite preparation."""

from __future__ import annotations

import io
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from repo_save_editor.services.cosmetics import installed_artwork as artwork


def _location(kind: str, asset_path: str, *, primary: str = "same") -> Any:
    return SimpleNamespace(
        type=SimpleNamespace(class_name=f"UnityEngine.{kind}"),
        internal_id=asset_path,
        primary_key=primary,
        provider_id="BundledAssetProvider",
        dependency_key="cosmetic-deps",
    )


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("Assets/Cosmetics/Head/Foo.png", "assets/cosmetics/head/foo.png"),
        ("archive://foo/Assets/Cosmetics/Head/Foo.png", "assets/cosmetics/head/foo.png"),
        ("Assets\\Cosmetics\\Arms\\Icon.png", "assets/cosmetics/arms/icon.png"),
        ("Assets/Cosmetics/Icon.png?version=7", "assets/cosmetics/icon.png"),
        ("foo.png", ""),
        ("Assets/../Icons/foo.png", ""),
        ("Assets//Icons/foo.png", ""),
        ("Assets/Icons/./foo.png", ""),
        ("Assets/Icons", ""),
        ("", ""),
    ],
)
def test_exact_asset_path(path: str, expected: str) -> None:
    assert artwork.normalize_asset_path(path) == expected


def test_typed_icon_guid_requires_same_catalog_identity() -> None:
    tree = {"assetName": "Cosmetic 7", "iconRef": {"m_AssetGUID": "ABCD" * 8}}
    assert artwork._read_icon_guid(tree, "Cosmetic 7") == "abcd" * 8
    with pytest.raises(artwork.CosmeticArtworkError, match="identity"):
        artwork._read_icon_guid(tree, "Cosmetic 8")
    tree["iconRef"] = {"m_AssetGUID": "0" * 32}
    with pytest.raises(artwork.CosmeticArtworkError, match="invalid"):
        artwork._read_icon_guid(tree, "Cosmetic 7")


def test_catalog_preserves_sprite_type_and_rejects_duplicate_sprite_locations() -> None:
    guid = "a" * 32
    sprite = _location("Sprite", "Assets/Cosmetics/Head/First.png")
    texture = _location("Texture2D", "Assets/Cosmetics/Head/First.png")
    catalog = SimpleNamespace(resources={guid: [sprite, texture]})
    assert artwork._sprite_location_paths(catalog, {0: guid}) == {
        0: "assets/cosmetics/head/first.png"
    }
    catalog.resources[guid].append(_location(
        "Sprite", "Assets/Cosmetics/Head/Other.png", primary="different"
    ))
    with pytest.raises(artwork.CosmeticArtworkError, match="2 unique Sprite"):
        artwork._sprite_location_paths(catalog, {0: guid})


def test_sprite_dereference_requires_a_real_sprite() -> None:
    Image = pytest.importorskip("PIL.Image")
    sprite = SimpleNamespace(image=Image.new("RGBA", (32, 32), (10, 50, 40, 255)))
    reader = SimpleNamespace(type=SimpleNamespace(name="Sprite"), parse_as_object=lambda: sprite)
    pointer = SimpleNamespace(type=SimpleNamespace(name="Sprite"), deref=lambda: reader)
    assert artwork._sprite_pointer_object(pointer) is sprite
    with pytest.raises(artwork.CosmeticArtworkError):
        artwork._sprite_pointer_object(SimpleNamespace(type=SimpleNamespace(name="Texture2D")))
    png, width, height = artwork._png_from_sprite(sprite)
    assert (width, height) == (32, 32)
    with Image.open(io.BytesIO(png)) as loaded:
        assert loaded.size == (32, 32)
    invisible = SimpleNamespace(image=Image.new("RGBA", (10, 10), (0, 0, 0, 0)))
    with pytest.raises(artwork.CosmeticArtworkError, match="transparent"):
        artwork._png_from_sprite(invisible)


def test_source_identity_changes_with_file_metadata(tmp_path: Path) -> None:
    source = tmp_path / "source.bundle"
    source.write_bytes(b"one")
    before = artwork._watch(source, tmp_path)
    original = artwork._source_identity(
        tmp_path, 7, "a" * 32, "assets/a/b.png", (before,)
    )
    source.write_bytes(b"different-size")
    after = artwork._watch(source, tmp_path)
    changed = artwork._source_identity(tmp_path, 7, "a" * 32, "assets/a/b.png", (after,))
    assert original != changed


def test_source_rejects_symlinks(tmp_path: Path) -> None:
    source = tmp_path / "a.bundle"
    link = tmp_path / "link.bundle"
    source.write_bytes(b"file")
    try:
        link.symlink_to(source)
    except (OSError, NotImplementedError):
        pytest.skip("Test environment does not permit symlink creation")
    with pytest.raises(artwork.CosmeticArtworkError):
        artwork._watch(link, tmp_path)


def test_ids_are_rejected_before_loading_the_game() -> None:
    with pytest.raises(artwork.CosmeticArtworkError, match="bounded"):
        artwork.prepare_installed_cosmetic_artwork([True])
    with pytest.raises(artwork.CosmeticArtworkError, match="bounded"):
        artwork.prepare_installed_cosmetic_artwork([])
    with pytest.raises(artwork.CosmeticArtworkError, match="bounded"):
        artwork.prepare_installed_cosmetic_artwork([-1])


def test_prepare_uses_typed_sprite_and_does_not_write_any_presentation_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    Image = pytest.importorskip("PIL.Image")
    game_root = tmp_path / "steam" / "steamapps" / "common" / "REPO"
    aa = game_root / "REPO_Data" / "StreamingAssets" / "aa"
    aa.mkdir(parents=True)
    bundle = aa / "cosmetics.bundle"
    bundle.write_bytes(b"fixture only")
    (aa / "catalog.bin").write_bytes(b"fixture")
    (game_root / "REPO_Data" / "level0").write_bytes(b"fixture")
    managed = game_root / "REPO_Data" / "Managed" / "Assembly-CSharp.dll"
    managed.parent.mkdir(parents=True)
    managed.write_bytes(b"fixture")
    (tmp_path / "steam" / "steamapps" / "appmanifest_3241660.acf").write_bytes(b"fixture")
    asset_path = "assets/cosmetics/head/first.png"
    guid = "a" * 32
    monkeypatch.setattr(artwork, "_installed_game_root", lambda _game_dir: game_root)
    monkeypatch.setattr(artwork, "_installed_guids", lambda _root: ({0: guid}, ()))
    monkeypatch.setattr(artwork, "_catalog_sprite_paths", lambda _root, _guids: {0: asset_path})
    monkeypatch.setattr(artwork, "_find_unique_bundle_paths", lambda _root, _paths: {0: bundle})
    sprite = SimpleNamespace(image=Image.new("RGBA", (32, 30), (5, 8, 10, 255)))
    reader = SimpleNamespace(type=SimpleNamespace(name="Sprite"), parse_as_object=lambda: sprite)
    pointer = SimpleNamespace(type=SimpleNamespace(name="Sprite"), deref=lambda: reader)
    closed: list[bool] = []
    environment = SimpleNamespace(
        container={"Assets/Cosmetics/Head/First.png": pointer,
                   "Assets/Cosmetics/Head/Second.png": SimpleNamespace(
                       type=SimpleNamespace(name="Texture2D"))},
        close=lambda: closed.append(True),
    )
    monkeypatch.setitem(sys.modules, "UnityPy", SimpleNamespace(load=lambda _path: environment))
    monkeypatch.setitem(sys.modules, "repo_save_editor.services.game.discovery",
                        SimpleNamespace(APP_MANIFEST_NAME="appmanifest_3241660.acf"))
    result = artwork.prepare_installed_cosmetic_artwork([0], game_dir=game_root)
    assert len(result) == 1
    assert result[0].asset_guid == guid
    assert (result[0].width, result[0].height) == (32, 30)
    assert len(result[0].source_identity) == 64
    assert closed == [True]
    assert sorted(p.name for p in aa.iterdir()) == ["catalog.bin", "cosmetics.bundle"]
