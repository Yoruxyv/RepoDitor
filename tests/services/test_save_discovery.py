from __future__ import annotations

import os
from pathlib import Path

import pytest

from repo_save_editor.services.save_discovery import (
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


def test_default_save_root_uses_supplied_home() -> None:
    home = Path("C:/Users/ExampleUser")

    assert get_default_save_root(home) == (home / "AppData/LocalLow/semiwork/Repo/saves")


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


def test_saves_are_sorted_newest_first(tmp_path: Path) -> None:
    root = tmp_path / "saves"
    older = _create_save(root, "REPO_SAVE_2026_08_08_10_20_30")
    newer = _create_save(root, "REPO_SAVE_2026_08_08_11_20_30")
    os.utime(older, (1000, 1000))
    os.utime(newer, (2000, 2000))

    result = discover_saves(root)

    assert [save.path for save in result.saves] == [newer, older]
