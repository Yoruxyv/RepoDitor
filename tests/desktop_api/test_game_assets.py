from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

from repo_save_editor.desktop_api import game_assets
from repo_save_editor.desktop_api.game_assets import (
    parse_upgrade_keys_payload,
    prepare_game_assets,
    read_upgrade_keys_stdin,
)
from repo_save_editor.services.game.discovery import (
    GameDiscoveryResult,
    GameDiscoveryStatus,
    GameInstallation,
)
from repo_save_editor.services.game.installed_build import ValidatedInstalledBuild
from repo_save_editor.services.player.upgrade_textures import (
    DecodedUpgradeTexture,
    SourceWatch,
    UpgradePreparationStage,
    UpgradeTextureBatchResult,
    UpgradeTextureError,
)
from repo_save_editor.services.unity_textures import Texture2DMetadata


def _installation(tmp_path: Path) -> GameInstallation:
    root = tmp_path / "secondary-library" / "steamapps" / "common" / "REPO"
    catalog = root / "REPO_Data/StreamingAssets/aa/catalog.json"
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")
    return GameInstallation(root, catalog, tmp_path / "secondary-library")


def _build(tmp_path: Path) -> ValidatedInstalledBuild:
    manifest = tmp_path / "secondary-library/steamapps/appmanifest_3241660.acf"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text('"buildid" "23363152"', encoding="utf-8")
    return ValidatedInstalledBuild("23363152", manifest)


def _decoded(key: str, tmp_path: Path) -> DecodedUpgradeTexture:
    watch = tmp_path / "resources.assets"
    watch.write_bytes(b"source")
    stat = watch.stat()
    texture = Texture2DMetadata(
        40,
        "Upgrade_Health_Albedo",
        1,
        1,
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
        b"\x89PNG\r\n\x1a\n" + b"fixture",
        1,
        1,
        "a" * 64,
        (SourceWatch(watch, stat.st_size, stat.st_mtime_ns),),
    )


def test_payload_accepts_dynamic_n_and_deduplicates_without_fixed_catalog() -> None:
    keys = [f"playerUpgradeFuture{index}" for index in range(17)]
    parsed = parse_upgrade_keys_payload(json.dumps([*keys, keys[0]]))

    assert parsed == tuple(keys)
    assert len(parsed) == 17


def test_payload_rejects_bad_shape_and_unbounded_count() -> None:
    with pytest.raises(UpgradeTextureError):
        parse_upgrade_keys_payload("{}")
    with pytest.raises(UpgradeTextureError):
        parse_upgrade_keys_payload(json.dumps([1]))
    with pytest.raises(UpgradeTextureError):
        parse_upgrade_keys_payload(
            json.dumps(
                [f"playerUpgrade{index}" for index in range(game_assets.MAX_BATCH_UPGRADES + 1)]
            )
        )


def test_stdin_request_accepts_one_bounded_utf8_json_array() -> None:
    keys = ["playerUpgradeHealth", "playerUpgradeFutureVision"]

    assert read_upgrade_keys_stdin(io.BytesIO(json.dumps(keys).encode("utf-8"))) == tuple(keys)


def test_stdin_request_rejects_oversized_or_malformed_input() -> None:
    oversized = io.BytesIO(b"[" + b" " * game_assets.MAX_PREPARATION_PAYLOAD_BYTES + b"]")
    with pytest.raises(UpgradeTextureError, match="exceeds"):
        read_upgrade_keys_stdin(oversized)
    with pytest.raises(UpgradeTextureError, match="invalid JSON"):
        read_upgrade_keys_stdin(io.BytesIO(b"not-json"))
    with pytest.raises(UpgradeTextureError, match="valid UTF-8"):
        read_upgrade_keys_stdin(io.BytesIO(b"[\xff]"))


