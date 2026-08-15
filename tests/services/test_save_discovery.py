from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest

from repo_save_editor.services.game.local_data import get_repo_local_data_roots
from repo_save_editor.services.saves.discovery import (
    SaveRootStatus,
    discover_saves,
    get_default_save_root,
)


def _create_save(root: Path, slot_name: str, content: bytes = b"save") -> Path:
    slot = root / slot_name
    slot.mkdir(parents=True)
    save_path = slot / f"{slot_name}.es3"
    save_path.write_bytes(content)
    return save_path


def test_default_save_root_uses_authoritative_local_data_root() -> None:
    local_low = Path("D:/Profiles/Example/LocalLow")
    roots = get_repo_local_data_roots(lambda: local_low)
    assert roots is not None

    assert get_default_save_root(lambda: roots) == local_low / "semiwork/Repo/saves"


def test_unavailable_known_folder_does_not_guess_home_or_scan_drives() -> None:
    result = discover_saves(roots_loader=lambda: None)

    assert result.status is SaveRootStatus.UNAVAILABLE
    assert result.root is None
    assert result.root_detected is False
    assert result.saves == ()


def test_missing_save_root_is_an_intentional_result(tmp_path: Path) -> None:
    result = discover_saves(tmp_path / "missing")

    assert result.status is SaveRootStatus.MISSING
    assert result.root_detected is False
    assert result.saves == ()


def test_empty_existing_save_root_is_available(tmp_path: Path) -> None:
    root = tmp_path / "saves"
    root.mkdir()

    result = discover_saves(root)

    assert result.status is SaveRootStatus.AVAILABLE
    assert result.root_detected is True
    assert result.saves == ()


def test_unreadable_save_root_is_an_intentional_result(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "saves"
    root.mkdir()
    original_iterdir = Path.iterdir

    def unreadable_iterdir(path: Path) -> Iterator[Path]:
        if path == root:
            raise PermissionError("denied")
        return original_iterdir(path)

    monkeypatch.setattr(Path, "iterdir", unreadable_iterdir)

    result = discover_saves(root)

    assert result.status is SaveRootStatus.UNREADABLE
    assert result.root_detected is False
    assert result.saves == ()


def test_valid_save_slot_exposes_path_size_and_display_metadata(tmp_path: Path) -> None:
    root = tmp_path / "saves"
    save_path = _create_save(root, "REPO_SAVE_2026_08_08_10_20_30", b"123456")

    result = discover_saves(root)

    assert len(result.saves) == 1
    save = result.saves[0]
    assert save.identifier == "REPO_SAVE_2026_08_08_10_20_30"
    assert save.display_name == "2026-08-08 10:20:30"
    assert save.path == save_path
    assert save.file_size == 6
    assert save.modified_at.timestamp() == pytest.approx(save_path.stat().st_mtime)


def test_empty_save_file_is_still_discovered(tmp_path: Path) -> None:
    root = tmp_path / "saves"
    _create_save(root, "REPO_SAVE_2026_08_08_10_20_30", b"")

    result = discover_saves(root)

    assert len(result.saves) == 1
    assert result.saves[0].file_size == 0


def test_unrelated_directories_and_files_are_ignored(tmp_path: Path) -> None:
    root = tmp_path / "saves"
    root.mkdir()
    (root / "screenshots").mkdir()
    (root / "notes.txt").write_text("not a save", encoding="utf-8")
    _create_save(root, "REPO_SAVE_2026_08_08_10_20_30")

    result = discover_saves(root)

    assert [save.identifier for save in result.saves] == ["REPO_SAVE_2026_08_08_10_20_30"]


def test_matching_slot_without_expected_save_file_is_ignored(tmp_path: Path) -> None:
    root = tmp_path / "saves"
    incomplete = root / "REPO_SAVE_2026_08_08_10_20_30"
    incomplete.mkdir(parents=True)
    (incomplete / "different.es3").write_bytes(b"save")

    assert discover_saves(root).saves == ()


def test_matching_slot_with_invalid_timestamp_is_ignored(tmp_path: Path) -> None:
    root = tmp_path / "saves"
    _create_save(root, "REPO_SAVE_2026_13_08_10_20_30")

    assert discover_saves(root).saves == ()


def test_unreadable_save_file_skips_only_its_slot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "saves"
    unreadable = _create_save(root, "REPO_SAVE_2026_08_08_10_20_30")
    readable = _create_save(root, "REPO_SAVE_2026_08_08_11_20_30")
    original_is_file = Path.is_file

    def unreadable_is_file(path: Path) -> bool:
        if path == unreadable:
            raise PermissionError("denied")
        return original_is_file(path)

    monkeypatch.setattr(Path, "is_file", unreadable_is_file)

    result = discover_saves(root)

    assert [save.path for save in result.saves] == [readable]
    assert result.skipped_entries == (unreadable.parent,)


def test_inaccessible_directory_entry_does_not_destroy_other_results(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "saves"
    inaccessible = _create_save(root, "REPO_SAVE_2026_08_08_10_20_30").parent
    readable = _create_save(root, "REPO_SAVE_2026_08_08_11_20_30")
    original_is_dir = Path.is_dir

    def inaccessible_is_dir(path: Path) -> bool:
        if path == inaccessible:
            raise PermissionError("denied")
        return original_is_dir(path)

    monkeypatch.setattr(Path, "is_dir", inaccessible_is_dir)

    result = discover_saves(root)

    assert [save.path for save in result.saves] == [readable]
    assert result.skipped_entries == (inaccessible,)


def test_saves_are_sorted_newest_first(tmp_path: Path) -> None:
    root = tmp_path / "saves"
    older = _create_save(root, "REPO_SAVE_2026_08_08_10_20_30")
    newer = _create_save(root, "REPO_SAVE_2026_08_08_11_20_30")
    os.utime(older, (1000, 1000))
    os.utime(newer, (2000, 2000))

    result = discover_saves(root)

    assert [save.path for save in result.saves] == [newer, older]


def test_sorting_is_deterministic_when_modified_times_match(tmp_path: Path) -> None:
    root = tmp_path / "saves"
    first = _create_save(root, "REPO_SAVE_2026_08_08_10_20_30")
    second = _create_save(root, "REPO_SAVE_2026_08_08_11_20_30")
    os.utime(first, (1000, 1000))
    os.utime(second, (1000, 1000))

    result = discover_saves(root)

    assert [save.path for save in result.saves] == [second, first]
