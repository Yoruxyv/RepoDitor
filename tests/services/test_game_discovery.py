from __future__ import annotations

from pathlib import Path

import pytest

from repo_save_editor.services.game_discovery import (
    CATALOG_RELATIVE_PATH,
    GameDiscoveryIssueCode,
    GameDiscoveryStatus,
    SteamLibraryConfigError,
    discover_game_installation,
    parse_steam_library_paths,
)


def _write_library_config(steam_root: Path, libraries: list[Path]) -> None:
    entries = []
    for index, library in enumerate(libraries):
        value = str(library).replace("\\", "\\\\")
        entries.append(f'    "{index}" {{ "path" "{value}" }}')
    config = steam_root / "steamapps/libraryfolders.vdf"
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text(
        '"libraryfolders"\n{\n' + "\n".join(entries) + "\n}\n",
        encoding="utf-8",
    )


def _create_valid_installation(library_root: Path) -> Path:
    game_root = library_root / "steamapps/common/REPO"
    catalog = game_root / CATALOG_RELATIVE_PATH
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")
    return game_root


def test_multiple_steam_library_paths_are_parsed() -> None:
    paths = parse_steam_library_paths('"path" "D:\\\\SteamLibrary"\n"path" "F:\\\\Games"')

    assert paths == (Path(r"D:\SteamLibrary"), Path(r"F:\Games"))


def test_nonempty_malformed_library_configuration_is_rejected() -> None:
    with pytest.raises(SteamLibraryConfigError, match="no path entries"):
        parse_steam_library_paths('"libraryfolders" { "broken" }')


def test_repo_is_found_in_non_default_steam_library(tmp_path: Path) -> None:
    steam_root = tmp_path / "Steam"
    secondary_library = tmp_path / "SecondaryLibrary"
    steam_root.mkdir()
    secondary_library.mkdir()
    _write_library_config(steam_root, [steam_root, secondary_library])
    game_root = _create_valid_installation(secondary_library)

    result = discover_game_installation(
        steam_roots=(steam_root,),
        environment={},
    )

    assert result.status is GameDiscoveryStatus.FOUND
    assert result.installation is not None
    assert result.installation.root == game_root
    assert result.installation.steam_library_root == secondary_library


def test_repo_absence_is_an_intentional_result(tmp_path: Path) -> None:
    steam_root = tmp_path / "Steam"
    steam_root.mkdir()

    result = discover_game_installation(
        steam_roots=(steam_root,),
        environment={},
    )

    assert result.status is GameDiscoveryStatus.GAME_NOT_FOUND
    assert result.installation is None


def test_missing_steam_is_distinct_from_missing_game() -> None:
    result = discover_game_installation(
        steam_roots=(),
        environment={},
    )

    assert result.status is GameDiscoveryStatus.STEAM_NOT_FOUND
    assert result.installation is None


def test_candidate_without_addressables_catalog_is_rejected(tmp_path: Path) -> None:
    steam_root = tmp_path / "Steam"
    invalid_game = steam_root / "steamapps/common/REPO"
    invalid_game.mkdir(parents=True)

    result = discover_game_installation(
        steam_roots=(steam_root,),
        environment={},
    )

    assert result.status is GameDiscoveryStatus.GAME_NOT_FOUND
    assert result.installation is None


def test_malformed_library_configuration_is_reported(tmp_path: Path) -> None:
    steam_root = tmp_path / "Steam"
    steam_root.mkdir()
    config = steam_root / "steamapps/libraryfolders.vdf"
    config.parent.mkdir(parents=True)
    config.write_text('"libraryfolders" { "broken" }', encoding="utf-8")

    result = discover_game_installation(
        steam_roots=(steam_root,),
        environment={},
    )

    assert result.status is GameDiscoveryStatus.DISCOVERY_ERROR
    assert [issue.code for issue in result.issues] == [
        GameDiscoveryIssueCode.LIBRARY_CONFIG_MALFORMED
    ]
