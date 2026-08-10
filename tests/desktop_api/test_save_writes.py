from copy import deepcopy
from pathlib import Path

from repo_save_editor.desktop_api.saves import open_save, save_changes
from repo_save_editor.services.run import set_run_stat
from repo_save_editor.storage import repository as repository_module
from repo_save_editor.storage.repository import SaveBackupError, SaveRepository


def _save_path(root: Path) -> Path:
    save_id = "REPO_SAVE_2026_08_08_10_20_30"
    return root / save_id / f"{save_id}.es3"


def _write_fixture(root: Path, data) -> Path:
    path = _save_path(root)
    SaveRepository(root).save_as(path, data)
    return path


def _fingerprint(root: Path) -> str:
    result = open_save(_save_path(root).parent.name, root)
    assert result["ok"] is True
    return result["session"]["fingerprint"]


def test_save_changes_writes_multiple_domains_with_exact_backup(tmp_path: Path, sample_save):
    sample_save["futureField"] = {"value": "preserve me"}
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries["item"] = {
        "Item Gun Tranq/1": 15,
        "Item Melee Inflatable Hammer/2": 21,
    }
    dictionaries["itemStatBattery"] = {
        "Item Gun Tranq/1": 0,
        "Item Melee Inflatable Hammer/2": 20,
    }
    dictionaries["itemBatteryUpgrades"] = {}
    dictionaries["itemsPurchased"] = {"Item Gun Tranq": 1}
    dictionaries["itemsPurchasedTotal"] = {"Item Gun Tranq": 1}
    path = _write_fixture(tmp_path, sample_save)
    original = path.read_bytes()

    result = save_changes(
        path.parent.name,
        _fingerprint(tmp_path),
        [
            {"feature": "players", "entity": "222", "field": "health", "after": 100},
            {
                "feature": "upgrades",
                "entity": "222",
                "field": "playerUpgradeStrength",
                "after": 3,
            },
            {"feature": "run", "entity": "run", "field": "currency", "after": 20},
            {
                "feature": "run",
                "entity": "run",
                "field": "resumeLocation",
                "after": "Shop / Service Station",
            },
            {
                "feature": "advanced",
                "entity": "Item Gun Tranq/1",
                "field": "refillToFull",
                "after": True,
            },
        ],
        tmp_path,
    )

    assert result["ok"] is True
    backup = Path(result["result"]["backupPath"])
    assert backup.read_bytes() == original
    reopened = SaveRepository.load(path)
    dictionaries = reopened["dictionaryOfDictionaries"]["value"]
    assert dictionaries["playerHealth"]["222"] == 100
    assert dictionaries["playerUpgradeStrength"]["222"] == 3
    assert dictionaries["runStats"]["currency"] == 20
    assert dictionaries["runStats"]["save level"] == 1
    assert dictionaries["item"] == {
        "Item Gun Tranq/1": 15,
        "Item Melee Inflatable Hammer/2": 21,
    }
    assert dictionaries["itemStatBattery"] == {"Item Melee Inflatable Hammer/2": 20}
    assert dictionaries["itemBatteryUpgrades"] == {}
    assert dictionaries["itemsPurchased"] == {"Item Gun Tranq": 1}
    assert dictionaries["itemsPurchasedTotal"] == {"Item Gun Tranq": 1}
    assert reopened["futureField"] == {"value": "preserve me"}
    assert result["result"]["session"]["fingerprint"] != _fingerprint_from_bytes(original)


def _fingerprint_from_bytes(source: bytes) -> str:
    from hashlib import sha256

    return sha256(source).hexdigest()


def test_validation_failure_does_not_create_backup_or_modify_source(tmp_path: Path, sample_save):
    path = _write_fixture(tmp_path, sample_save)
    original = path.read_bytes()

    result = save_changes(
        path.parent.name,
        _fingerprint(tmp_path),
        [{"feature": "players", "entity": "missing", "field": "health", "after": 20}],
        tmp_path,
    )

    assert result["error"]["code"] == "save_validation_failed"
    assert path.read_bytes() == original
    assert not list(path.parent.glob("*.bak-*"))