def test_preparation_emits_indeterminate_start_then_real_completed_total(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    installation = _installation(tmp_path)
    build = _build(tmp_path)
    keys = ("playerUpgradeHealth", "playerUpgradeStrength", "playerUpgradeMoonBoots")
    monkeypatch.setattr(
        game_assets,
        "discover_game_installation",
        lambda: GameDiscoveryResult(GameDiscoveryStatus.FOUND, installation),
    )
    monkeypatch.setattr(game_assets, "validated_installed_build", lambda _installation: build)

    def prepare(
        requested: tuple[str, ...],
        passed_installation: GameInstallation,
        passed_build: ValidatedInstalledBuild,
        *,
        on_stage,
        on_texture,
    ) -> UpgradeTextureBatchResult:
        assert requested == keys
        assert passed_installation is installation
        assert passed_build is build
        on_stage(UpgradePreparationStage.INDEXING, True, True)
        on_stage(UpgradePreparationStage.RESOLVING, True, True)
        on_stage(UpgradePreparationStage.DECODING, True, True)
        textures = []
        for key in requested:
            decoded = _decoded(key, tmp_path)
            on_texture(key, decoded)
            textures.append((key, decoded))
        return UpgradeTextureBatchResult(True, True, True, tuple(textures))

    monkeypatch.setattr(game_assets, "prepare_installed_upgrade_textures", prepare)
    records: list[dict[str, object]] = []

    prepare_game_assets(keys, records.append)

    assert [record["stage"] for record in records if record["type"] == "progress"] == [
        "indexing",
        "resolving",
        "decoding",
    ]
    assert all(
        record["installationFound"] is True and record["buildVerified"] is True
        for record in records
        if record["type"] == "progress"
    )
    assert [record["completed"] for record in records if record["type"] == "texture"] == [1, 2, 3]
    assert records[-1] == {
        "type": "final",
        "ok": True,
        "installationFound": True,
        "buildVerified": True,
        "completed": 3,
        "total": 3,
        "degraded": False,
    }


def test_zero_work_startup_keeps_progress_indeterminate(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    installation = _installation(tmp_path)
    build = _build(tmp_path)
    monkeypatch.setattr(
        game_assets,
        "discover_game_installation",
        lambda: GameDiscoveryResult(GameDiscoveryStatus.FOUND, installation),
    )
    monkeypatch.setattr(game_assets, "validated_installed_build", lambda _installation: build)

    def unexpected_prepare(*_args: object, **_kwargs: object) -> UpgradeTextureBatchResult:
        raise AssertionError("zero-work startup must not create a disposable Unity index")

    monkeypatch.setattr(game_assets, "prepare_installed_upgrade_textures", unexpected_prepare)
    records: list[dict[str, object]] = []

    prepare_game_assets((), records.append)

    assert [record["stage"] for record in records if record["type"] == "progress"] == [
        "discovering",
        "validating",
    ]
    assert all(
        record.get("completed") is None and record.get("total") is None for record in records
    )
    assert records[-1]["degraded"] is False


@pytest.mark.parametrize(
    ("installation_found", "build_verified"),
    [(False, False), (True, False)],
)
def test_missing_or_unverified_installation_degrades_without_asset_parsing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    installation_found: bool,
    build_verified: bool,
) -> None:
    installation = _installation(tmp_path) if installation_found else None
    monkeypatch.setattr(
        game_assets,
        "discover_game_installation",
        lambda: GameDiscoveryResult(
            GameDiscoveryStatus.FOUND
            if installation is not None
            else GameDiscoveryStatus.GAME_NOT_FOUND,
            installation,
        ),
    )
    monkeypatch.setattr(
        game_assets,
        "validated_installed_build",
        lambda _installation: _build(tmp_path) if build_verified else None,
    )

    def unexpected_prepare(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("asset parsing must not start without a verified build")

    monkeypatch.setattr(game_assets, "prepare_installed_upgrade_textures", unexpected_prepare)
    records: list[dict[str, object]] = []

    prepare_game_assets(("playerUpgradeHealth", "playerUpgradeFuture"), records.append)

    assert records[-1] == {
        "type": "final",
        "ok": True,
        "installationFound": installation_found,
        "buildVerified": build_verified,
        "completed": 2,
        "total": 2,
        "degraded": True,
    }


def test_partial_decode_failure_finishes_all_real_units_and_degrades(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    installation = _installation(tmp_path)
    build = _build(tmp_path)
    monkeypatch.setattr(
        game_assets,
        "discover_game_installation",
        lambda: GameDiscoveryResult(GameDiscoveryStatus.FOUND, installation),
    )
    monkeypatch.setattr(game_assets, "validated_installed_build", lambda _installation: build)

    def prepare(requested, _installation, _build, *, on_stage, on_texture):
        on_stage(UpgradePreparationStage.INDEXING, True, True)
        on_stage(UpgradePreparationStage.RESOLVING, True, True)
        on_stage(UpgradePreparationStage.DECODING, True, True)
        first = _decoded(requested[0], tmp_path)
        on_texture(requested[0], first)
        on_texture(requested[1], None)
        return UpgradeTextureBatchResult(
            True,
            True,
            True,
            ((requested[0], first), (requested[1], None)),
        )

    monkeypatch.setattr(game_assets, "prepare_installed_upgrade_textures", prepare)
    records: list[dict[str, object]] = []

    prepare_game_assets(("playerUpgradeHealth", "playerUpgradeBroken"), records.append)

    texture_records = [record for record in records if record["type"] == "texture"]
    assert [record["completed"] for record in texture_records] == [1, 2]
    assert texture_records[1]["texture"] is None
    assert records[-1]["completed"] == 2
    assert records[-1]["total"] == 2
    assert records[-1]["degraded"] is True


def test_asset_index_failure_degrades_all_requested_visuals_without_blocking(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    installation = _installation(tmp_path)
    build = _build(tmp_path)
    monkeypatch.setattr(
        game_assets,
        "discover_game_installation",
        lambda: GameDiscoveryResult(GameDiscoveryStatus.FOUND, installation),
    )
    monkeypatch.setattr(game_assets, "validated_installed_build", lambda _installation: build)

    def prepare(_requested, _installation, _build, *, on_stage, **_kwargs):
        on_stage(UpgradePreparationStage.INDEXING, True, True)
        return UpgradeTextureBatchResult(True, True, False, ())

    monkeypatch.setattr(game_assets, "prepare_installed_upgrade_textures", prepare)
    records: list[dict[str, object]] = []

    prepare_game_assets(("playerUpgradeHealth", "playerUpgradeFuture"), records.append)

    assert [record["type"] for record in records].count("texture") == 0
    assert records[-1] == {
        "type": "final",
        "ok": True,
        "installationFound": True,
        "buildVerified": True,
        "completed": 2,
        "total": 2,
        "degraded": True,
    }
