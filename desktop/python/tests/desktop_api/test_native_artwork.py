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
from repo_save_editor.services.game import installed_build
from repo_save_editor.services.game.discovery import discover_game_installation
from tests.desktop_api.test_editor_domains import _write_save
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
    root = tmp_path / "saves"
    sample_save["dictionaryOfDictionaries"]["value"]["playerUpgradeHealth"] = {"111": 1}
    save = _write_save(root, sample_save)
    fingerprint = hashlib.sha256(save.read_bytes()).hexdigest()
    return root, save, fingerprint, data


def get(fixture, key="playerUpgradeHealth", fingerprint=None):
    root, save, current, _ = fixture
    return icons.get_native_upgrade_artwork(save.parent.name, fingerprint or current, key, root)


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
):
    *_, data = native_artwork
    before = get(native_artwork)["artwork"]
    stream = data / "resources.assets.resS"
    info = stream.stat()
    stream.write_bytes(struct.pack("<HHI", 0x001F, 0, 0))
    os.utime(stream, ns=(info.st_atime_ns, info.st_mtime_ns))
    after = get(native_artwork)["artwork"]
    assert before is not None
    assert after is not None
    assert before["pngBase64"] != after["pngBase64"]
    assert before["sourceIdentity"] != after["sourceIdentity"]
