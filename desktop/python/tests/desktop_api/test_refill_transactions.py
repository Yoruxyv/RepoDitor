"""Exact-instance refill intents reuse the durable save boundary without numeric guesses."""

import json
from copy import deepcopy
from functools import partial
from hashlib import sha256

import pytest

from repo_save_editor.desktop_api import health_recovery as api
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.services.items.models import ItemRechargeCapability as Capability
from repo_save_editor.storage import health_recovery as storage
from repo_save_editor.storage.repository import SaveRepository

SAVE = "REPO_SAVE_2026_08_08_10_20_30"
OP = "a" * 32
KEY = "Item Melee Inflatable Hammer/1"
OTHER = "Item Melee Inflatable Hammer/2"
FULL = "Item Melee Inflatable Hammer/3"
UNKNOWN = "Item Unknown/1"
INELIGIBLE = "Item Cart Medium/1"


def capabilities(names):
    return {
        name: Capability.RECHARGEABLE
        if name == "Item Melee Inflatable Hammer"
        else Capability.NOT_RECHARGEABLE
        if name == "Item Cart Medium"
        else Capability.UNKNOWN
        for name in names
    }


@pytest.fixture
def fixture(tmp_path, sample_save, monkeypatch):
    data = deepcopy(sample_save)
    dictionaries = data["dictionaryOfDictionaries"]["value"]
    dictionaries["item"] = {KEY: 21, OTHER: 21, FULL: 21, UNKNOWN: 1, INELIGIBLE: 2}
    dictionaries["itemStatBattery"] = {KEY: 99, OTHER: -2, UNKNOWN: 8, INELIGIBLE: 13, "orphan": 44}
    dictionaries["itemBatteryUpgrades"] = {KEY: 123}
    root = tmp_path / "semiwork/Repo/saves"
    path = root / SAVE / f"{SAVE}.es3"
    SaveRepository(root).save_as(path, data)
    monkeypatch.setattr(storage, "_owner_exited", lambda *_args: True)
    monkeypatch.setattr(
        api,
        "serialize_advanced_save",
        partial(api.serialize_advanced_save, capability_loader=capabilities),
    )
    return root, path, path.read_bytes(), data


def edits():
    return [{"saveKey": KEY, "before": 99}, {"saveKey": OTHER, "before": -2}]


def invoke(handler, fixture, changes=None, **kwargs):
    root, _path, before, _data = fixture
    return handler(
        SAVE,
        sha256(before).hexdigest(),
        edits() if changes is None else changes,
        OP,
        root,
        refill_batch=True,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
        recharge_capability_loader=capabilities,
        **kwargs,
    )["transaction"]


@pytest.mark.parametrize("count", [1, 2])
def test_refill_removes_only_exact_leaves_in_one_transaction(fixture, count):
    root, path, before, original = fixture
    changes = edits()[:count]
    assert invoke(api.prepare_health, fixture, changes)["status"] == "prepared"
    tx = storage.HealthTransaction(path, OP)
    assert json.loads(tx.pending.read_bytes())["version"] == 7
    assert invoke(api.write_health, fixture, changes, reserved=True)["status"] == "applied"
    expected = deepcopy(original)
    for edit in changes:
        del expected["dictionaryOfDictionaries"]["value"]["itemStatBattery"][edit["saveKey"]]
    assert SaveRepository.load(path) == expected
    assert tx.backup.read_bytes() == before
    assert list(path.parent.glob("*.bak-*")) == [tx.backup]
    pending = tx.pending.read_bytes()
    assert api.health_state(SAVE, root)["pending"]["intent"] == {"refillToFull": changes}
    result = api.recover_health(SAVE, OP, root, canonical=True, acknowledge=False)["transaction"]
    assert result["status"] == "applied"
    assert result["backupAvailable"] is True
    canonical = {item["saveKey"]: item for item in result["canonical"]["advanced"]["items"]}
    for edit in changes:
        assert canonical[edit["saveKey"]]["storedCharge"] is None
        assert canonical[edit["saveKey"]]["chargeState"] == "default_full"
        assert canonical[edit["saveKey"]]["canRefillToFull"] is False
    assert tx.pending.read_bytes() == pending
    written = path.read_bytes()
    assert api.recover_health(SAVE, OP, root, canonical=True)["transaction"] == result
    assert not tx.pending.exists()
    assert tx.archive.exists()
    assert path.read_bytes() == written
    assert invoke(api.prepare_health, fixture, changes)["reason"] == "write_duplicate"


