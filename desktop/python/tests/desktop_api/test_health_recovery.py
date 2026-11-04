from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from copy import deepcopy
from hashlib import sha256
from pathlib import Path

import pytest

from repo_save_editor.desktop_api import saves
from repo_save_editor.desktop_api.health_recovery import (
    prepare_health,
    recover_health,
    write_health,
)
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.storage import health_recovery as storage
from repo_save_editor.storage.repository import SaveRepository

ID = "REPO_SAVE_2026_08_08_10_20_30"
OP = "a" * 32
NEXT = "b" * 32
PROJECT = Path(__file__).resolve().parents[4]
WORKER = PROJECT / "desktop/e2e/support/recovery-sidecar.py"
# The Windows venv launcher redirects to a child; Unix venv interpreters retain their PID.
PYTHON = sys._base_executable if os.name == "nt" else sys.executable


def prepare(home: Path, data) -> tuple[Path, bytes, Path]:
    root = home / "semiwork/Repo/saves"
    path = root / ID / f"{ID}.es3"
    SaveRepository(root).save_as(path, data)
    return path, path.read_bytes(), root


def change(value=17):
    return [{"feature": "players", "entity": "111", "field": "health", "after": value}]


def write(root, before, operation=OP, value=17):
    return write_health(
        ID,
        sha256(before).hexdigest(),
        change(value),
        operation,
        root,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
    )["transaction"]


