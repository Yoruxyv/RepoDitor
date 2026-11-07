"""Synthetic normal-level discovery; no installed game bytes are fixtures."""

from __future__ import annotations

import hashlib
import struct
from pathlib import Path

import pytest

from repo_save_editor.services.game import installed_maps as native
from repo_save_editor.services.game.discovery import GameInstallation
from repo_save_editor.services.game.installed_build import ValidatedInstalledBuild
from repo_save_editor.services.game.maps import MapDiscoveryError, discover_installed_maps
from repo_save_editor.services.unity_artwork import SUNSTONE_UNITY_VERSION, ArtworkFileIndex
from repo_save_editor.services.unity_serialized import UnityMetadataError
from tests.unity_serialized_fixture import aligned_string, mono_script, pptr, write_serialized_file


def prefix(script: int, name: str) -> bytes:
    return pptr(0, 0) + b"\x01\0\0\0" + pptr(1, script) + aligned_string(name)


def level(family: str, name: str, path: str | None = None) -> bytes:
    resource = path or f"Level/{family}/Loading Graphics/preview 01"
    ref = (
        aligned_string(resource.rsplit("/", 1)[-1])
        + aligned_string(resource)
        + pptr(0, 0)
        + b"\1\0\0\0"
    )
    return (
        prefix(2, "Level - " + family)
        + struct.pack("<i", 0)
        + aligned_string(name)
        + pptr(0, 0)
        + struct.pack("<ii", 5, 9)
        + b"\1\0\0\0"
        + ref * 3
    )


def roster(pointers: list[tuple[int, int]]) -> bytes:
    vector = struct.pack("<i", len(pointers)) + b"".join(pptr(*p) for p in pointers)
    return (
        prefix(1, "")
        + struct.pack("<i", 1)
        + pptr(0, 0)
        + struct.pack("<i", 0)
        + pptr(0, 0) * 6
        + struct.pack("<ii", 0, 0)
        + vector
    )


def installation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, build_id: str = "26294889"
) -> GameInstallation:
    root = tmp_path / "steamapps/common/REPO"
    data = root / "REPO_Data"
    assembly = data / "Managed/Assembly-CSharp.dll"
    assembly.parent.mkdir(parents=True)
    assembly.write_bytes(b"synthetic assembly identity")
    manifest = tmp_path / "steamapps/appmanifest_3241660.acf"
    manifest.write_text("synthetic manifest", encoding="utf-8")
    monkeypatch.setattr(
        native,
        "artwork_assembly_sha256",
        lambda build: (
            hashlib.sha256(b"synthetic assembly identity").hexdigest()
            if build == build_id
            else None
        ),
    )
    monkeypatch.setattr(
        native,
        "validated_installed_artwork_build",
        lambda _: ValidatedInstalledBuild(build_id, manifest),
    )
    write_serialized_file(
        data / "globalgamemanagers.assets",
        [
            (1, 115, mono_script("RunManager", "RunManager")),
            (2, 115, mono_script("Level", "Level")),
        ],
        unity_version=SUNSTONE_UNITY_VERSION,
    )
    write_serialized_file(
        data / "sharedassets0.assets",
        [
            (91, 114, level("Future", "Authored future name")),
            (77, 114, level("Desert", "Sunstone Valley Resort")),
            (88, 114, level("Arena", "Excluded special level")),
        ],
        externals=(("", "globalgamemanagers.assets"),),
        unity_version=SUNSTONE_UNITY_VERSION,
    )
    write_serialized_file(
        data / "level0",
        [(9, 114, roster([(2, 77), (2, 91)]))],
        externals=(("", "globalgamemanagers.assets"), ("", "sharedassets0.assets")),
        unity_version=SUNSTONE_UNITY_VERSION,
    )
    return GameInstallation(
        root=root,
        catalog_path=data / "StreamingAssets/aa/catalog.json",
        steam_library_root=tmp_path,
        manifest_path=manifest,
        steam_build_id=build_id,
    )


@pytest.mark.parametrize("build_id", ["26294889", "26407089"])
def test_normal_level_roster_supplies_membership_and_names_without_catalog(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, build_id: str
) -> None:
    game = installation(tmp_path, monkeypatch, build_id)
    levels, sources = native.read_installed_levels(game)
    assert [(v.family, v.name) for v in levels] == [
        ("Desert", "Sunstone Valley Resort"),
        ("Future", "Authored future name"),
    ]
    assert levels[0].loading_paths == ("Level/Desert/Loading Graphics/preview 01",)
    assert len(sources) == 5
    monkeypatch.setattr("repo_save_editor.services.game.maps.artwork_installation", lambda _: game)
    found = discover_installed_maps()
    assert found is not None
    assert [m.internal_name for m in found.maps] == ["Future", "Desert"]


@pytest.mark.parametrize(
    "pointers", [[], [(2, 0)], [(2, 77), (2, 77)], [(9, 77)], [(2, 999)], [(2, 77)] * 129]
)
def test_invalid_rosters_fail_closed_and_release_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, pointers: list[tuple[int, int]]
) -> None:
    game = installation(tmp_path, monkeypatch)
    source = game.root / "REPO_Data/level0"
    write_serialized_file(
        source,
        [(9, 114, roster(pointers))],
        externals=(("", "globalgamemanagers.assets"), ("", "sharedassets0.assets")),
        unity_version=SUNSTONE_UNITY_VERSION,
    )
    with pytest.raises(UnityMetadataError):
        native.read_installed_levels(game)
    source.replace(source.with_suffix(".released"))


@pytest.mark.parametrize(
    "path", ["../preview", "Level/../preview", "C:/preview", "Level\\preview", "Level//preview"]
)
def test_unsafe_authored_resource_paths_are_rejected(tmp_path: Path, path: str) -> None:
    file = tmp_path / "level.assets"
    write_serialized_file(file, [(1, 114, level("Future", "Name", path))])
    with ArtworkFileIndex(file) as index:
        record = index.find_records({1})[1]
        reader = index.object_reader(record)
        reader.skip(len(prefix(2, "Level - Future")))
        with pytest.raises(UnityMetadataError):
            native.level_metadata(reader, "Level - Future")


@pytest.mark.parametrize("build_id", ["26294889", "26407089"])
def test_changed_or_unsupported_assembly_is_not_reinterpreted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, build_id: str
) -> None:
    game = installation(tmp_path, monkeypatch, build_id)
    (game.root / "REPO_Data/Managed/Assembly-CSharp.dll").write_bytes(b"changed")
    monkeypatch.setattr("repo_save_editor.services.game.maps.artwork_installation", lambda _: game)
    with pytest.raises(MapDiscoveryError, match="safely"):
        discover_installed_maps()


def test_unsupported_build_keeps_the_legacy_catalog_adapter(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    game = installation(tmp_path, monkeypatch)
    monkeypatch.setattr(native, "validated_installed_artwork_build", lambda _: None)
    assert native.read_installed_levels(game) is None
