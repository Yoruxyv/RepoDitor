from __future__ import annotations

import json
import multiprocessing as mp
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from repo_save_editor.core.crypto import _encrypt_plaintext, decrypt_save, encrypt_save
from repo_save_editor.desktop_api.health_admission import FixtureHealthTransaction
from repo_save_editor.desktop_api.health_recovery import prepare_health
from repo_save_editor.desktop_api.saves import save_changes
from repo_save_editor.services.game.processes import GameProcessStatus, ProcessInspectionError
from repo_save_editor.storage.health_recovery import (
    HealthTransaction,
    RecoveryError,
    inspect_pending,
)
from repo_save_editor.storage.repository import SaveRepository

SAVE = "REPO_SAVE_2026_08_08_10_20_30"
OP = "a" * 32
NEXT = "b" * 32
STOPPED = GameProcessStatus.NOT_RUNNING


def closed():
    return STOPPED


def service(root, status=closed, **options):
    return FixtureHealthTransaction(lambda: root, status, **options)


def digest(source):
    return sha256(source).hexdigest()


@pytest.fixture
def save(sample_save):
    area = Path(__file__).resolve().parents[3] / "build" / "health-admission-fixtures"
    area.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=area) as work:
        root = Path(work)
        path = root / SAVE / f"{SAVE}.es3"
        SaveRepository(root).save_as(path, sample_save)
        yield path, path.read_bytes(), root


def test_exact_backup_only_selected_leaf_and_idempotent_settlement(save, sample_save):
    path, before, root = save
    writer = service(root)
    token = writer.confirm(SAVE, digest(before), "111", 17, OP)

    result = writer.commit(token)
    updated = path.read_bytes()
    assert result.status == "pending"
    assert result.fingerprint == digest(updated)
    assert result.backup_available
    assert result.health is None
    tx = HealthTransaction(path, OP)
    assert tx.backup.read_bytes() == before
    receipt = inspect_pending(path)
    assert receipt is not None
    assert receipt.operation == OP
    assert receipt.intent == {"playerId": "111", "before": 80, "health": 17}
    sample_save["dictionaryOfDictionaries"]["value"]["playerHealth"]["111"] = 17
    assert decrypt_save(updated) == sample_save

    another_session = service(root)
    assert another_session.recover(SAVE).status == "busy"
    assert writer.commit(token).reason == "invalid_session"
    assert another_session.commit(token).reason == "invalid_session"
    assert tx.pending.is_file()
    assert tx.archive.is_file()
    assert path.read_bytes() == updated
    assert tx.backup.read_bytes() == before


@pytest.mark.parametrize("player", ["999", "222", "../111", "playerUpgradeStrength", {"run": 1}])
def test_unknown_absent_and_cross_domain_players_do_not_prepare(save, player):
    path, before, root = save
    txn = service(root)
    with pytest.raises(RecoveryError, match=r"save_validation_failed|invalid_request"):
        txn.confirm(SAVE, digest(before), player, 17, OP)
    assert path.read_bytes() == before
    assert inspect_pending(path) is None


@pytest.mark.parametrize("value", [True, False, 17.0, "17", -1, 101, 2**31, {"health": 17}, [17]])
def test_input_is_one_bounded_health_integer(save, value):
    path, before, root = save
    with pytest.raises(RecoveryError, match=r"invalid_request|save_validation_failed"):
        service(root).confirm(SAVE, digest(before), "111", value, OP)
    assert path.read_bytes() == before
    assert inspect_pending(path) is None


@pytest.mark.parametrize(
    "change", ["schema", "wrapper", "health_table", "absent_leaf", "invalid_leaf", "upgrade_type"]
)
def test_malformed_save_cannot_admit_health(save, sample_save, change):
    path, _before, root = save
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    if change == "schema":
        dictionaries["runStats"] = 0
    elif change == "wrapper":
        sample_save["dictionaryOfDictionaries"]["__type"] = "System.String"
    elif change == "health_table":
        dictionaries["playerHealth"] = None
    elif change == "absent_leaf":
        del dictionaries["playerHealth"]["111"]
    elif change == "invalid_leaf":
        dictionaries["playerHealth"]["111"] = True
    else:
        dictionaries["playerUpgradeHealth"] = {"111": "22"}
    malformed = encrypt_save(sample_save)
    path.write_bytes(malformed)
    with pytest.raises(RecoveryError, match="save_validation_failed"):
        service(root).confirm(SAVE, digest(malformed), "111", 17, OP)
    assert path.read_bytes() == malformed
    assert inspect_pending(path) is None