@pytest.mark.parametrize(
    ("edit", "reason"),
    [
        ({"saveKey": UNKNOWN, "before": 8}, "save_validation_failed"),
        ({"saveKey": INELIGIBLE, "before": 13}, "save_validation_failed"),
        ({"saveKey": FULL, "before": 0}, "save_validation_failed"),
        ({"saveKey": "Item Missing/1", "before": 0}, "save_validation_failed"),
        ({"saveKey": KEY, "before": 1}, "save_stale"),
        ({"saveKey": KEY, "before": True}, "invalid_request"),
        ({"saveKey": KEY, "before": 1.5}, "invalid_request"),
        ({"saveKey": KEY, "before": 9_007_199_254_740_992}, "invalid_request"),
        ({"saveKey": KEY, "before": 99, "value": 100}, "invalid_request"),
        ({"saveKey": "../file", "before": 99}, "invalid_request"),
    ],
)
def test_invalid_second_refill_never_partially_prepares_or_writes(fixture, edit, reason):
    _root, path, before, _data = fixture
    result = invoke(api.prepare_health, fixture, [edits()[1], edit])
    assert result["status"] == "rejected"
    assert result["reason"] == reason
    assert path.read_bytes() == before
    assert not list(path.parent.glob("*.json"))
    assert not list(path.parent.glob("*.bak-*"))


def test_empty_duplicate_and_oversized_refill_requests_are_rejected_intact(fixture):
    _root, path, before, _data = fixture
    for changes in [
        [],
        edits() * 2,
        [edits()[0]] * 513,
        [{"saveKey": f"Item Tool/{n}", "before": 1} for n in range(100)],
    ]:
        assert invoke(api.prepare_health, fixture, changes)["reason"] == "invalid_request"
    assert path.read_bytes() == before
    assert not list(path.parent.glob("*.json"))


@pytest.mark.parametrize("delta", [-1, 0, 1])
def test_utf8_refill_intent_fits_unchanged_receipt_ceiling(delta):
    changes = [{"saveKey": f"Item 🧪/{n}", "before": 1} for n in range(35)]
    intent = {"refillToFull": changes}

    def size():
        return len(json.dumps(intent, ensure_ascii=False, separators=(",", ":")).encode())

    target = 2048 + delta
    for edit in changes:
        padding = min(target - size(), 50)
        edit["saveKey"] = edit["saveKey"].replace("/", "x" * padding + "/")
    assert size() == target
    assert storage.valid_refill_intent(intent) is (delta <= 0)
    if delta <= 0:
        receipt = storage.Receipt(
            OP,
            f"{SAVE}.es3",
            "a" * 64,
            [2**128 - 1] * 4,
            0xFFFFFFFF,
            2**64 - 1,
            after="b" * 64,
            after_identity=[2**128 - 1] * 4,
            phase="unchanged",
            version=7,
            namespace="c" * 64,
            intent=intent,
        )
        assert len(storage._receipt_bytes(receipt)) <= 3103 < 4096


def test_handoff_cannot_change_exact_refill_intent(fixture):
    _root, path, before, _data = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    changed = edits()
    changed[1]["before"] = 2
    result = invoke(api.write_health, fixture, changed, reserved=True)
    assert result["status"] == "uncertain"
    assert result["reason"] == "invalid_request"
    assert path.read_bytes() == before
    tx = storage.HealthTransaction(path, OP)
    assert json.loads(tx.pending.read_bytes())["intent"] == {"refillToFull": edits()}
    assert not tx.backup.exists()


def test_stale_source_blocks_refill_before_writer_claim(fixture):
    _root, path, before, _data = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    tx = storage.HealthTransaction(path, OP)
    receipt = tx.pending.read_bytes()
    path.write_bytes(before + b"external change")
    result = invoke(api.write_health, fixture, reserved=True)
    assert result["status"] == "rejected"
    assert result["reason"] == "write_conflict"
    assert tx.pending.read_bytes() == receipt
    assert path.read_bytes() == before + b"external change"
    assert not tx.backup.exists()


