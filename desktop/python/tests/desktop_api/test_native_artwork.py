"""Synthetic installed assets exercise the real Python decoder and native boundary."""

from __future__ import annotations

import base64
import hashlib
import os
import struct
import subprocess
from pathlib import Path

import pytest

from repo_save_editor.desktop_api import icons
from repo_save_editor.desktop_api.discovery import maps
from repo_save_editor.services.artwork import baked_artwork
from repo_save_editor.services.artwork.native_artwork_cache import artwork_cache_root
from repo_save_editor.services.game import installed_build
from repo_save_editor.services.game.discovery import (
    discover_game_installation,
    validate_game_installation,
)
from repo_save_editor.services.texture_codec import encode_rgba_png
from repo_save_editor.services.unity_hash import unity_hash128
from tests.desktop_api.test_editor_domains import _write_save
from tests.services.test_baked_artwork import _installation
from tests.services.test_installed_build import _steam_install
from tests.services.test_upgrade_textures import _write_resource_manager, _write_upgrade_assets


@pytest.fixture
def native_artwork(tmp_path, monkeypatch, sample_save):
    library, game = _steam_install(tmp_path / "installed", "99999999")
    data = game / "REPO_Data"
    _write_upgrade_assets(data / "resources.assets")
    _write_resource_manager(data / "globalgamemanagers", ("items/item upgrade player health", 1, 1))
    (data / "globalgamemanagers.assets").write_bytes(b"optional unavailable enrichment")
    (data / "resources.assets.resS").write_bytes(struct.pack("<HHI", 0xF800, 0, 0))
    assembly = data / "Managed/Assembly-CSharp.dll"
    assembly.parent.mkdir()
    assembly.write_bytes(b"independently pinned synthetic assembly")
    monkeypatch.setitem(
        installed_build._UNITY6_ARTWORK_ASSEMBLIES,
        "26407089",
        hashlib.sha256(assembly.read_bytes()).hexdigest(),
    )
    installation = discover_game_installation(steam_roots=(library,), environment={}).installation
    assert installation is not None
    monkeypatch.setattr(icons, "artwork_installation", lambda _: installation)
    monkeypatch.setattr(baked_artwork, "_installation", lambda _: installation)
    root = tmp_path / "saves"
    sample_save["dictionaryOfDictionaries"]["value"]["playerUpgradeHealth"] = {"111": 1}
    save = _write_save(root, sample_save)
    fingerprint = hashlib.sha256(save.read_bytes()).hexdigest()
    return root, save, fingerprint, data


def get(fixture, key="playerUpgradeHealth", fingerprint=None, *, persistent=False):
    root, save, current, _ = fixture
    return icons.get_native_upgrade_artwork(
        save.parent.name, fingerprint or current, key, root, persistent=persistent
    )


def test_native_artwork_uses_real_validated_decoder_without_paths_or_save_writes(native_artwork):
    _, save, _, _ = native_artwork
    before = save.read_bytes()
    result = get(native_artwork)
    image = result["artwork"]
    assert image is not None
    assert set(image) == {"upgradeKey", "sourceIdentity", "width", "height", "pngBase64"}
    assert (image["width"], image["height"]) == (2, 2)
    assert base64.b64decode(image["pngBase64"], validate=True).startswith(b"\x89PNG\r\n\x1a\n")
    assert save.read_bytes() == before
    assert get(native_artwork) == result


def test_upgrade_batch_preserves_valid_images_when_other_keys_are_unavailable(native_artwork):
    root, save, fingerprint, _ = native_artwork
    before = save.read_bytes()
    key = "playerUpgradeHealth"
    expected = get(native_artwork)["artwork"]
    assert expected is not None

    def read(keys, digest=fingerprint):
        return icons.get_native_upgrade_artwork_batch(save.parent.name, digest, keys, root)

    assert read([key, key]) == {"ok": False}
    assert read([key, "playerUpgradeOther", "../../resources.assets"]) == {
        "ok": True,
        "artworks": [expected, None, None],
    }
    assert read([key, "playerUpgradeOther"], "f" * 64) == {"ok": True, "artworks": [None, None]}
    assert save.read_bytes() == before


def test_truck_upgrade_decodes_without_a_matching_player_dictionary(native_artwork, sample_save):
    root, save, _, _ = native_artwork
    expected = get(native_artwork)["artwork"]
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    del dictionaries["playerUpgradeHealth"]
    dictionaries["item"] = {"Item Upgrade Player Health/1": 1}
    _write_save(root, sample_save)
    fingerprint = hashlib.sha256(save.read_bytes()).hexdigest()
    assert expected is not None
    assert get(native_artwork, fingerprint=fingerprint)["artwork"] == expected
    assert get(native_artwork, key="playerUpgradeOther", fingerprint=fingerprint)["artwork"] is None