def test_lossy_numbers_are_rejected_before_receipt_and_backup(save):
    path, _before, root = save
    edited = decrypt_save(path.read_bytes())
    plaintext = json.dumps(edited).replace("100.0", "100.000000000000000001")
    source = _encrypt_plaintext(plaintext.encode())
    path.write_bytes(source)
    writer = service(root)
    token = writer.confirm(SAVE, digest(source), "111", 17, OP)
    result = writer.commit(token)
    assert (result.status, result.reason) == ("rejected", "save_unsupported")
    assert path.read_bytes() == source
    assert inspect_pending(path) is None
    assert not HealthTransaction(path, OP).backup.exists()


def test_missing_fixture_and_unrecognized_slot_create_no_save(save, monkeypatch):
    path, before, root = save
    monkeypatch.setenv("REPODITOR_E2E_LOCAL_APP_DATA_LOW", str(root))
    monkeypatch.setenv("REPODITOR_E2E", "1")
    with pytest.raises(RecoveryError, match="fixture_unavailable"):
        service(None).confirm(SAVE, digest(before), "111", 17, OP)
    for invalid in ("../" + SAVE, "MetaSave", "REPO_SAVE_2026_08_99_10_20_30"):
        with pytest.raises(RecoveryError, match="invalid_request"):
            service(root).confirm(invalid, digest(before), "111", 17, OP)
    absent = "REPO_SAVE_2026_08_08_10_20_31"
    with pytest.raises(RecoveryError):
        service(root).confirm(absent, digest(before), "111", 17, OP)
    assert not (root / absent).exists()
    assert path.read_bytes() == before


def test_resolver_cannot_admit_an_outside_profile(save, sample_save, tmp_path):
    _path, _source, fixture_root = save
    profile = tmp_path / "AppData" / "LocalLow" / "semiwork" / "Repo" / "saves"
    slot = profile / SAVE / f"{SAVE}.es3"
    SaveRepository(profile).save_as(slot, sample_save)
    original = slot.read_bytes()
    for root in (profile, fixture_root.parent, fixture_root / ".." / "other-fixtures"):
        writer = service(root)
        with pytest.raises(RecoveryError, match="fixture_unavailable"):
            writer.confirm(SAVE, digest(original), "111", 17, OP)
        assert writer.recover(SAVE).reason == "fixture_unavailable"
    assert list(slot.parent.iterdir()) == [slot]
    assert slot.read_bytes() == original


def test_confirmation_expires_during_the_final_game_query(save):
    path, before, root = save
    now = [0.0]
    checks = []

    def status():
        checks.append("game")
        if len(checks) == 3:
            now[0] = 60.0
        return STOPPED

    writer = service(root, status, clock=lambda: now[0])
    token = writer.confirm(SAVE, digest(before), "111", 17, OP)
    result = writer.commit(token)
    assert (result.status, result.reason) == ("uncertain", "admission_expired")
    assert path.read_bytes() == before
    assert HealthTransaction(path, OP).backup.read_bytes() == before
    assert inspect_pending(path) is not None


def test_stale_open_fingerprint_is_rejected_at_confirmation(save):
    path, before, root = save
    stale = "0" * 64
    with pytest.raises(RecoveryError, match="save_stale"):
        service(root).confirm(SAVE, stale, "111", 17, OP)
    assert path.read_bytes() == before
    assert inspect_pending(path) is None


@pytest.mark.parametrize("change", ["fingerprint", "same_bytes_new_identity", "namespace", "root"])
def test_confirmation_binds_source_and_fixture(save, sample_save, change):
    path, before, root = save
    selected = [root]
    writer = FixtureHealthTransaction(lambda: selected[0], closed)
    token = writer.confirm(SAVE, digest(before), "111", 17, OP)
    if change == "fingerprint":
        sample_save["dictionaryOfDictionaries"]["value"]["playerHealth"]["111"] = 81
        path.write_bytes(encrypt_save(sample_save))
    elif change == "same_bytes_new_identity":
        same = path.with_suffix(".new")
        same.write_bytes(before)
        same.replace(path)
    elif change == "namespace":
        original = path.parent.with_name("old-slot")
        path.parent.rename(original)
        path.parent.mkdir()
        (original / path.name).replace(path)
    else:
        selected[0] = root.parent / "other-fixtures"
    current = path.read_bytes()
    result = writer.commit(token)
    assert (result.status, result.reason) == ("rejected", "save_stale")
    assert path.read_bytes() == current
    assert inspect_pending(path) is None


