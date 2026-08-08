from copy import deepcopy
from pathlib import Path

import pytest

from repo_save_editor.services.run_state import set_run_stat
from repo_save_editor.storage.repository import (
    SaveRepository,
    SaveStaleError,
    SaveVerificationError,
)


def test_repository_save_as_and_load(tmp_path: Path, sample_save):
    repository = SaveRepository(tmp_path)
    path = tmp_path / "REPO_SAVE_TEST.es3"

    repository.save_as(path, sample_save)

    assert repository.load(path) == sample_save


def test_repository_overwrite_creates_readable_backup(tmp_path: Path, sample_save):
    repository = SaveRepository(tmp_path)
    path = tmp_path / "REPO_SAVE_TEST.es3"
    repository.save_as(path, sample_save)

    edited = repository.load(path)
    set_run_stat(edited, "currency", 100000)
    backup, _ = repository.overwrite(path, edited)

    assert backup.exists()
    assert (
        repository.load(backup)["dictionaryOfDictionaries"]["value"]["runStats"]["currency"] == 12
    )
    assert (
        repository.load(path)["dictionaryOfDictionaries"]["value"]["runStats"]["currency"] == 100000
    )


def test_repository_overwrite_never_reuses_a_backup_name(tmp_path: Path, sample_save):
    repository = SaveRepository(tmp_path)
    path = tmp_path / "REPO_SAVE_TEST.es3"
    repository.save_as(path, sample_save)
    original = path.read_bytes()

    first_edit = deepcopy(sample_save)
    set_run_stat(first_edit, "currency", 20)
    first, _ = repository.overwrite(path, first_edit)
    first_source = path.read_bytes()

    second_edit = deepcopy(first_edit)
    set_run_stat(second_edit, "currency", 30)
    second, _ = repository.overwrite(path, second_edit)

    assert first != second
    assert first.read_bytes() == original
    assert second.read_bytes() == first_source


def test_repository_detects_changes_before_replacement(tmp_path: Path, sample_save, monkeypatch):
    repository = SaveRepository(tmp_path)
    path = tmp_path / "REPO_SAVE_TEST.es3"
    repository.save_as(path, sample_save)
    opened = path.read_bytes()
    edited = deepcopy(sample_save)
    set_run_stat(edited, "currency", 20)

    original_load = SaveRepository.load

    def change_source_after_verification(temp_path: Path):
        verified = original_load(temp_path)
        path.write_bytes(b"externally changed")
        return verified

    monkeypatch.setattr(SaveRepository, "load", staticmethod(change_source_after_verification))

    with pytest.raises(SaveStaleError):
        repository.overwrite(path, edited, expected_source=opened)

    assert path.read_bytes() == b"externally changed"


def test_repository_verification_failure_preserves_source(tmp_path: Path, sample_save, monkeypatch):
    repository = SaveRepository(tmp_path)
    path = tmp_path / "REPO_SAVE_TEST.es3"
    repository.save_as(path, sample_save)
    original = path.read_bytes()

    def fail_verification(_path: Path):
        raise ValueError("simulated verification failure")

    monkeypatch.setattr(SaveRepository, "load", staticmethod(fail_verification))

    with pytest.raises(SaveVerificationError):
        repository.overwrite(path, sample_save, expected_source=original)

    assert path.read_bytes() == original
    assert list(tmp_path.glob("*.bak-*"))