def test_upgrade_preparation_caches_only_confirmed_prefab_absence(native_artwork):
    _, _, _, data = native_artwork
    installation = icons.artwork_installation(None)
    assert installation is not None
    build = installed_build.validated_installed_artwork_build(installation)
    assert build is not None
    health, other = "playerUpgradeHealth", "playerUpgradeOther"
    entry = ("items/item upgrade player health", 1, 1)
    _write_resource_manager(data / "globalgamemanagers", entry, entry)

    batch = icons.prepare_installed_upgrade_textures((health, other), installation, build)

    assert batch.assets_ready
    assert batch.textures == ((health, None), (other, None))
    assert batch.missing == frozenset({other})


def test_map_batch_returns_only_requested_members_without_source_watches(monkeypatch):
    revision = "a" * 64
    image = {"sourceIdentity": revision, "pngBase64": "AQID", "width": 1, "height": 1}

    def decode(*, expected_revision, families):
        assert families == ("Arctic", "Missing")
        return (
            {"Arctic": {**image, "watches": ["private"]}} if expected_revision == revision else {}
        )

    monkeypatch.setattr(maps, "decode_map_artwork", decode)
    assert maps.get_native_map_artwork_batch(revision, ["Arctic", "Arctic"]) == {"ok": False}
    assert maps.get_native_map_artwork_batch(revision, ["Arctic", "Missing"]) == {
        "ok": True,
        "artworks": [{"mapFamily": "Arctic", **image}, None],
    }
    assert maps.get_native_map_artwork_batch("b" * 64, ["Arctic", "Missing"]) == {
        "ok": True,
        "artworks": [None, None],
    }


def test_map_batch_carries_the_five_preview_roster_without_single_retries(monkeypatch):
    revision = "a" * 64
    roster = ["Arctic", "Manor", "Museum", "Resort", "Academy"]
    # Exercise the frame budget after image extraction, before native PNG validation.
    image = {"sourceIdentity": revision, "pngBase64": "A" * 600_000, "width": 1024, "height": 512}
    monkeypatch.setattr(maps, "decode_map_artwork", lambda **_: dict.fromkeys(roster, image))
    assert maps.get_native_map_artwork_batch(revision, roster) == {
        "ok": True,
        "artworks": [{"mapFamily": family, **image} for family in roster],
    }
    assert maps.get_native_map_artwork_batch(revision, [*roster, "Other"]) == {"ok": False}


@pytest.mark.parametrize(
    "damage",
    [
        "missing",
        "assembly",
        "malformed",
        "stale_save",
        "fingerprint",
        "membership",
        "traversal",
        "during_decode",
        "oversized",
    ],
)
def test_native_artwork_fails_soft_without_cached_replay(native_artwork, monkeypatch, damage):
    _, save, _, data = native_artwork
    assert get(native_artwork)["artwork"] is not None
    key = "playerUpgradeHealth"
    fingerprint = None
    if damage == "missing":
        (data / "resources.assets.resS").unlink()
    elif damage == "assembly":
        (data / "Managed/Assembly-CSharp.dll").write_bytes(b"changed")
    elif damage == "malformed":
        (data / "resources.assets").write_bytes(b"invalid serialized file")
    elif damage == "stale_save":
        save.write_bytes(save.read_bytes() + b"changed")
    elif damage == "fingerprint":
        fingerprint = "f" * 64
    elif damage == "membership":
        key = "playerUpgradeOther"
    elif damage == "traversal":
        key = "../../resources.assets"
    elif damage == "oversized":
        with (data / "Managed/Assembly-CSharp.dll").open("r+b") as handle:
            handle.truncate(32 * 1024 * 1024 + 1)
    else:
        original = icons.prepare_installed_upgrade_textures

        def changed(*args, **kwargs):
            decoded = original(*args, **kwargs)
            (data / "resources.assets").write_bytes(b"changed after decoding")
            return decoded

        monkeypatch.setattr(icons, "prepare_installed_upgrade_textures", changed)
    assert get(native_artwork, key, fingerprint) == {"ok": True, "artwork": None}


def test_native_artwork_rejects_reparse_source_ancestors(native_artwork):
    _, _, _, data = native_artwork
    managed = data / "Managed"
    target = data / "SyntheticManaged"
    assert managed.resolve().parent == data.resolve()
    assert target.parent.resolve() == data.resolve()
    managed.rename(target)
    if os.name == "nt":
        subprocess.run(  # noqa: S603 - Fixed fixture-only junction creation.
            [
                str(Path(os.environ["SYSTEMROOT"]) / "System32/cmd.exe"),
                "/c",
                "mklink",
                "/J",
                str(managed),
                str(target),
            ],
            check=True,
            capture_output=True,
        )
    else:
        managed.symlink_to(target, target_is_directory=True)
    assert get(native_artwork) == {"ok": True, "artwork": None}


