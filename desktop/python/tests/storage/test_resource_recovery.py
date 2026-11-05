"""Size rejection preserves Run, MetaSave, and durable transaction evidence."""

from copy import deepcopy
from hashlib import sha256

import pytest

from repo_save_editor.core import save_resources as resources
from repo_save_editor.core.crypto import encrypt_save
from repo_save_editor.desktop_api.cosmetics import get_cosmetics
from repo_save_editor.desktop_api.health_recovery import (
    prepare_health,
    recover_health,
    write_health,
)
from repo_save_editor.desktop_api.saves import open_save
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.storage import health_recovery as recovery
from repo_save_editor.storage.repository import SaveRepository

SAVE = "REPO_SAVE_2026_08_08_10_20_30"
OP = "a" * 32


@pytest.fixture
def saved(tmp_path, sample_save):
    root = tmp_path / "semiwork/Repo/saves"
    path = root / SAVE / f"{SAVE}.es3"
    SaveRepository(root).save_as(path, sample_save)
    return root, path, path.read_bytes()


def _changes():
    return [{"feature": "players", "entity": "111", "field": "health", "after": 17}]


@pytest.mark.parametrize("kind", ["run", "meta"])
def test_oversize_discovery_error_is_understandable_and_private(saved, kind, monkeypatch):
    root, path, before = saved
    if kind == "meta":
        path = root.parent / "MetaSave.es3"
        path.write_bytes(before)
    monkeypatch.setattr(resources, "ENCRYPTED_LIMIT", len(before) - 1)
    result = open_save(SAVE, root) if kind == "run" else get_cosmetics(root)
    assert result["ok"] is False
    assert result["error"]["code"] == "save_unsupported"
    assert "supported-size" in result["error"]["message"]
    assert str(root) not in str(result)
    assert path.read_bytes() == before


def test_oversized_edit_rejected_before_receipt_or_backup(saved, sample_save, monkeypatch):
    root, path, before = saved
    edited = deepcopy(sample_save)
    edited["unknown"] = {"value": "x" * 3000}
    monkeypatch.setattr(resources, "PLAINTEXT_LIMIT", 2000)
    transaction = recovery.HealthTransaction(path, OP)
    with pytest.raises(resources.SaveResourceError):
        SaveRepository(root).overwrite(path, edited, health_transaction=transaction)
    assert path.read_bytes() == before
    assert list(path.parent.iterdir()) == [path]
    assert not transaction.started


def test_aggregate_rejection_precedes_transaction_mutation(saved, sample_save, monkeypatch):
    root, path, before = saved
    transaction = recovery.HealthTransaction(path, OP)
    monkeypatch.setattr(resources, "ENCRYPTED_OPERATION_LIMIT", len(before))
    edited = deepcopy(sample_save)
    edited["dictionaryOfDictionaries"]["value"]["playerHealth"]["111"] = 17
    with pytest.raises(resources.SaveResourceError):
        SaveRepository(root).overwrite(path, edited, health_transaction=transaction)
    assert path.read_bytes() == before
    assert list(path.parent.iterdir()) == [path]


@pytest.mark.parametrize("artifact", ["path", "backup", "temporary"])
def test_recovery_size_rejection_preserves_every_evidence_byte(saved, artifact, monkeypatch):
    _root, path, before = saved
    transaction = recovery.HealthTransaction(path, OP)
    transaction.prepare(before)
    transaction.create_backup(before)
    transaction.stage(b"staged evidence")
    target = getattr(transaction, artifact)
    target.write_bytes(b"x" * (len(before) + 1))
    evidence = {p.name: p.read_bytes() for p in path.parent.iterdir()}
    monkeypatch.setattr(resources, "ENCRYPTED_LIMIT", len(before))
    with pytest.raises(resources.SaveResourceError):
        transaction.recover()
    assert {p.name: p.read_bytes() for p in path.parent.iterdir()} == evidence


def test_recovery_aggregate_rejection_preserves_pending_and_temps(saved, monkeypatch):
    _root, path, before = saved
    transaction = recovery.HealthTransaction(path, OP)
    transaction.prepare(before)
    transaction.create_backup(before)
    transaction.stage(b"distinct staged evidence")
    evidence = {p.name: p.read_bytes() for p in path.parent.iterdir()}
    monkeypatch.setattr(resources, "ENCRYPTED_OPERATION_LIMIT", len(before))
    with pytest.raises(resources.SaveResourceError):
        transaction.recover()
    assert {p.name: p.read_bytes() for p in path.parent.iterdir()} == evidence


def test_late_size_failure_keeps_staging_for_recovery(saved, sample_save, monkeypatch):
    root, path, before = saved
    transaction = recovery.HealthTransaction(path, OP)

    def reject(*_args):
        raise resources.SaveResourceError

    monkeypatch.setattr(SaveRepository, "_verify_staged", reject)
    with pytest.raises(resources.SaveResourceError):
        SaveRepository(root).overwrite(path, sample_save, health_transaction=transaction)
    assert path.read_bytes() == before
    assert transaction.backup.read_bytes() == before
    assert transaction.temporary.exists()
    assert transaction.pending.exists()
    assert not transaction.archive.exists()


def test_reserved_writer_rejects_size_before_claiming_receipt(saved, monkeypatch):
    root, path, before = saved
    prepared = prepare_health(
        SAVE,
        sha256(before).hexdigest(),
        _changes(),
        OP,
        root,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
    )
    assert prepared["transaction"]["status"] == "prepared"
    evidence = {p.name: p.read_bytes() for p in path.parent.iterdir()}
    monkeypatch.setattr(recovery, "_owner_exited", lambda *_args: True)
    monkeypatch.setattr(resources, "ENCRYPTED_LIMIT", len(before) - 1)
    result = write_health(
        SAVE,
        sha256(before).hexdigest(),
        _changes(),
        OP,
        root,
        reserved=True,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
    )["transaction"]
    assert result["status"] == "rejected"
    assert result["reason"] == "save_unsupported"
    assert {p.name: p.read_bytes() for p in path.parent.iterdir()} == evidence


def test_canonical_recovery_checks_plaintext_before_receipt_mutation(saved, monkeypatch):
    root, path, before = saved
    transaction = recovery.HealthTransaction(path, OP)
    transaction.prepare(before)
    transaction.create_backup(before)
    transaction.stage(before)
    with recovery.health_lock(path):
        pass
    evidence = {p.name: p.read_bytes() for p in path.parent.iterdir()}
    monkeypatch.setattr(resources, "PLAINTEXT_LIMIT", 1)
    result = recover_health(SAVE, OP, root, canonical=True)["transaction"]
    assert result["status"] == "conflict"
    assert result["reason"] == "save_unsupported"
    assert {p.name: p.read_bytes() for p in path.parent.iterdir()} == evidence


def test_related_run_and_meta_payloads_share_an_operation(saved, monkeypatch):
    root, _path, before = saved
    meta = {"cosmeticUnlocks": {"value": []}}
    meta_bytes = encrypt_save(meta)
    (root.parent / "MetaSave.es3").write_bytes(meta_bytes)
    monkeypatch.setattr(resources, "ENCRYPTED_OPERATION_LIMIT", len(before) + len(meta_bytes) - 1)
    with resources.save_operation():
        assert open_save(SAVE, root)["ok"] is True
        result = get_cosmetics(root)
        assert result["error"]["code"] == "save_unsupported"