def test_invalid_refill_does_not_create_backup_or_modify_source(tmp_path: Path, sample_save):
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries["item"] = {"Item Gun Tranq/1": 15}
    dictionaries["itemStatBattery"] = {"Item Gun Tranq/1": 0}
    path = _write_fixture(tmp_path, sample_save)
    original = path.read_bytes()

    result = save_changes(
        path.parent.name,
        _fingerprint(tmp_path),
        [
            {
                "feature": "advanced",
                "entity": "Item Gun Tranq/2",
                "field": "refillToFull",
                "after": True,
            }
        ],
        tmp_path,
    )

    assert result["error"]["code"] == "save_validation_failed"
    assert path.read_bytes() == original
    assert not list(path.parent.glob("*.bak-*"))


def test_backup_failure_blocks_replacement(tmp_path: Path, sample_save, monkeypatch):
    path = _write_fixture(tmp_path, sample_save)
    original = path.read_bytes()

    def fail_backup(_path: Path, _source: bytes):
        raise SaveBackupError("simulated backup failure")

    monkeypatch.setattr(SaveRepository, "_create_backup", staticmethod(fail_backup))
    result = save_changes(
        path.parent.name,
        _fingerprint(tmp_path),
        [{"feature": "run", "entity": "run", "field": "currency", "after": 20}],
        tmp_path,
    )

    assert result["error"]["code"] == "backup_failed"
    assert path.read_bytes() == original


def test_staging_failure_leaves_original_and_backup_recoverable(
    tmp_path: Path,
    sample_save,
    monkeypatch,
):
    path = _write_fixture(tmp_path, sample_save)
    original = path.read_bytes()

    def fail_write(_path: Path, _blob: bytes):
        raise OSError("simulated disk failure")

    monkeypatch.setattr(SaveRepository, "_write_temp", staticmethod(fail_write))
    result = save_changes(
        path.parent.name,
        _fingerprint(tmp_path),
        [{"feature": "run", "entity": "run", "field": "currency", "after": 20}],
        tmp_path,
    )

    assert result["error"]["code"] == "save_write_failed"
    assert path.read_bytes() == original
    assert next(path.parent.glob("*.bak-*")).read_bytes() == original


def test_replacement_failure_leaves_original_and_backup_recoverable(
    tmp_path: Path,
    sample_save,
    monkeypatch,
):
    path = _write_fixture(tmp_path, sample_save)
    original = path.read_bytes()

    def fail_replace(_source: Path, _destination: Path):
        raise OSError("simulated replacement failure")

    monkeypatch.setattr(repository_module.os, "replace", fail_replace)
    result = save_changes(
        path.parent.name,
        _fingerprint(tmp_path),
        [{"feature": "run", "entity": "run", "field": "currency", "after": 20}],
        tmp_path,
    )

    assert result["error"]["code"] == "save_write_failed"
    assert path.read_bytes() == original
    assert next(path.parent.glob("*.bak-*")).read_bytes() == original


def test_verification_failure_leaves_original_and_backup_recoverable(
    tmp_path: Path,
    sample_save,
    monkeypatch,
):
    path = _write_fixture(tmp_path, sample_save)
    original = path.read_bytes()

    def fail_verification(_path: Path):
        raise ValueError("simulated verification failure")

    monkeypatch.setattr(SaveRepository, "load", staticmethod(fail_verification))
    result = save_changes(
        path.parent.name,
        _fingerprint(tmp_path),
        [{"feature": "run", "entity": "run", "field": "currency", "after": 20}],
        tmp_path,
    )

    assert result["error"]["code"] == "save_verification_failed"
    assert path.read_bytes() == original
    assert next(path.parent.glob("*.bak-*")).read_bytes() == original


def test_stale_source_is_never_overwritten(tmp_path: Path, sample_save):
    path = _write_fixture(tmp_path, sample_save)
    opened_fingerprint = _fingerprint(tmp_path)
    external = deepcopy(sample_save)
    set_run_stat(external, "currency", 777)
    SaveRepository(tmp_path).save_as(path, external)
    external_bytes = path.read_bytes()

    result = save_changes(
        path.parent.name,
        opened_fingerprint,
        [{"feature": "run", "entity": "run", "field": "currency", "after": 20}],
        tmp_path,
    )

    assert result["error"]["code"] == "save_stale"
    assert path.read_bytes() == external_bytes
    assert not list(path.parent.glob("*.bak-*"))
