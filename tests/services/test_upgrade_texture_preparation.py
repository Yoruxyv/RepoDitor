from __future__ import annotations

from pathlib import Path

import pytest

from repo_save_editor.services.game.discovery import GameInstallation
from repo_save_editor.services.game.installed_build import ValidatedInstalledBuild
from repo_save_editor.services.player import upgrade_textures
from repo_save_editor.services.player.upgrade_textures import (
    DecodedUpgradeTexture,
    SourceWatch,
    UpgradePreparationStage,
    UpgradeTextureError,
    prepare_installed_upgrade_textures,
)
from repo_save_editor.services.unity_serialized import UnityMetadataError
from repo_save_editor.services.unity_textures import Texture2DMetadata


def _installation(tmp_path: Path) -> tuple[GameInstallation, ValidatedInstalledBuild]:
    root = tmp_path / "REPO"
    root.mkdir()
    catalog = root / "REPO_Data/StreamingAssets/aa/catalog.json"
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")
    manifest = tmp_path / "appmanifest_3241660.acf"
    manifest.write_text('"buildid" "23363152"', encoding="utf-8")
    return (
        GameInstallation(root, catalog, tmp_path),
        ValidatedInstalledBuild("23363152", manifest),
    )


def _decoded(key: str, tmp_path: Path) -> DecodedUpgradeTexture:
    watch = tmp_path / f"{key}.assets"
    watch.write_bytes(b"source")
    stat = watch.stat()
    texture = Texture2DMetadata(
        40,
        f"{key}_Albedo",
        4,
        4,
        "DXT1",
        1,
        "resources.assets.resS",
        0,
        8,
        0,
        8,
    )
    return DecodedUpgradeTexture(
        key,
        texture,
        b"png",
        4,
        4,
        key.removeprefix("playerUpgrade").lower().ljust(64, "0")[:64],
        (SourceWatch(watch, stat.st_size, stat.st_mtime_ns),),
    )


