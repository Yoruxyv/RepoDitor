from copy import deepcopy
from pathlib import Path
from unittest.mock import Mock

from repo_save_editor.desktop_api.saves import open_save, save_changes
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.services.items.models import ItemRechargeCapability
from repo_save_editor.services.run import set_run_stat
from repo_save_editor.storage import repository as repository_module
from repo_save_editor.storage.repository import SaveBackupError, SaveRepository


def _game_closed() -> GameProcessStatus:
    return GameProcessStatus.NOT_RUNNING


def _rechargeable(names: tuple[str, ...]) -> dict[str, ItemRechargeCapability]:
    return dict.fromkeys(names, ItemRechargeCapability.RECHARGEABLE)


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
        game_status_loader=_game_closed,
        recharge_capability_loader=_rechargeable,
    )

    assert result["ok"] is True
    canonical = result["result"]["canonical"]
    assert canonical["fingerprint"] == result["result"]["session"]["fingerprint"]
    assert canonical["players"] == [{"id": "222", "health": 100}]
    assert canonical["upgrades"] == [
        {"playerId": "222", "key": "playerUpgradeStrength", "value": 3}
    ]
    assert canonical["run"] == {
        "stats": [{"key": "currency", "value": 20}],
        "resumeLocation": "Shop / Service Station",
    }
    assert canonical["advanced"] == {
        "items": [
            {
                "saveKey": "Item Gun Tranq/1",
                "storedCharge": None,
                "chargeState": "default_full",
                "rechargeCapability": "rechargeable",
                "canRefillToFull": False,
            }
        ],
        "currentChargeEntryCount": 1,
    }
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


def test_save_changes_returns_canonical_state_only_for_affected_domains(
    tmp_path: Path, sample_save
) -> None:
    path = _write_fixture(tmp_path, sample_save)

    result = save_changes(
        path.parent.name,
        _fingerprint(tmp_path),
        [{"feature": "run", "entity": "run", "field": "currency", "after": 41}],
        tmp_path,
        game_status_loader=_game_closed,
    )

    assert result["ok"] is True
    canonical = result["result"]["canonical"]
    assert set(canonical) == {"fingerprint", "run"}
    assert canonical["run"] == {"stats": [{"key": "currency", "value": 41}]}


def test_validation_failure_does_not_create_backup_or_modify_source(tmp_path: Path, sample_save):
    path = _write_fixture(tmp_path, sample_save)
    original = path.read_bytes()

    result = save_changes(
        path.parent.name,
        _fingerprint(tmp_path),
        [{"feature": "players", "entity": "missing", "field": "health", "after": 20}],
        tmp_path,
        game_status_loader=_game_closed,
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
        game_status_loader=_game_closed,
        recharge_capability_loader=_rechargeable,
    )

    assert result["error"]["code"] == "save_validation_failed"
    assert path.read_bytes() == original
    assert not list(path.parent.glob("*.bak-*"))


def test_unverified_refill_capability_blocks_write_before_backup(
    tmp_path: Path, sample_save
) -> None:
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries["item"] = {"Item Gun Tranq/1": 15}
    dictionaries["itemStatBattery"] = {"Item Gun Tranq/1": 5}
    path = _write_fixture(tmp_path, sample_save)
    original = path.read_bytes()

    result = save_changes(
        path.parent.name,
        _fingerprint(tmp_path),
        [
            {
                "feature": "advanced",
                "entity": "Item Gun Tranq/1",
                "field": "refillToFull",
                "after": True,
            }
        ],
        tmp_path,
        game_status_loader=_game_closed,
        recharge_capability_loader=lambda names: dict.fromkeys(
            names, ItemRechargeCapability.UNKNOWN
        ),
    )

    assert result["error"]["code"] == "save_validation_failed"
    assert path.read_bytes() == original
    assert not list(path.parent.glob("*.bak-*"))


def _prepare_recharge_fixture(tmp_path: Path, sample_save) -> tuple[Path, bytes]:
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries["item"] = {"Item Gun Tranq/1": 15}
    dictionaries["itemStatBattery"] = {"Item Gun Tranq/1": 5}
    path = _write_fixture(tmp_path, sample_save)
    return path, path.read_bytes()


def _recharge_change() -> list[dict[str, object]]:
    return [
        {
            "feature": "advanced",
            "entity": "Item Gun Tranq/1",
            "field": "refillToFull",
            "after": True,
        }
    ]


def test_valid_recharge_evidence_skips_full_capability_discovery_and_preserves_backup(
    tmp_path: Path, sample_save
) -> None:
    path, original = _prepare_recharge_fixture(tmp_path, sample_save)
    full_discovery = Mock(side_effect=AssertionError("full discovery should be skipped"))
    verifier = Mock(return_value={"Item Gun Tranq": ItemRechargeCapability.RECHARGEABLE})

    result = save_changes(
        path.parent.name,
        _fingerprint(tmp_path),
        _recharge_change(),
        tmp_path,
        game_status_loader=_game_closed,
        recharge_capability_loader=full_discovery,
        recharge_evidence={"version": 1},
        recharge_evidence_verifier=verifier,
    )

    assert result["ok"] is True
    verifier.assert_called_once_with({"version": 1}, ("Item Gun Tranq",))
    full_discovery.assert_not_called()
    assert Path(result["result"]["backupPath"]).read_bytes() == original