@pytest.mark.parametrize("capability", [Capability.UNKNOWN, Capability.NOT_RECHARGEABLE])
def test_writer_rechecks_capability_after_reservation(fixture, capability):
    root, path, before, _data = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    result = api.write_health(
        SAVE,
        sha256(before).hexdigest(),
        edits(),
        OP,
        root,
        reserved=True,
        refill_batch=True,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
        recharge_capability_loader=lambda names: dict.fromkeys(names, capability),
    )["transaction"]
    assert result["status"] == "uncertain"
    assert result["reason"] == "save_validation_failed"
    assert path.read_bytes() == before
    tx = storage.HealthTransaction(path, OP)
    assert not tx.backup.exists()
    assert json.loads(tx.pending.read_bytes())["intent"] == {"refillToFull": edits()}


def test_legacy_health_writer_cannot_borrow_a_refill_reservation(fixture):
    root, path, before, _data = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    result = api.write_health(
        SAVE,
        sha256(before).hexdigest(),
        [{"feature": "players", "entity": "111", "field": "health", "after": 17}],
        OP,
        root,
        reserved=True,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
    )["transaction"]
    assert result["status"] == "uncertain"
    assert result["reason"] == "invalid_request"
    assert path.read_bytes() == before
    tx = storage.HealthTransaction(path, OP)
    assert not tx.backup.exists()
    assert json.loads(tx.pending.read_bytes())["intent"] == {"refillToFull": edits()}


@pytest.mark.parametrize("version", range(1, 7))
def test_refill_receipt_cannot_be_relabelled_as_an_old_domain(fixture, version):
    root, path, before, _data = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    tx = storage.HealthTransaction(path, OP)
    receipt = json.loads(tx.pending.read_bytes())
    receipt["version"] = version
    raw = json.dumps(receipt).encode()
    tx.pending.write_bytes(raw)
    assert api.health_state(SAVE, root)["state"] == "blocked"
    assert api.recover_health(SAVE, OP, root)["transaction"]["status"] == "conflict"
    assert tx.pending.read_bytes() == raw
    assert path.read_bytes() == before


@pytest.mark.parametrize("point", ["backup", "stage"])
def test_io_failure_keeps_original_and_recoverable_intent(fixture, monkeypatch, point):
    root, path, before, _data = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"

    def fail(*_args, **_kwargs):
        raise OSError("Synthetic transaction failure")

    monkeypatch.setattr(
        storage.HealthTransaction, "create_backup" if point == "backup" else "stage", fail
    )
    assert invoke(api.write_health, fixture, reserved=True)["status"] == "uncertain"
    assert path.read_bytes() == before
    result = api.recover_health(SAVE, OP, root, canonical=True, acknowledge=False)["transaction"]
    assert result["status"] == "unchanged"
    assert api.health_state(SAVE, root)["pending"]["intent"] == {"refillToFull": edits()}


@pytest.mark.parametrize("final", ["running", "unknown", "error"])
def test_final_game_check_blocks_every_refill_and_retains_exact_backup(fixture, monkeypatch, final):
    root, path, before, _data = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    staged = False
    original = storage.HealthTransaction.verified

    def verified(*args):
        nonlocal staged
        original(*args)
        staged = True

    def status():
        if not staged:
            return GameProcessStatus.NOT_RUNNING
        if final == "error":
            raise OSError("Synthetic final status failure")
        return GameProcessStatus(final)

    monkeypatch.setattr(storage.HealthTransaction, "verified", verified)
    result = api.write_health(
        SAVE,
        sha256(before).hexdigest(),
        edits(),
        OP,
        root,
        reserved=True,
        refill_batch=True,
        game_status_loader=status,
        recharge_capability_loader=capabilities,
    )["transaction"]
    assert result["status"] == "uncertain"
    assert path.read_bytes() == before
    tx = storage.HealthTransaction(path, OP)
    assert tx.backup.read_bytes() == before
    assert json.loads(tx.pending.read_bytes())["phase"] == "verified"
    assert (
        api.recover_health(SAVE, OP, root, canonical=True, acknowledge=False)["transaction"][
            "status"
        ]
        == "unchanged"
    )