def test_native_artwork_revision_includes_pixels_even_when_source_metadata_is_preserved(
    native_artwork,
    tmp_path,
    monkeypatch,
):
    _, save, _, data = native_artwork
    source = save.read_bytes()
    monkeypatch.setenv("REPODITOR_E2E", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    (tmp_path / "RepoDitorPreview").mkdir()
    before = get(native_artwork, persistent=True)["artwork"]
    cache = artwork_cache_root(editor=True)
    if cache is not None:
        assert (cache / "upgrade.bin").is_file()
        with monkeypatch.context() as changes:

            def unexpected_decode(*_args, **_kwargs):
                pytest.fail("Unchanged cache should bypass texture extraction")

            changes.setattr(icons, "prepare_installed_upgrade_textures", unexpected_decode)
            assert get(native_artwork, persistent=True)["artwork"] == before
    stream = data / "resources.assets.resS"
    info = stream.stat()
    stream.write_bytes(struct.pack("<HHI", 0x001F, 0, 0))
    os.utime(stream, ns=(info.st_atime_ns, info.st_mtime_ns))
    after = get(native_artwork, persistent=True)["artwork"]
    assert before is not None
    assert after is not None
    assert before["pngBase64"] != after["pngBase64"]
    assert before["sourceIdentity"] != after["sourceIdentity"]
    assert save.read_bytes() == source


def test_native_item_artwork_revalidates_exact_type_save_and_baked_sources(
    tmp_path, monkeypatch, sample_save
):
    game, library = _installation(tmp_path, monkeypatch)
    install = baked_artwork._installation
    monkeypatch.setattr(baked_artwork, "_installation", lambda _: install(game))
    installation = validate_game_installation(game, steam_library_root=library)
    assert installation is not None
    monkeypatch.setattr(icons, "artwork_installation", lambda _: installation)

    def unexpected_catalog(*_args, **_kwargs):
        pytest.fail("Item artwork must not prepare the Cosmetics catalog")

    monkeypatch.setattr(baked_artwork, "_cosmetic_keys", unexpected_catalog)
    root = tmp_path / "saves"
    sample_save["dictionaryOfDictionaries"]["value"]["item"] = {"Item Tool/1": 1}
    save = _write_save(root, sample_save)
    source = save.read_bytes()
    fingerprint = hashlib.sha256(source).hexdigest()
    png_path = (
        game
        / "REPO_Data/StreamingAssets/BakedIcons/Items"
        / (unity_hash128("Item Tool|Prefab") + ".png")
    )
    png_path.parent.mkdir(parents=True)
    monkeypatch.setenv("REPODITOR_E2E", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    (tmp_path / "RepoDitorPreview").mkdir()

    def read(name="Item Tool", stamp=fingerprint):
        return icons.get_native_item_artwork(save.parent.name, stamp, name, root, persistent=True)[
            "artwork"
        ]

    assert read() is None
    png = encode_rgba_png(bytes([255, 0, 0, 255]), 1, 1)
    png_path.write_bytes(png)
    assert baked_artwork.entry_artwork_revision(tmp_path / "other installation") is None
    assert baked_artwork.read_baked_item_pngs(
        ("Item Tool",), expected_root=tmp_path / "other installation"
    ) == ({}, set(), set())
    first = read()
    assert first is not None
    assert set(first) == {"itemName", "sourceIdentity", "width", "height", "pngBase64"}
    assert first["itemName"] == "Item Tool"
    assert base64.b64decode(first["pngBase64"], validate=True) == png
    assert icons.get_native_item_artwork_batch(
        save.parent.name, fingerprint, ["Item Tool", "Item Other"], root
    ) == {"ok": True, "artworks": [first, None]}
    assert icons.get_native_item_artwork_batch(
        save.parent.name, fingerprint, ["Item Tool", "Item Tool"], root
    ) == {"ok": False}
    assert read("Item Other") is None
    assert read("Item Tool/1") is None
    assert read(stamp="f" * 64) is None
    stamp = png_path.stat()
    png_path.write_bytes(encode_rgba_png(bytes([0, 0, 255, 255]), 1, 1))
    os.utime(png_path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
    assert read()["sourceIdentity"] != first["sourceIdentity"]
    png_path.write_bytes(b"malformed")
    assert read() is None
    png_path.write_bytes(png)
    (game / "REPO_Data/Managed/Assembly-CSharp.dll").write_bytes(b"changed")
    assert read() is None
    assert save.read_bytes() == source