def _patch_validated_paths(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    paths = [
        tmp_path / name
        for name in (
            "REPO",
            "REPO/REPO_Data",
            "resources.assets",
            "globalgamemanagers",
            "Assembly-CSharp.dll",
            "appmanifest_3241660.acf",
        )
    ]
    for path in paths:
        if path.suffix or path.name == "globalgamemanagers":
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch(exist_ok=True)
        else:
            path.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(
        upgrade_textures,
        "_validated_paths",
        lambda _installation, _build: (*paths, "23363152"),
    )


def test_batch_opens_unity_indexes_once_for_dynamic_upgrade_set(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    installation, build = _installation(tmp_path)
    _patch_validated_paths(monkeypatch, tmp_path)
    opened: list[Path] = []

    class FakeIndex:
        def __init__(self, path: Path) -> None:
            opened.append(path)

        def __enter__(self) -> FakeIndex:
            return self

        def __exit__(self, *_exc: object) -> None:
            return None

    keys = ("playerUpgradeHealth", "playerUpgradeStrength", "playerUpgradeMoonBoots")
    visual = object()
    resolved_names: list[tuple[str, ...]] = []
    decoded_keys: list[str] = []
    stages: list[UpgradePreparationStage] = []
    completed: list[tuple[str, bool]] = []

    monkeypatch.setattr(upgrade_textures, "SerializedFileIndex", FakeIndex)
    monkeypatch.setattr(
        upgrade_textures,
        "_resolve_upgrade_visual_from_indexes",
        lambda _managers, _resources, names, **_kwargs: resolved_names.append(names) or visual,
    )

    def decode(key: str, _visual: object, **_kwargs: object) -> DecodedUpgradeTexture:
        decoded_keys.append(key)
        return _decoded(key, tmp_path)

    monkeypatch.setattr(upgrade_textures, "_decode_resolved_upgrade_texture", decode)

    result = prepare_installed_upgrade_textures(
        keys,
        installation,
        build,
        on_stage=lambda stage, _installation, _build: stages.append(stage),
        on_texture=lambda key, texture: completed.append((key, texture is not None)),
    )

    assert opened == [tmp_path / "globalgamemanagers", tmp_path / "resources.assets"]
    assert len(resolved_names) == len(keys)
    assert decoded_keys == list(keys)
    assert completed == [(key, True) for key in keys]
    assert stages == [
        UpgradePreparationStage.INDEXING,
        UpgradePreparationStage.RESOLVING,
        UpgradePreparationStage.DECODING,
    ]
    assert [key for key, _texture in result.textures] == list(keys)
    assert result.assets_ready is True


def test_zero_work_startup_validates_asset_sources_without_opening_unity_indexes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    installation, build = _installation(tmp_path)
    _patch_validated_paths(monkeypatch, tmp_path)
    stages: list[UpgradePreparationStage] = []

    class UnexpectedIndex:
        def __init__(self, _path: Path) -> None:
            raise AssertionError("zero-work startup should not mmap Unity object indexes")

    monkeypatch.setattr(upgrade_textures, "SerializedFileIndex", UnexpectedIndex)

    result = prepare_installed_upgrade_textures(
        (),
        installation,
        build,
        on_stage=lambda stage, _installation, _build: stages.append(stage),
    )

    assert result.assets_ready is True
    assert result.textures == ()
    assert stages == [UpgradePreparationStage.INDEXING]


def test_batch_keeps_individual_resolve_and_decode_failures_fail_soft(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    installation, build = _installation(tmp_path)
    _patch_validated_paths(monkeypatch, tmp_path)

    class FakeIndex:
        def __init__(self, _path: Path) -> None:
            pass

        def __enter__(self) -> FakeIndex:
            return self

        def __exit__(self, *_exc: object) -> None:
            return None

    keys = ("playerUpgradeHealth", "playerUpgradeBroken", "playerUpgradeStrength")
    monkeypatch.setattr(upgrade_textures, "SerializedFileIndex", FakeIndex)

    def resolve(_managers: object, _resources: object, names: tuple[str, ...], **_kwargs: object):
        if any("Broken" in name for name in names):
            raise UnityMetadataError("broken fixture")
        return object()

    monkeypatch.setattr(upgrade_textures, "_resolve_upgrade_visual_from_indexes", resolve)

    def decode(key: str, _visual: object, **_kwargs: object) -> DecodedUpgradeTexture:
        if key == "playerUpgradeStrength":
            raise UpgradeTextureError("decode fixture")
        return _decoded(key, tmp_path)

    monkeypatch.setattr(upgrade_textures, "_decode_resolved_upgrade_texture", decode)
    reported: dict[str, DecodedUpgradeTexture | None] = {}

    result = prepare_installed_upgrade_textures(
        keys,
        installation,
        build,
        on_texture=lambda key, texture: reported.__setitem__(key, texture),
    )

    assert result.assets_ready is True
    assert reported["playerUpgradeHealth"] is not None
    assert reported["playerUpgradeBroken"] is None
    assert reported["playerUpgradeStrength"] is None
    assert dict(result.textures)["playerUpgradeHealth"] is not None
    assert dict(result.textures)["playerUpgradeBroken"] is None
    assert dict(result.textures)["playerUpgradeStrength"] is None


def test_batch_rejects_unbounded_or_malformed_dynamic_identity_sets(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    installation, build = _installation(tmp_path)
    _patch_validated_paths(monkeypatch, tmp_path)

    with pytest.raises(UpgradeTextureError, match="batch exceeds"):
        prepare_installed_upgrade_textures(
            (
                f"playerUpgradeMod{index}"
                for index in range(upgrade_textures.MAX_BATCH_UPGRADES + 1)
            ),
            installation,
            build,
        )
    with pytest.raises(UpgradeTextureError, match="identity"):
        prepare_installed_upgrade_textures(("../not-an-upgrade",), installation, build)
