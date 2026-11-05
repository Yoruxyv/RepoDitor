"""Durable upgrade batches share health exclusion and the authoritative writer."""

import json
from hashlib import sha256

import pytest

from repo_save_editor.core.crypto import _decrypt_plaintext, _encrypt_plaintext
from repo_save_editor.desktop_api import health_recovery as api
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.storage import health_recovery as storage
from repo_save_editor.storage.repository import SaveRepository

SAVE = "REPO_SAVE_2026_08_08_10_20_30"
OP = "a" * 32
OTHER = "b" * 32


@pytest.fixture
def fixture(tmp_path, sample_save, monkeypatch):
    root = tmp_path / "semiwork/Repo/saves"
    path = root / SAVE / f"{SAVE}.es3"
    sample_save["dictionaryOfDictionaries"]["value"]["playerUpgradeSpeed"] = {"111": 1, "222": 4}
    SaveRepository(root).save_as(path, sample_save)
    monkeypatch.setattr(storage, "_owner_exited", lambda *_args: True)
    return root, path, path.read_bytes()


def edits():
    return [
        {"playerId": "111", "key": "playerUpgradeStrength", "before": 2, "value": 7},
        {"playerId": "222", "key": "playerUpgradeSpeed", "before": 4, "value": 9},
    ]


def invoke(handler, fixture, changes=None, operation=OP, **kwargs):
    root, _path, before = fixture
    return handler(
        SAVE,
        sha256(before).hexdigest(),
        edits() if changes is None else changes,
        operation,
        root,
        upgrade_batch=True,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
        **kwargs,
    )["transaction"]


@pytest.mark.parametrize("count", [1, 2])
def test_batch_save_reopen_and_explicit_acknowledgement(fixture, count):
    root, path, before = fixture
    changes = edits()[:count]
    assert invoke(api.prepare_health, fixture, changes)["status"] == "prepared"
    tx = storage.HealthTransaction(path, OP)
    receipt = json.loads(tx.pending.read_bytes())
    assert receipt["version"] == 4
    assert receipt["intent"] == {"upgrades": changes}
    assert len(tx.pending.read_bytes()) <= 4096
    result = invoke(api.write_health, fixture, changes, reserved=True)
    assert result["status"] == "applied"
    assert tx.backup.read_bytes() == before
    data = SaveRepository.load(path)["dictionaryOfDictionaries"]["value"]
    assert data["playerUpgradeStrength"]["111"] == 7
    assert data["playerUpgradeSpeed"]["222"] == (9 if count == 2 else 4)
    reconciled = api.recover_health(SAVE, OP, root, canonical=True, acknowledge=False)[
        "transaction"
    ]
    assert reconciled["status"] == "applied"
    assert reconciled["canonical"]["upgrades"]
    assert tx.pending.exists()
    assert api.recover_health(SAVE, OP, root, canonical=True)["transaction"]["status"] == "applied"
    assert not tx.pending.exists()
    assert tx.archive.exists()
    assert invoke(api.prepare_health, fixture, changes)["reason"] == "write_duplicate"


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        ({"before": 3}, "save_stale"),
        ({"playerId": "999"}, "save_validation_failed"),
        ({"key": "playerUpgradeForged"}, "save_validation_failed"),
        ({"value": True}, "invalid_request"),
        ({"value": -1}, "invalid_request"),
        ({"value": 2_147_483_648}, "invalid_request"),
        ({"key": "../save"}, "invalid_request"),
    ],
)
def test_rejected_batch_preserves_all_source_bytes(fixture, mutation, reason):
    _root, path, before = fixture
    changes = edits()
    changes[-1].update(mutation)
    result = invoke(api.prepare_health, fixture, changes)
    assert result["status"] == "rejected"
    assert result["reason"] == reason
    assert path.read_bytes() == before
    assert not list(path.parent.glob("*.bak-*"))
    assert not list(path.parent.glob("*.json"))


def test_duplicate_and_oversized_batches_are_rejected_intact(fixture):
    _root, path, before = fixture
    for changes in ([edits()[0]] * 2, [edits()[0]] * 513):
        assert invoke(api.prepare_health, fixture, changes)["reason"] == "invalid_request"
    large = [
        {"playerId": str(n), "key": "playerUpgrade" + "x" * 500, "before": 0, "value": 1}
        for n in range(5)
    ]
    assert invoke(api.prepare_health, fixture, large)["reason"] == "invalid_request"
    assert path.read_bytes() == before
    assert not list(path.parent.glob("*.json"))


def test_health_and_upgrade_reservations_exclude_each_other(fixture):
    root, path, before = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    health = [{"feature": "players", "entity": "111", "field": "health", "after": 20}]
    result = api.prepare_health(
        SAVE,
        sha256(before).hexdigest(),
        health,
        OTHER,
        root,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
    )["transaction"]
    assert result["reason"] == "write_recovery_required"
    assert (
        invoke(api.prepare_health, fixture, operation=OTHER)["reason"] == "write_recovery_required"
    )
    # A health writer cannot resume an upgrade reservation, even with its operation ID.
    result = api.write_health(
        SAVE,
        sha256(before).hexdigest(),
        health,
        OP,
        root,
        reserved=True,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
    )["transaction"]
    assert result["status"] == "uncertain"
    assert result["reason"] == "invalid_request"
    assert path.read_bytes() == before
    assert not list(path.parent.glob("*.bak-*"))