@pytest.mark.parametrize("change", ["closed", "switched", "expired", "restarted"])
def test_stale_confirmation_and_expired_operation(save, change):
    path, before, root = save
    now = [0.0]
    writer = service(root, clock=lambda: now[0])
    old = writer.confirm(SAVE, digest(before), "111", 17, OP)
    assert writer.commit("wrong-token").reason == "invalid_session"
    if change == "closed":
        writer.invalidate()
    elif change == "switched":
        writer.confirm(SAVE, digest(before), "111", 18, NEXT)
    elif change == "expired":
        now[0] = 60
    else:
        writer = service(root)
    result = writer.commit(old)
    assert result.status == "rejected"
    assert result.reason == ("admission_expired" if change == "expired" else "invalid_session")
    assert path.read_bytes() == before
    assert inspect_pending(path) is None


@pytest.mark.parametrize(
    ("final", "reason"),
    [
        (GameProcessStatus.RUNNING, "game_running"),
        (GameProcessStatus.UNKNOWN, "game_status_unknown"),
        (ProcessInspectionError("internal detail"), "game_status_unknown"),
    ],
)
@pytest.mark.parametrize("stage", ["confirm", "initial_commit", "final"])
def test_game_gate_leaves_exact_source_and_preserves_recovery(save, final, reason, stage):
    path, before, root = save
    states = iter([STOPPED] * {"confirm": 0, "initial_commit": 1, "final": 2}[stage] + [final])

    def status():
        state = next(states)
        if isinstance(state, Exception):
            raise state
        return state

    writer = service(root, status)
    if stage == "confirm":
        with pytest.raises(RecoveryError, match=reason):
            writer.confirm(SAVE, digest(before), "111", 17, OP)
    else:
        token = writer.confirm(SAVE, digest(before), "111", 17, OP)
        outcome = writer.commit(token)
        assert (outcome.status, outcome.reason) == (
            "uncertain" if stage == "final" else "rejected",
            reason,
        )
    assert path.read_bytes() == before
    if stage != "final":
        assert inspect_pending(path) is None
        return
    assert inspect_pending(path) is not None
    assert HealthTransaction(path, OP).backup.read_bytes() == before
    assert service(root, status).recover(SAVE).status == "busy"
    assert inspect_pending(path) is not None


@pytest.mark.parametrize("change", ["modified_source", "expired", "damaged_backup"])
def test_final_binding_and_backup_validation_precede_last_game_query(save, monkeypatch, change):
    path, before, root = save
    now = [0.0]
    checks = []
    original = HealthTransaction.verified
    foreign = encrypt_save(decrypt_save(before))

    def after_stage(tx, written):
        original(tx, written)
        if change == "modified_source":
            path.write_bytes(foreign)
        elif change == "expired":
            now[0] = 60
        else:
            tx.backup.write_bytes(foreign)

    monkeypatch.setattr(HealthTransaction, "verified", after_stage)

    def status():
        checks.append("game")
        return STOPPED

    writer = service(root, status, clock=lambda: now[0])
    token = writer.confirm(SAVE, digest(before), "111", 17, OP)
    expected = {
        "modified_source": "save_stale",
        "expired": "admission_expired",
        "damaged_backup": "backup_failed",
    }
    result = writer.commit(token)
    assert (result.status, result.reason) == ("uncertain", expected[change])
    assert checks == ["game", "game"]
    assert path.read_bytes() == (foreign if change == "modified_source" else before)
    assert inspect_pending(path) is not None


def test_wrong_operation_and_other_domain_pending_evidence_survive(save):
    path, before, root = save
    health = service(root)
    result = prepare_health(
        SAVE,
        digest(before),
        [{"playerId": "111", "before": 80, "value": 17}],
        OP,
        root,
        health_batch=True,
        game_status_loader=closed,
    )
    assert result["transaction"]["status"] == "prepared"
    tx = HealthTransaction(path, OP)
    receipt = tx.pending.read_bytes()
    assert health.recover(SAVE, NEXT).status == "conflict"
    assert health.recover(SAVE).status == "conflict"
    assert tx.pending.read_bytes() == receipt
    assert path.read_bytes() == before