def test_missing_recharge_evidence_falls_back_to_full_discovery(
    tmp_path: Path, sample_save
) -> None:
    path, _original = _prepare_recharge_fixture(tmp_path, sample_save)
    full_discovery = Mock(return_value={"Item Gun Tranq": ItemRechargeCapability.RECHARGEABLE})
    verifier = Mock(side_effect=AssertionError("missing evidence must not invoke verifier"))

    result = save_changes(
        path.parent.name,
        _fingerprint(tmp_path),
        _recharge_change(),
        tmp_path,
        game_status_loader=_game_closed,
        recharge_capability_loader=full_discovery,
        recharge_evidence_verifier=verifier,
    )

    assert result["ok"] is True
    verifier.assert_not_called()
    full_discovery.assert_called_once_with(("Item Gun Tranq",))


def test_missing_or_invalid_recharge_evidence_falls_back_to_full_discovery(
    tmp_path: Path, sample_save
) -> None:
    path, _original = _prepare_recharge_fixture(tmp_path, sample_save)
    full_discovery = Mock(return_value={"Item Gun Tranq": ItemRechargeCapability.RECHARGEABLE})
    verifier = Mock(return_value=None)

    result = save_changes(
        path.parent.name,
        _fingerprint(tmp_path),
        _recharge_change(),
        tmp_path,
        game_status_loader=_game_closed,
        recharge_capability_loader=full_discovery,
        recharge_evidence={"malformed": True},
        recharge_evidence_verifier=verifier,
    )

    assert result["ok"] is True
    verifier.assert_called_once()
    full_discovery.assert_called_once_with(("Item Gun Tranq",))


def test_unknown_or_not_rechargeable_evidence_never_authorizes_refill(
    tmp_path: Path, sample_save
) -> None:
    for capability in (
        ItemRechargeCapability.UNKNOWN,
        ItemRechargeCapability.NOT_RECHARGEABLE,
    ):
        case = deepcopy(sample_save)
        path, original = _prepare_recharge_fixture(tmp_path, case)
        full_discovery = Mock(side_effect=AssertionError("verified evidence must not rescan"))

        result = save_changes(
            path.parent.name,
            _fingerprint(tmp_path),
            _recharge_change(),
            tmp_path,
            game_status_loader=_game_closed,
            recharge_capability_loader=full_discovery,
            recharge_evidence={"version": 1},
            recharge_evidence_verifier=lambda _value, _names, capability=capability: {
                "Item Gun Tranq": capability
            },
        )

        assert result["error"]["code"] == "save_validation_failed"
        assert path.read_bytes() == original
        assert not list(path.parent.glob("*.bak-*"))
        full_discovery.assert_not_called()


def test_non_recharge_save_avoids_recharge_evidence_machinery(tmp_path: Path, sample_save) -> None:
    path = _write_fixture(tmp_path, sample_save)
    verifier = Mock(side_effect=AssertionError("non-Recharge save must not verify evidence"))
    full_discovery = Mock(
        side_effect=AssertionError("non-Recharge save must not discover evidence")
    )

    result = save_changes(
        path.parent.name,
        _fingerprint(tmp_path),
        [{"feature": "run", "entity": "run", "field": "currency", "after": 41}],
        tmp_path,
        game_status_loader=_game_closed,
        recharge_capability_loader=full_discovery,
        recharge_evidence={"version": 1},
        recharge_evidence_verifier=verifier,
    )

    assert result["ok"] is True
    verifier.assert_not_called()
    full_discovery.assert_not_called()


def test_stale_recharge_save_is_rejected_before_cached_evidence_is_considered(
    tmp_path: Path, sample_save
) -> None:
    path, _original = _prepare_recharge_fixture(tmp_path, sample_save)
    opened_fingerprint = _fingerprint(tmp_path)
    external = deepcopy(sample_save)
    external["dictionaryOfDictionaries"]["value"]["runStats"]["currency"] = 777
    SaveRepository(tmp_path).save_as(path, external)
    external_bytes = path.read_bytes()
    verifier = Mock(
        side_effect=AssertionError("stale saves must fail before evidence verification")
    )

    result = save_changes(
        path.parent.name,
        opened_fingerprint,
        _recharge_change(),
        tmp_path,
        game_status_loader=_game_closed,
        recharge_evidence={"version": 1},
        recharge_evidence_verifier=verifier,
    )

    assert result["error"]["code"] == "save_stale"
    assert path.read_bytes() == external_bytes
    assert not list(path.parent.glob("*.bak-*"))
    verifier.assert_not_called()


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
        game_status_loader=_game_closed,
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
        game_status_loader=_game_closed,
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
        game_status_loader=_game_closed,
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
        game_status_loader=_game_closed,
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
        game_status_loader=_game_closed,
    )

    assert result["error"]["code"] == "save_stale"
    assert path.read_bytes() == external_bytes
    assert not list(path.parent.glob("*.bak-*"))


def test_game_running_blocks_run_write_before_backup_or_source_change(tmp_path: Path, sample_save):
    path = _write_fixture(tmp_path, sample_save)
    original = path.read_bytes()

    result = save_changes(
        path.parent.name,
        _fingerprint(tmp_path),
        [{"feature": "run", "entity": "run", "field": "currency", "after": 20}],
        tmp_path,
        game_status_loader=lambda: GameProcessStatus.RUNNING,
    )

    assert result["error"]["code"] == "game_running"
    assert path.read_bytes() == original
    assert not list(path.parent.glob("*.bak-*"))


def test_unknown_game_status_blocks_run_write_before_backup(tmp_path: Path, sample_save):
    path = _write_fixture(tmp_path, sample_save)
    original = path.read_bytes()

    result = save_changes(
        path.parent.name,
        _fingerprint(tmp_path),
        [{"feature": "run", "entity": "run", "field": "currency", "after": 20}],
        tmp_path,
        game_status_loader=lambda: GameProcessStatus.UNKNOWN,
    )

    assert result["error"]["code"] == "game_status_unknown"
    assert path.read_bytes() == original
    assert not list(path.parent.glob("*.bak-*"))
