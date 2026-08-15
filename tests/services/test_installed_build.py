from __future__ import annotations

from pathlib import Path

from repo_save_editor.services.game.discovery import (
    APP_MANIFEST_NAME,
    CATALOG_RELATIVE_PATH,
    GameDiscoveryStatus,
    discover_game_installation,
)
from repo_save_editor.services.game.installed_build import (
    VALIDATED_BUILD_ID,
    validated_installed_build,
)


def _steam_install(tmp_path: Path, build_id: str) -> tuple[Path, Path]:
    steam_root = tmp_path / "Steam"
    game_root = steam_root / "steamapps/common/REPO"
    catalog = game_root / CATALOG_RELATIVE_PATH
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")
    manifest = steam_root / "steamapps" / APP_MANIFEST_NAME
    manifest.write_text(
        f'"AppState"\n{{\n"appid" "3241660"\n"installdir" "REPO"\n"buildid" "{build_id}"\n}}\n',
        encoding="utf-8",
    )
    return steam_root, game_root


def test_discovery_and_supported_build_validation_are_separate_steps(tmp_path: Path) -> None:
    steam_root, game_root = _steam_install(tmp_path, VALIDATED_BUILD_ID)

    result = discover_game_installation(steam_roots=(steam_root,), environment={})

    assert result.status is GameDiscoveryStatus.FOUND
    assert result.installation is not None
    assert result.installation.root == game_root.resolve()
    build = validated_installed_build(result.installation)
    assert build is not None
    assert build.build_id == VALIDATED_BUILD_ID


def test_discovery_can_succeed_when_build_validation_rejects_candidate(tmp_path: Path) -> None:
    steam_root, _game_root = _steam_install(tmp_path, "99999999")

    result = discover_game_installation(steam_roots=(steam_root,), environment={})

    assert result.status is GameDiscoveryStatus.FOUND
    assert result.installation is not None
    assert validated_installed_build(result.installation) is None


def test_explicit_root_does_not_gain_steam_provenance_from_path_shape(tmp_path: Path) -> None:
    _steam_root, game_root = _steam_install(tmp_path, VALIDATED_BUILD_ID)

    result = discover_game_installation(game_root)

    assert result.status is GameDiscoveryStatus.FOUND
    assert result.installation is not None
    assert result.installation.manifest_path is None
    assert result.installation.steam_library_root is None
    assert validated_installed_build(result.installation) is None


def test_build_validation_rechecks_authoritative_manifest(tmp_path: Path) -> None:
    steam_root, _game_root = _steam_install(tmp_path, VALIDATED_BUILD_ID)
    result = discover_game_installation(steam_roots=(steam_root,), environment={})
    assert result.installation is not None
    manifest = result.installation.manifest_path
    assert manifest is not None

    manifest.write_text(
        '"AppState" { "appid" "3241660" "installdir" "REPO" "buildid" "99999999" }',
        encoding="utf-8",
    )

    assert validated_installed_build(result.installation) is None
