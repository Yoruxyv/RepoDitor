from pathlib import Path

from repo_save_editor.services.run_state import set_run_stat
from repo_save_editor.storage.repository import SaveRepository


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
    backup = repository.overwrite(path, edited)

    assert backup.exists()
    assert (
        repository.load(backup)["dictionaryOfDictionaries"]["value"]["runStats"]["currency"] == 12
    )
    assert (
        repository.load(path)["dictionaryOfDictionaries"]["value"]["runStats"]["currency"] == 100000
    )
