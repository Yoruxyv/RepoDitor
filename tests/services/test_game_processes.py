from __future__ import annotations

from pathlib import Path

from repo_save_editor.services.game.discovery import (
    CATALOG_RELATIVE_PATH,
    GameDiscoveryResult,
    GameDiscoveryStatus,
    GameInstallation,
)
from repo_save_editor.services.game.processes import (
    GameProcessStatus,
    ProcessInspection,
    ProcessInspectionError,
    classify_game_process,
    get_game_process_status,
    is_expected_process_name,
)


def _discovery(root: Path) -> GameDiscoveryResult:
    return GameDiscoveryResult(
        GameDiscoveryStatus.FOUND,
        GameInstallation(root, root / CATALOG_RELATIVE_PATH, root.parent),
    )


def test_validated_installation_path_is_used_for_process_identity() -> None:
    root = Path(r"Z:\fixture\Secondary Library\steamapps\common\REPO")
    inspected: list[Path] = []

    status = get_game_process_status(
        discover=lambda _game_dir: _discovery(root),
        inspect=lambda expected: (
            inspected.append(expected)
            or ProcessInspection((root / "REPO.exe",))
        ),
    )

    assert status is GameProcessStatus.RUNNING
    assert inspected == [root / "REPO.exe"]


def test_different_repo_executable_path_is_not_the_validated_game() -> None:
    expected = Path(r"D:\fixture\SteamLibrary\steamapps\common\REPO\REPO.exe")
    other = Path(r"C:\unrelated\REPO.exe")

    assert classify_game_process(expected, ProcessInspection((other,))) is GameProcessStatus.NOT_RUNNING


def test_windows_process_path_matching_is_case_insensitive() -> None:
    expected = Path(r"E:\Fixture\SteamLibrary\steamapps\common\REPO\REPO.exe")
    observed = Path(r"e:\fixture\steamlibrary\STEAMAPPS\COMMON\repo\repo.EXE")

    assert classify_game_process(expected, ProcessInspection((observed,))) is GameProcessStatus.RUNNING


def test_unverifiable_repo_candidate_fails_closed() -> None:
    expected = Path(r"D:\fixture\REPO\REPO.exe")

    assert (
        classify_game_process(expected, ProcessInspection((), has_unverifiable_candidate=True))
        is GameProcessStatus.UNKNOWN
    )


def test_process_inspection_failure_is_unknown() -> None:
    root = Path(r"D:\fixture\REPO")

    def fail(_expected: Path) -> ProcessInspection:
        raise ProcessInspectionError("simulated failure")

    assert (
        get_game_process_status(discover=lambda _game_dir: _discovery(root), inspect=fail)
        is GameProcessStatus.UNKNOWN
    )


def test_missing_validated_installation_is_unknown_without_process_scan() -> None:
    inspected = False

    def inspect(_expected: Path) -> ProcessInspection:
        nonlocal inspected
        inspected = True
        return ProcessInspection(())

    status = get_game_process_status(
        discover=lambda _game_dir: GameDiscoveryResult(GameDiscoveryStatus.GAME_NOT_FOUND, None),
        inspect=inspect,
    )

    assert status is GameProcessStatus.UNKNOWN
    assert inspected is False


def test_crash_handler_is_not_repo_process_identity() -> None:
    expected = Path(r"Q:\fixture\REPO\REPO.exe")

    assert is_expected_process_name("REPO.exe", expected) is True
    assert is_expected_process_name("repo.EXE", expected) is True
    assert is_expected_process_name("UnityCrashHandler64.exe", expected) is False