def test_reserved_upgrade_intent_cannot_change_during_handoff(fixture):
    _root, path, before = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    changed = edits()
    changed[0]["value"] = 100
    result = invoke(api.write_health, fixture, changed, reserved=True)
    assert result["status"] == "uncertain"
    assert result["reason"] == "invalid_request"
    assert path.read_bytes() == before
    assert json.loads(storage.HealthTransaction(path, OP).pending.read_bytes())["intent"] == {
        "upgrades": edits()
    }


def test_upgrade_writer_cannot_borrow_a_health_reservation(fixture):
    root, path, before = fixture
    health = [{"feature": "players", "entity": "111", "field": "health", "after": 17}]
    result = api.prepare_health(
        SAVE,
        sha256(before).hexdigest(),
        health,
        OP,
        root,
        remember_intent=True,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
    )["transaction"]
    assert result["status"] == "prepared"
    assert (
        invoke(api.prepare_health, fixture, operation=OTHER)["reason"] == "write_recovery_required"
    )
    assert invoke(api.write_health, fixture, reserved=True)["reason"] == "invalid_request"
    assert path.read_bytes() == before
    assert json.loads(storage.HealthTransaction(path, OP).pending.read_bytes())["intent"] == {
        "playerId": "111",
        "health": 17,
        "before": 80,
    }
    assert not list(path.parent.glob("*.bak-*"))


def test_stale_source_after_reservation_never_applies_partial_batch(fixture):
    _root, path, before = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    path.write_bytes(before + b"changed")
    result = invoke(api.write_health, fixture, reserved=True)
    assert result["reason"] == "write_conflict"
    assert path.read_bytes() == before + b"changed"
    assert not list(path.parent.glob("*.bak-*"))


@pytest.mark.parametrize("final", [GameProcessStatus.RUNNING, GameProcessStatus.UNKNOWN])
def test_final_game_check_preserves_the_entire_upgrade_batch(fixture, final):
    root, path, before = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    statuses = iter([GameProcessStatus.NOT_RUNNING, GameProcessStatus.NOT_RUNNING, final])
    result = api.write_health(
        SAVE,
        sha256(before).hexdigest(),
        edits(),
        OP,
        root,
        reserved=True,
        upgrade_batch=True,
        game_status_loader=lambda: next(statuses),
    )["transaction"]
    assert result["status"] == "uncertain"
    assert result["reason"] == (
        "game_running" if final is GameProcessStatus.RUNNING else "game_status_unknown"
    )
    assert path.read_bytes() == before
    tx = storage.HealthTransaction(path, OP)
    assert tx.backup.read_bytes() == before
    assert json.loads(tx.pending.read_bytes())["phase"] == "verified"


def test_numeric_loss_rejection_keeps_upgrade_reservation_and_exact_source(fixture):
    root, path, before = fixture
    plaintext = _decrypt_plaintext(before).decode().rstrip()
    blob = _encrypt_plaintext(
        (plaintext[:-1] + ', "unknown": {"value": 0.123456789012345678901234}}').encode()
    )
    path.write_bytes(blob)
    altered = (root, path, blob)
    assert invoke(api.prepare_health, altered)["status"] == "prepared"
    result = invoke(api.write_health, altered, reserved=True)
    assert result["status"] == "uncertain"
    assert result["reason"] == "save_write_failed"
    assert path.read_bytes() == blob
    tx = storage.HealthTransaction(path, OP)
    assert tx.pending.exists()
    assert not tx.backup.exists()


@pytest.mark.parametrize("delta", [-1, 0, 1])
def test_upgrade_intent_byte_ceiling_keeps_receipts_bounded(delta):
    values = [
        {"playerId": str(i), "key": "playerUpgradeX", "before": 0, "value": 1} for i in range(4)
    ]
    intent = {"upgrades": values}

    def size():
        return len(json.dumps(intent, ensure_ascii=False, separators=(",", ":")).encode())

    target = storage.UPGRADE_INTENT_LIMIT + delta
    for edit in values:
        count = min(target - size(), 512 - len(edit["key"]))
        edit["key"] += "X" * count
    assert size() == target
    assert storage.valid_upgrade_intent(intent) is (delta <= 0)
    if delta <= 0:
        receipt = storage.Receipt(
            OP,
            f"{SAVE}.es3",
            "a" * 64,
            [2**64 - 1] * 4,
            0xFFFFFFFF,
            2**64 - 1,
            after="b" * 64,
            after_identity=[2**64 - 1] * 4,
            phase="verified",
            version=4,
            namespace="c" * 64,
            intent=intent,
        )
        assert len(storage._receipt_bytes(receipt)) <= 4096