def start(home, before, phase, *, recover=False, wait_phase=True, value=17):
    marker = home / "phase.json"
    env = {
        **os.environ,
        "REPODITOR_E2E": "1",
        "REPODITOR_E2E_LOCAL_APP_DATA_LOW": str(home),
        "REPODITOR_E2E_STEAM_ROOT": str(home / "SteamLibrary"),
        "REPODITOR_RECOVERY_SYNTHETIC_STATUS": "not_running",
        "REPODITOR_RECOVERY_PHASE": phase,
        "REPODITOR_RECOVERY_PHASE_FILE": str(marker),
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    env.pop("REPO_GAME_DIR", None)
    args = (
        ["health-recover", ID, OP]
        if recover
        else [
            "saves-write",
            ID,
            sha256(before).hexdigest(),
            json.dumps(change(value)),
            "--health-operation",
            OP,
        ]
    )
    if not recover:
        preparation = subprocess.run(  # noqa: S603 -- fixed interpreter and synthetic reservation arguments.
            [
                PYTHON,
                "-B",
                str(WORKER),
                "health-prepare",
                ID,
                sha256(before).hexdigest(),
                json.dumps(change(value)),
                OP,
            ],
            cwd=PROJECT,
            env={**env, "REPODITOR_RECOVERY_PHASE": ""},
            capture_output=True,
            timeout=15,
            check=True,
        )
        assert preparation.stderr == b""
        assert json.loads(preparation.stdout)["transaction"]["status"] == "prepared"
    process = subprocess.Popen(  # noqa: S603 -- fixed interpreter/fixture; arguments are synthetic test values.
        [PYTHON, "-B", str(WORKER), *args],
        cwd=PROJECT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    deadline = time.monotonic() + 15
    if not wait_phase:
        return process
    try:
        while True:
            try:
                event = json.loads(marker.read_text())
                assert event == {"phase": phase, "pid": process.pid}
                return process
            except (FileNotFoundError, json.JSONDecodeError):
                assert process.poll() is None, process.communicate()
                assert time.monotonic() < deadline, phase
                time.sleep(0.01)
    except BaseException:
        process.kill()
        process.communicate(timeout=10)
        raise


def stop(process):
    process.kill()
    stdout, stderr = process.communicate(timeout=10)
    assert process.returncode is not None
    assert stdout == b""
    assert stderr == b""


@pytest.mark.parametrize("value", [0, 100])
def test_success_bounds_exact_backup_and_no_replay(tmp_path, sample_save, value):
    path, before, root = prepare(tmp_path, sample_save)
    process = start(tmp_path, before, "", wait_phase=False, value=value)
    stdout, stderr = process.communicate(timeout=15)
    assert process.returncode == 0
    assert stderr == b""
    result = json.loads(stdout)["transaction"]
    assert result["status"] == "applied"
    assert result["fingerprint"] == sha256(path.read_bytes()).hexdigest()
    assert result["backupAvailable"] is True
    expected = deepcopy(sample_save)
    expected["dictionaryOfDictionaries"]["value"]["playerHealth"]["111"] = value
    assert SaveRepository.load(path) == expected
    assert next(path.parent.glob("*.bak-health-*")).read_bytes() == before
    current = path.read_bytes()
    assert write(root, current, NEXT)["reason"] == "write_recovery_required"
    assert recover_health(ID, OP, root)["transaction"] == result
    assert write(root, current)["reason"] == "write_duplicate"
    assert path.read_bytes() == current
    assert recover_health(ID, OP, root)["transaction"] == result


@pytest.mark.parametrize("value", [True, 1.5, -1, 101, "2", None])
def test_invalid_values_rejected_without_receipt_or_backup(tmp_path, sample_save, value):
    path, before, root = prepare(tmp_path, sample_save)
    result = write(root, before, value=value)
    assert result["status"] == "rejected"
    reservation = prepare_health(
        ID,
        sha256(before).hexdigest(),
        change(value),
        OP,
        root,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
    )["transaction"]
    assert reservation["status"] == "rejected"
    assert path.read_bytes() == before
    assert not list(path.parent.glob("*.bak-*"))
    assert not list(path.parent.glob("*.json"))


def test_reservation_cannot_be_claimed_while_its_owner_is_alive(tmp_path, sample_save):
    path, before, root = prepare(tmp_path, sample_save)
    prepared = prepare_health(
        ID,
        sha256(before).hexdigest(),
        change(),
        OP,
        root,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
    )["transaction"]
    assert prepared["status"] == "prepared"
    result = write_health(
        ID,
        sha256(before).hexdigest(),
        change(),
        OP,
        root,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
        reserved=True,
    )["transaction"]
    assert result["status"] == "rejected"
    assert result["reason"] == "write_busy"
    assert path.read_bytes() == before
    assert not list(path.parent.glob("*.bak-*"))


@pytest.mark.skipif(os.name != "nt", reason="Windows process creation-time identity")
def test_windows_owner_identity_distinguishes_a_reused_live_pid():
    started = storage._current_started()
    assert started > 0
    assert storage._owner_exited(os.getpid(), started) is False
    assert storage._owner_exited(os.getpid(), started - 1) is True


@pytest.mark.parametrize(
    "phase",
    [
        "before_transaction",
        "backup_partial",
        "backup_complete",
        "staging_partial",
        "verified",
        "before_replace",
        "after_replace",
        "response_construction",
        "after_completion",
    ],
)
def test_killed_process_recovery_and_duplicate_admission(tmp_path, sample_save, phase):
    path, before, root = prepare(tmp_path, sample_save)
    process = start(tmp_path, before, phase)
    try:
        assert recover_health(ID, OP, root)["transaction"]["status"] == "busy"
        expected = "write_recovery_required" if phase == "after_completion" else "write_busy"
        assert write(root, before, NEXT)["reason"] == expected
    finally:
        stop(process)
    applied = phase in {"after_replace", "response_construction", "after_completion"}
    source = path.read_bytes()
    assert (source != before) == applied
    temporary_count = len(list(path.parent.glob(".*.health-*.tmp")))
    assert temporary_count == int(phase in {"staging_partial", "verified", "before_replace"})
    assert write(root, source, NEXT)["reason"] == "write_recovery_required"
    outcome = recover_health(ID, OP, root)["transaction"]
    assert outcome["status"] == ("applied" if applied else "unchanged")
    assert path.read_bytes() == source
    assert not list(path.parent.glob("*.tmp"))
    assert not list(path.parent.glob(".*.tmp"))
    assert recover_health(ID, OP, root)["transaction"] == outcome
    assert write(root, source)["reason"] == "write_duplicate"
    if phase == "before_transaction":
        assert not list(path.parent.glob("*.bak-*"))
    elif phase == "backup_partial":
        assert next(path.parent.glob("*.bak-*")).read_bytes() == before[: len(before) // 2]
    else:
        assert next(path.parent.glob("*.bak-*")).read_bytes() == before
    expected = deepcopy(sample_save)
    if applied:
        expected["dictionaryOfDictionaries"]["value"]["playerHealth"]["111"] = 17
    assert SaveRepository.load(path) == expected
    (tmp_path / "recovery-evidence.json").write_text(
        json.dumps(
            {
                "phase": phase,
                "writer_pid": process.pid,
                "writer_reaped": process.returncode is not None,
                "original_sha256": sha256(before).hexdigest(),
                "source_sha256": sha256(source).hexdigest(),
                "temporary_count_before_recovery": temporary_count,
                "result": outcome,
                "backups": [
                    {
                        "name": backup.name,
                        "bytes": backup.stat().st_size,
                        "sha256": sha256(backup.read_bytes()).hexdigest(),
                    }
                    for backup in path.parent.glob("*.bak-*")
                ],
                "idempotency_verified": True,
                "duplicate_rejected": True,
                "unrelated_data_unchanged": True,
            },
            indent=2,
        )
    )


@pytest.mark.parametrize("phase", ["recovery_archive", "recovery_cleanup"])
def test_recovery_itself_can_be_killed_and_resumed(tmp_path, sample_save, phase):
    path, before, root = prepare(tmp_path, sample_save)
    process = start(tmp_path, before, "verified")
    stop(process)
    (tmp_path / "phase.json").unlink()
    recovery = start(tmp_path, before, phase, recover=True)
    try:
        assert write(root, before, NEXT)["reason"] == "write_busy"
    finally:
        stop(recovery)
    assert write(root, before, NEXT)["reason"] == "write_recovery_required"
    result = recover_health(ID, OP, root)["transaction"]
    assert result["status"] == "unchanged"
    assert recover_health(ID, OP, root)["transaction"] == result
    assert path.read_bytes() == before


def test_external_modification_is_conflict_even_if_health_matches(tmp_path, sample_save):
    path, before, root = prepare(tmp_path, sample_save)
    process = start(tmp_path, before, "after_replace")
    stop(process)
    external = SaveRepository.load(path)
    external["futureField"] = {"value": "external"}
    SaveRepository(root).save_as(path, external)
    changed = path.read_bytes()
    assert recover_health(ID, OP, root)["transaction"]["status"] == "conflict"
    assert write(root, changed, NEXT)["reason"] == "write_recovery_required"
    assert path.read_bytes() == changed
    assert next(path.parent.glob("*.bak-*")).read_bytes() == before


def test_post_commit_error_is_explicitly_uncertain(tmp_path, sample_save, monkeypatch):
    path, before, root = prepare(tmp_path, sample_save)

    def fail_response(*_args):
        raise ValueError("private response-construction diagnostic")

    monkeypatch.setattr(saves, "_session", fail_response)
    result = write(root, before)
    assert result["status"] == "uncertain"
    assert result["reason"] == "save_validation_failed"
    assert "private" not in json.dumps(result)
    assert path.read_bytes() != before
    assert recover_health(ID, OP, root)["transaction"]["status"] == "busy"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("version", 2),
        ("version", True),
        ("after", "bad"),
        ("operation", "../escape"),
        ("phase", "applied"),
        ("save", "other.es3"),
    ],
)
def test_malformed_or_future_receipts_fail_closed(tmp_path, sample_save, field, value):
    path, before, root = prepare(tmp_path, sample_save)
    with storage.health_lock(path):
        tx = storage.HealthTransaction(path, OP)
        tx.prepare(before)
    raw = json.loads(tx.pending.read_text())
    raw[field] = value
    tx.pending.write_text(json.dumps(raw))
    assert recover_health(ID, OP, root)["transaction"]["status"] == "conflict"
    assert write(root, before, NEXT)["reason"] == "write_recovery_required"
    assert path.read_bytes() == before


def test_recovery_without_execution_does_not_claim_success(tmp_path, sample_save):
    path, before, root = prepare(tmp_path, sample_save)
    result = recover_health(ID, OP, root)["transaction"]
    assert result["status"] == "rejected"
    assert result["backupAvailable"] is False
    assert path.read_bytes() == before


def test_successful_recovery_cleans_only_the_interrupted_operations_temporary(
    tmp_path, sample_save
):
    path, before, root = prepare(tmp_path, sample_save)
    process = start(tmp_path, before, "verified")
    stop(process)
    unrelated = path.parent / ".unrelated.tmp"
    unrelated.write_bytes(b"keep this")
    result = recover_health(ID, OP, root)["transaction"]
    assert result["status"] == "unchanged"
    assert unrelated.read_bytes() == b"keep this"
    assert not storage.HealthTransaction(path, OP).temporary.exists()
    assert path.read_bytes() == before
    assert next(path.parent.glob("*.bak-*")).read_bytes() == before


def test_process_killed_before_execution_has_no_write_evidence(tmp_path, sample_save):
    path, before, root = prepare(tmp_path, sample_save)
    process = start(tmp_path, before, "before_execution")
    stop(process)
    assert write(root, before, NEXT)["reason"] == "write_recovery_required"
    assert recover_health(ID, OP, root)["transaction"]["status"] == "unchanged"
    assert write(root, before)["reason"] == "write_duplicate"
    assert path.read_bytes() == before
    assert not list(path.parent.glob("*.bak-*"))


def test_hardlinked_source_is_never_mutated(tmp_path, sample_save):
    path, before, root = prepare(tmp_path, sample_save)
    alias = path.parent / "unrelated.es3"
    os.link(path, alias)
    assert write(root, before)["reason"] == "write_conflict"
    assert path.read_bytes() == before
    assert alias.read_bytes() == before


def test_exact_original_restoration_after_replacement_is_conflict(tmp_path, sample_save):
    path, before, root = prepare(tmp_path, sample_save)
    process = start(tmp_path, before, "after_replace")
    stop(process)
    path.write_bytes(before)
    assert recover_health(ID, OP, root)["transaction"]["status"] == "conflict"
    assert write(root, before, NEXT)["reason"] == "write_recovery_required"
    assert path.read_bytes() == before


@pytest.mark.parametrize("stage", ["create_backup", "stage", "verified"])
def test_pre_replace_io_failure_keeps_intent_until_recovery(
    tmp_path, sample_save, monkeypatch, stage
):
    path, before, root = prepare(tmp_path, sample_save)

    def fail(*_args):
        raise OSError("private injected I/O failure")

    monkeypatch.setattr(storage.HealthTransaction, stage, fail)
    result = write(root, before)
    assert result["status"] == "uncertain"
    assert path.read_bytes() == before
    assert "private" not in json.dumps(result)
    assert write(root, before, NEXT)["reason"] == "write_recovery_required"
    legacy = saves.save_changes(
        ID,
        sha256(before).hexdigest(),
        change(),
        root,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
    )
    assert legacy["error"]["code"] == "save_stale"
    assert recover_health(ID, OP, root)["transaction"]["status"] == "busy"


def test_receipt_publication_failure_blocks_target_and_can_recover(
    tmp_path, sample_save, monkeypatch
):
    path, before, root = prepare(tmp_path, sample_save)
    original = storage._publish

    def fail_publish(*_args):
        raise OSError("publication failed")

    monkeypatch.setattr(storage, "_publish", fail_publish)
    assert write(root, before)["status"] == "uncertain"
    assert write(root, before, NEXT)["reason"] == "write_recovery_required"
    assert path.read_bytes() == before
    monkeypatch.setattr(storage, "_publish", original)
    assert recover_health(ID, OP, root)["transaction"]["status"] == "busy"
    assert list(path.parent.glob(".*.tmp"))


def test_partial_receipt_never_publishes_or_authorizes_a_write(tmp_path, sample_save, monkeypatch):
    path, before, root = prepare(tmp_path, sample_save)
    original = storage._flush_write

    def partial_receipt(target, data):
        original(target, data[: len(data) // 2])
        raise OSError("interrupted receipt creation")

    monkeypatch.setattr(storage, "_flush_write", partial_receipt)
    assert write(root, before)["status"] == "uncertain"
    assert write(root, before, NEXT)["reason"] == "write_recovery_required"
    assert recover_health(ID, OP, root)["transaction"]["status"] == "conflict"
    assert path.read_bytes() == before
    assert not list(path.parent.glob("*.bak-*"))
    assert not path.with_name(f".{path.name}.health-pending.json").exists()
    assert list(path.parent.glob(".*.receipt.tmp"))


@pytest.mark.parametrize(
    "phase",
    [
        "response_error",
        "backup_error",
        "staging_error",
        "verification_error",
        "receipt_publish_error",
    ],
)
def test_uncertain_response_requires_exited_owner_before_recovery(tmp_path, sample_save, phase):
    path, before, root = prepare(tmp_path, sample_save)
    process = start(tmp_path, before, phase, wait_phase=False)
    try:
        stdout, stderr = process.communicate(timeout=15)
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=10)
    assert process.returncode == 0
    assert stderr == b""
    assert json.loads(stdout)["transaction"]["status"] == "uncertain"
    applied = phase == "response_error"
    assert (path.read_bytes() != before) == applied
    assert write(root, path.read_bytes(), NEXT)["reason"] == "write_recovery_required"
    result = recover_health(ID, OP, root)["transaction"]
    assert result["status"] == ("applied" if applied else "unchanged")
    assert recover_health(ID, OP, root)["transaction"] == result
    assert not list(path.parent.glob(".*.tmp"))


def test_receipt_cannot_claim_original_bytes_as_a_verified_replacement(tmp_path, sample_save):
    path, before, root = prepare(tmp_path, sample_save)
    process = start(tmp_path, before, "verified")
    stop(process)
    transaction = storage.HealthTransaction(path, OP)
    raw = json.loads(transaction.pending.read_text())
    raw["after"] = raw["before"]
    raw["after_identity"] = raw["before_identity"]
    transaction.pending.write_text(json.dumps(raw))
    assert recover_health(ID, OP, root)["transaction"]["status"] == "conflict"
    assert write(root, before, NEXT)["reason"] == "write_recovery_required"
    assert path.read_bytes() == before
    assert transaction.backup.read_bytes() == before


@pytest.mark.parametrize("status", [GameProcessStatus.RUNNING, GameProcessStatus.UNKNOWN])
def test_authoritative_game_check_rejects_before_preparation(tmp_path, sample_save, status):
    path, before, root = prepare(tmp_path, sample_save)
    result = write_health(
        ID, sha256(before).hexdigest(), change(), OP, root, game_status_loader=lambda: status
    )["transaction"]
    assert result["status"] == "rejected"
    assert path.read_bytes() == before
    assert not list(path.parent.glob("*.bak-*"))
    assert not list(path.parent.glob("*.json"))


def test_damaged_backup_and_unowned_temporary_files_are_preserved(tmp_path, sample_save):
    path, before, root = prepare(tmp_path, sample_save)
    process = start(tmp_path, before, "after_replace")
    stop(process)
    backup = next(path.parent.glob("*.bak-*"))
    backup.write_bytes(b"damaged backup")
    other = path.parent / ".unrelated.tmp"
    other.write_bytes(b"not operation-owned")
    assert recover_health(ID, OP, root)["transaction"]["status"] == "conflict"
    assert backup.read_bytes() == b"damaged backup"
    assert other.read_bytes() == b"not operation-owned"
    assert write(root, path.read_bytes(), NEXT)["reason"] == "write_recovery_required"


@pytest.mark.parametrize("failure", ["stat", "scan"])
def test_unreadable_receipt_metadata_never_authorizes_mutation(
    tmp_path, sample_save, monkeypatch, failure
):
    path, before, root = prepare(tmp_path, sample_save)
    original_stat = Path.lstat
    original_scan = os.scandir

    def fail_stat(target, *args, **kwargs):
        if target.name.endswith(".health-pending.json"):
            raise PermissionError("private metadata path")
        return original_stat(target, *args, **kwargs)

    def fail_scan(target):
        if Path(target) == path.parent:
            raise PermissionError("private metadata directory")
        return original_scan(target)

    if failure == "stat":
        monkeypatch.setattr(Path, "lstat", fail_stat)
    else:
        monkeypatch.setattr(os, "scandir", fail_scan)
    with storage.health_lock(path):
        transaction = storage.HealthTransaction(path, OP)
        with pytest.raises(PermissionError):
            transaction.admit()
        with pytest.raises(PermissionError):
            transaction.recover()
    result = write(root, before)
    assert result["status"] == "rejected"
    assert "private" not in json.dumps(result)
    assert recover_health(ID, OP, root)["transaction"]["status"] == "conflict"
    legacy = saves.save_changes(
        ID,
        sha256(before).hexdigest(),
        change(),
        root,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
    )
    assert legacy["ok"] is False
    assert path.read_bytes() == before
    assert not list(path.parent.glob("*.bak-*"))
