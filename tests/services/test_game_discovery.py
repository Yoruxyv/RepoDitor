from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from repo_save_editor.services.game import discovery as game_discovery
from repo_save_editor.services.game.discovery import (
    APP_MANIFEST_NAME,
    CATALOG_RELATIVE_PATH,
    MAX_STEAM_APP_MANIFEST_BYTES,
    MAX_STEAM_LIBRARY_CONFIG_BYTES,
    MAX_STEAM_LIBRARY_ROOTS,
    STEAM_APP_ID,
    GameDiscoveryIssueCode,
    GameDiscoveryStatus,
    SteamAppManifestError,
    SteamLibraryConfigError,
    discover_game_installation,
    parse_steam_app_manifest,
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


def _write_manifest(
    library_root: Path,
    *,
    install_dir: str = "REPO",
    build_id: str = "23363152",
    app_id: str = STEAM_APP_ID,
) -> Path:
    manifest = library_root / "steamapps" / APP_MANIFEST_NAME
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(
        '"AppState"\n{\n'
        f'    "appid" "{app_id}"\n'
        f'    "installdir" "{install_dir}"\n'
        f'    "buildid" "{build_id}"\n'
        "}\n",
        encoding="utf-8",
    )
    return manifest


def _create_valid_installation(
    library_root: Path,
    *,
    install_dir: str = "REPO",
    build_id: str = "23363152",
) -> tuple[Path, Path]:
    manifest = _write_manifest(
        library_root,
        install_dir=install_dir,
        build_id=build_id,
    )
    game_root = library_root / "steamapps" / "common" / install_dir
    catalog = game_root / CATALOG_RELATIVE_PATH
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")
    return game_root.resolve(), manifest


def test_windows_steam_roots_use_registry_and_existing_program_files_fallbacks(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hkcu_root = tmp_path / "HKCU Steam"
    hklm_root = tmp_path / "HKLM Steam"
    program_files = tmp_path / "Program Files (x86)"
    fallback_root = program_files / "Steam"
    for root in (hkcu_root, hklm_root, fallback_root):
        root.mkdir(parents=True)

    hkey_current_user = object()
    hkey_local_machine = object()
    values = {
        (hkey_current_user, r"Software\Valve\Steam", "SteamPath"): str(hkcu_root),
        (
            hkey_local_machine,
            r"SOFTWARE\WOW6432Node\Valve\Steam",
            "InstallPath",
        ): str(hklm_root),
    }

    class FakeKey:
        def __init__(self, hive: object, name: str) -> None:
            self.hive = hive
            self.name = name

        def __enter__(self):
            return self

        def __exit__(self, *_exc: object) -> None:
            return None

    fake_winreg = SimpleNamespace(
        HKEY_CURRENT_USER=hkey_current_user,
        HKEY_LOCAL_MACHINE=hkey_local_machine,
        OpenKey=lambda hive, name: FakeKey(hive, name),
        QueryValueEx=lambda key, value_name: (
            values[(key.hive, key.name, value_name)],
            1,
        ),
    )
    monkeypatch.setattr(game_discovery.sys, "platform", "win32")
    monkeypatch.setitem(game_discovery.sys.modules, "winreg", fake_winreg)
    monkeypatch.setenv("ProgramFiles(x86)", str(program_files))
    monkeypatch.delenv("ProgramFiles", raising=False)

    assert game_discovery.find_windows_steam_roots() == (
        hkcu_root,
        hklm_root,
        fallback_root,
    )


def test_e2e_steam_root_override_is_bounded_to_explicit_test_mode(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    steam_root = tmp_path / "Isolated Steam"
    steam_root.mkdir()
    monkeypatch.setattr(game_discovery.sys, "platform", "linux")

    assert game_discovery.find_windows_steam_roots(
        {
            "REPODITOR_E2E": "1",
            "REPODITOR_E2E_STEAM_ROOT": str(steam_root),
        }
    ) == (steam_root,)
    assert (
        game_discovery.find_windows_steam_roots({"REPODITOR_E2E_STEAM_ROOT": str(steam_root)}) == ()
    )


def test_multiple_steam_library_paths_are_parsed() -> None:
    paths = parse_steam_library_paths('"path" "D:\\\\SteamLibrary"\n"path" "F:\\\\Games"')

    assert paths == (Path(r"D:\SteamLibrary"), Path(r"F:\Games"))


def test_nonempty_malformed_library_configuration_is_rejected() -> None:
    with pytest.raises(SteamLibraryConfigError, match="no valid path entries"):
        parse_steam_library_paths('"libraryfolders" { "broken" }')


def test_relative_or_unbounded_library_paths_are_rejected() -> None:
    with pytest.raises(SteamLibraryConfigError, match="no valid path entries"):
        parse_steam_library_paths('"path" "../SteamLibrary"')

    entries = "\n".join(
        f'"path" "C:\\Steam{index}"' for index in range(MAX_STEAM_LIBRARY_ROOTS + 1)
    )
    with pytest.raises(SteamLibraryConfigError, match="too many"):
        parse_steam_library_paths(entries)


def test_manifest_parser_extracts_identity_without_general_vdf_dependency() -> None:
    manifest = parse_steam_app_manifest(
        '"AppState" { "appid" "3241660" "installdir" "REPO" "buildid" "23363152" }'
    )

    assert manifest.app_id == STEAM_APP_ID
    assert manifest.install_dir == "REPO"
    assert manifest.build_id == "23363152"


def test_manifest_rejects_missing_or_unsafe_installdir() -> None:
    templates = (
        '"appid" "3241660" "buildid" "23363152"',
        '"appid" "3241660" "installdir" ".."',
        '"appid" "3241660" "installdir" "nested/REPO"',
        '"appid" "3241660" "installdir" "C:\\REPO"',
    )

    for text in templates:
        with pytest.raises(SteamAppManifestError):
            parse_steam_app_manifest(text)


def test_manifest_rejects_ascii_control_characters_in_installdir() -> None:
    for code_point in range(1, 32):
        install_dir = f"REPO{chr(code_point)}"
        with pytest.raises(SteamAppManifestError):
            parse_steam_app_manifest(f'"appid" "3241660" "installdir" "{install_dir}"')


def test_manifest_rejects_windows_reserved_device_basenames() -> None:
    reserved = (
        "CON",
        "PRN",
        "AUX",
        "NUL",
        *(f"COM{index}" for index in range(1, 10)),
        *(f"LPT{index}" for index in range(1, 10)),
    )

    for basename in reserved:
        for install_dir in (basename, f"{basename.lower()}.backup"):
            with pytest.raises(SteamAppManifestError):
                parse_steam_app_manifest(f'"appid" "3241660" "installdir" "{install_dir}"')


def test_repo_is_found_in_deduplicated_secondary_library_with_spaces(
    tmp_path: Path,
) -> None:
    steam_root = tmp_path / "Steam"
    secondary_library = tmp_path / "Secondary Library"
    steam_root.mkdir()
    secondary_library.mkdir()
    _write_library_config(
        steam_root,
        [steam_root, secondary_library, secondary_library],
    )
    game_root, manifest = _create_valid_installation(secondary_library)

    result = discover_game_installation(
        steam_roots=(steam_root,),
        environment={},
    )

    assert result.status is GameDiscoveryStatus.FOUND
    assert result.installation is not None
    assert result.installation.root == game_root
    assert result.installation.steam_library_root == secondary_library
    assert result.installation.manifest_path == manifest
    assert result.installation.steam_build_id == "23363152"
    assert result.library_roots == (steam_root, secondary_library)


def test_repo_is_found_in_primary_library_without_config(tmp_path: Path) -> None:
    steam_root = tmp_path / "Steam"
    steam_root.mkdir()
    game_root, _manifest = _create_valid_installation(steam_root)

    result = discover_game_installation(
        steam_roots=(steam_root,),
        environment={},
    )

    assert result.status is GameDiscoveryStatus.FOUND
    assert result.installation is not None
    assert result.installation.root == game_root


def test_manifest_safe_nondefault_installdir_is_authoritative(tmp_path: Path) -> None:
    steam_root = tmp_path / "Steam"
    steam_root.mkdir()
    game_root, _manifest = _create_valid_installation(
        steam_root,
        install_dir="R.E.P.O. Custom",
    )

    result = discover_game_installation(steam_roots=(steam_root,), environment={})

    assert result.status is GameDiscoveryStatus.FOUND
    assert result.installation is not None
    assert result.installation.root == game_root


def test_hardcoded_repo_directory_without_manifest_is_not_scanned(tmp_path: Path) -> None:
    steam_root = tmp_path / "Steam"
    steam_root.mkdir()
    game_root = steam_root / "steamapps/common/REPO"
    catalog = game_root / CATALOG_RELATIVE_PATH
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")

    result = discover_game_installation(steam_roots=(steam_root,), environment={})

    assert result.status is GameDiscoveryStatus.GAME_NOT_FOUND
    assert result.installation is None


def test_explicit_override_is_distinct_from_steam_provenance(tmp_path: Path) -> None:
    game_root = tmp_path / "steamapps/common/REPO"
    catalog = game_root / CATALOG_RELATIVE_PATH
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")
    _write_manifest(tmp_path)

    result = discover_game_installation(
        environment={"REPO_GAME_DIR": str(game_root)},
        steam_roots=(),
    )

    assert result.status is GameDiscoveryStatus.FOUND
    assert result.installation is not None
    assert result.installation.root == game_root.resolve()
    assert result.installation.steam_library_root is None
    assert result.installation.manifest_path is None
    assert result.installation.steam_build_id is None


def test_invalid_environment_override_falls_back_to_steam_libraries(tmp_path: Path) -> None:
    steam_root = tmp_path / "Steam Library"
    steam_root.mkdir()
    game_root, _manifest = _create_valid_installation(steam_root)

    result = discover_game_installation(
        steam_roots=(steam_root,),
        environment={"REPO_GAME_DIR": str(tmp_path / "Invalid Override")},
    )

    assert result.status is GameDiscoveryStatus.FOUND
    assert result.installation is not None
    assert result.installation.root == game_root


def test_repo_absence_is_an_intentional_result(tmp_path: Path) -> None:
    steam_root = tmp_path / "Steam"
    steam_root.mkdir()

    result = discover_game_installation(
        steam_roots=(steam_root,),
        environment={},
    )

    assert result.status is GameDiscoveryStatus.GAME_NOT_FOUND
    assert result.installation is None
    assert result.issues == ()


def test_missing_steam_is_distinct_from_missing_game() -> None:
    result = discover_game_installation(
        steam_roots=(),
        environment={},
    )

    assert result.status is GameDiscoveryStatus.STEAM_NOT_FOUND
    assert result.installation is None


def test_manifest_candidate_does_not_follow_symlink_escape(tmp_path: Path) -> None:
    steam_root = tmp_path / "Steam"
    steam_root.mkdir()
    _write_manifest(steam_root)
    outside = tmp_path / "Outside"
    catalog = outside / CATALOG_RELATIVE_PATH
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")
    common = steam_root / "steamapps/common"
    common.mkdir(parents=True)
    try:
        (common / "REPO").symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("directory symlinks are unavailable in this test environment")

    result = discover_game_installation(steam_roots=(steam_root,), environment={})

    assert result.status is GameDiscoveryStatus.DISCOVERY_ERROR
    assert result.installation is None
    assert [issue.code for issue in result.issues] == [
        GameDiscoveryIssueCode.APP_MANIFEST_MALFORMED
    ]


def test_manifest_candidate_with_missing_install_directory_is_rejected(tmp_path: Path) -> None:
    steam_root = tmp_path / "Steam"
    steam_root.mkdir()
    _write_manifest(steam_root)

    result = discover_game_installation(steam_roots=(steam_root,), environment={})

    assert result.status is GameDiscoveryStatus.GAME_NOT_FOUND
    assert result.installation is None


def test_manifest_candidate_without_addressables_catalog_is_rejected(tmp_path: Path) -> None:
    steam_root = tmp_path / "Steam"
    steam_root.mkdir()
    _write_manifest(steam_root)
    (steam_root / "steamapps/common/REPO").mkdir(parents=True)

    result = discover_game_installation(
        steam_roots=(steam_root,),
        environment={},
    )

    assert result.status is GameDiscoveryStatus.GAME_NOT_FOUND
    assert result.installation is None


def test_library_configuration_read_is_bounded(tmp_path: Path) -> None:
    steam_root = tmp_path / "Steam"
    steam_root.mkdir()
    config = steam_root / "steamapps/libraryfolders.vdf"
    config.parent.mkdir(parents=True)
    config.write_bytes(b'"path" "D:\\Steam"\n' + b" " * MAX_STEAM_LIBRARY_CONFIG_BYTES)

    result = discover_game_installation(steam_roots=(steam_root,), environment={})

    assert result.status is GameDiscoveryStatus.DISCOVERY_ERROR
    assert [issue.code for issue in result.issues] == [
        GameDiscoveryIssueCode.LIBRARY_CONFIG_MALFORMED
    ]


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


def test_unreadable_library_configuration_is_reported(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    steam_root = tmp_path / "Steam"
    steam_root.mkdir()
    config = steam_root / "steamapps/libraryfolders.vdf"
    config.parent.mkdir(parents=True)
    config.write_text('"libraryfolders" {}', encoding="utf-8")
    original_open = Path.open

    def unreadable_open(path: Path, *args: object, **kwargs: object):
        if path == config:
            raise PermissionError("denied")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", unreadable_open)

    result = discover_game_installation(
        steam_roots=(steam_root,),
        environment={},
    )

    assert result.status is GameDiscoveryStatus.DISCOVERY_ERROR
    assert [issue.code for issue in result.issues] == [
        GameDiscoveryIssueCode.LIBRARY_CONFIG_UNREADABLE
    ]


def test_malformed_or_oversized_manifest_is_bounded_and_reported(tmp_path: Path) -> None:
    for position, payload in enumerate(
        (
            b'"AppState" { "appid" "3241660" }',
            b'"appid" "3241660" "installdir" "REPO"\n' + b" " * MAX_STEAM_APP_MANIFEST_BYTES,
        )
    ):
        steam_root = tmp_path / f"Steam-{position}"
        steam_root.mkdir()
        manifest = steam_root / "steamapps" / APP_MANIFEST_NAME
        manifest.parent.mkdir(parents=True)
        manifest.write_bytes(payload)

        result = discover_game_installation(steam_roots=(steam_root,), environment={})

        assert result.status is GameDiscoveryStatus.DISCOVERY_ERROR
        assert [issue.code for issue in result.issues] == [
            GameDiscoveryIssueCode.APP_MANIFEST_MALFORMED
        ]


def test_malformed_earlier_manifest_does_not_hide_later_valid_candidate(tmp_path: Path) -> None:
    steam_root = tmp_path / "Steam"
    stale = tmp_path / "Stale"
    valid = tmp_path / "Valid"
    for root in (steam_root, stale, valid):
        root.mkdir()
    _write_library_config(steam_root, [stale, valid])
    malformed = stale / "steamapps" / APP_MANIFEST_NAME
    malformed.parent.mkdir(parents=True)
    malformed.write_text('"appid" "3241660"', encoding="utf-8")
    game_root, _manifest = _create_valid_installation(valid)

    result = discover_game_installation(steam_roots=(steam_root,), environment={})

    assert result.status is GameDiscoveryStatus.FOUND
    assert result.installation is not None
    assert result.installation.root == game_root
    assert GameDiscoveryIssueCode.APP_MANIFEST_MALFORMED in {issue.code for issue in result.issues}


def test_multiple_valid_manifest_candidates_use_deterministic_library_order(tmp_path: Path) -> None:
    steam_root = tmp_path / "Steam"
    first = tmp_path / "First"
    second = tmp_path / "Second"
    for root in (steam_root, first, second):
        root.mkdir()
    _write_library_config(steam_root, [second, first, second])
    second_game, _manifest = _create_valid_installation(second)
    _create_valid_installation(first)

    result = discover_game_installation(steam_roots=(steam_root,), environment={})

    assert result.status is GameDiscoveryStatus.FOUND
    assert result.installation is not None
    assert result.installation.root == second_game
    assert result.library_roots == (steam_root, second, first)