def _commit_worker(root, fingerprint, phase, ready, release):
    checks = 0

    def pause():
        ready.set()
        if not release.wait(20):
            raise RuntimeError("Parent did not release test worker")

    def status():
        nonlocal checks
        checks += 1
        if checks == 3 and phase in {"before_replace", "write_through"}:
            pause()
        return STOPPED

    actual_recover = HealthTransaction.recover

    def after_replace(self, *, own_completion=False, acknowledge=True):
        if own_completion and phase == "after_replace":
            pause()
        return actual_recover(self, own_completion=own_completion, acknowledge=acknowledge)

    if phase == "after_replace":
        HealthTransaction.recover = after_replace
    writer = service(root, status)
    token = writer.confirm(SAVE, fingerprint, "111", 17, OP)
    assert writer.commit(token).status == "pending"
    if phase == "commit_response_lost":
        pause()


def _recover_worker(root, ready, release):
    assert service(root).recover(SAVE).status == "applied"
    ready.set()
    if not release.wait(20):
        raise RuntimeError("Parent did not release test worker")


@pytest.mark.parametrize(
    "phase",
    [
        "before_replace",
        "after_replace",
        "commit_response_lost",
        "settled_response_lost",
        "write_through",
    ],
)
def test_process_handoff_lost_response_and_competing_writer(save, phase):
    path, before, root = save
    competitor = service(root)
    token = competitor.confirm(SAVE, digest(before), "111", 19, NEXT)
    context = mp.get_context("spawn")
    ready, release = context.Event(), context.Event()
    if phase == "settled_response_lost":
        writer = context.Process(
            target=_commit_worker, args=(root, digest(before), phase, ready, release)
        )
        writer.start()
        try:
            writer.join(15)
            assert writer.exitcode == 0
        finally:
            if writer.is_alive():
                writer.kill()
                writer.join(10)
            writer.close()
        process = context.Process(target=_recover_worker, args=(root, ready, release))
    else:
        process = context.Process(
            target=_commit_worker, args=(root, digest(before), phase, ready, release)
        )
    process.start()
    try:
        assert ready.wait(15), f"Worker exited {process.exitcode} before the {phase} checkpoint"
        if phase in {"before_replace", "write_through"}:
            assert path.read_bytes() == before
            result = competitor.commit(token)
            assert (result.status, result.reason) == ("rejected", "write_busy")
            legacy = save_changes(
                SAVE,
                digest(before),
                [{"feature": "players", "entity": "111", "field": "health", "after": 19}],
                root,
                game_status_loader=closed,
            )
            assert legacy["ok"] is False
            assert legacy["error"]["code"] == "save_stale"
            assert service(root).recover(SAVE).status == "busy"
        elif phase == "commit_response_lost":
            assert service(root).recover(SAVE).status == "busy"
        if phase == "write_through":
            release.set()
        else:
            process.kill()
        process.join(15)
        assert not process.is_alive()
        if phase == "write_through":
            assert process.exitcode == 0
        else:
            assert process.exitcode not in (None, 0)
    finally:
        if process.is_alive():
            process.kill()
            process.join(10)
        process.close()

    state = service(root)
    settled = state.recover(SAVE, OP if phase == "settled_response_lost" else None)
    expected = "unchanged" if phase == "before_replace" else "applied"
    after = path.read_bytes()
    assert settled.status == expected
    assert settled.fingerprint == digest(after)
    assert settled.health == (80 if expected == "unchanged" else 17)
    assert (after == before) == (expected == "unchanged")
    assert HealthTransaction(path, OP).backup.read_bytes() == before
    assert inspect_pending(path) is None
    assert state.recover(SAVE, OP) == settled
    with pytest.raises(RecoveryError, match="write_duplicate"):
        state.confirm(SAVE, digest(after), "111", 20, OP)
    assert path.read_bytes() == after


def test_lost_request_before_commit_leaves_no_receipt_and_cannot_replay(save):
    path, before, root = save
    old = service(root).confirm(SAVE, digest(before), "111", 17, OP)
    restarted = service(root)
    assert restarted.recover(SAVE).status == "idle"
    assert restarted.commit(old).reason == "invalid_session"
    assert path.read_bytes() == before
    assert inspect_pending(path) is None
