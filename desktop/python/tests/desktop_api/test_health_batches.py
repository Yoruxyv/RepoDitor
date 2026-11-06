"""One bounded Health batch retains the shared transaction and recovery guarantees."""

import json
import os
import subprocess
import sys
import time
from copy import deepcopy
from hashlib import sha256
from pathlib import Path

import pytest

from repo_save_editor.core import save_resources as resources
from repo_save_editor.desktop_api import health_recovery as api
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.storage import health_recovery as storage
from repo_save_editor.storage.repository import SaveRepository

SAVE = "REPO_SAVE_2026_08_08_10_20_30"
OP = "a" * 32
OTHER = "b" * 32
WORKER = Path(__file__).resolve().parents[3] / "e2e/support/recovery-sidecar.py"
PYTHON = sys._base_executable if os.name == "nt" else sys.executable


@pytest.fixture
def fixture(tmp_path, sample_save, monkeypatch):
    root = tmp_path / "semiwork/Repo/saves"
    path = root / SAVE / f"{SAVE}.es3"
    SaveRepository(root).save_as(path, sample_save)
    monkeypatch.setattr(storage, "_owner_exited", lambda *_args: True)
    return root, path, path.read_bytes()


def edits():
    return [
        {"playerId": "111", "before": 80, "value": 17},
        {"playerId": "222", "before": 0, "value": 42},
    ]


def invoke(handler, fixture, changes=None, **kwargs):
    root, _path, before = fixture
    return handler(
        SAVE,
        sha256(before).hexdigest(),
        edits() if changes is None else changes,
        OP,
        root,
        health_batch=True,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
        **kwargs,
    )["transaction"]


@pytest.mark.parametrize("count", [1, 2])
def test_health_batch_has_one_backup_receipt_and_explicit_ack(fixture, sample_save, count):
    root, path, before = fixture
    changes = edits()[:count]
    assert invoke(api.prepare_health, fixture, changes)["status"] == "prepared"
    tx = storage.HealthTransaction(path, OP)
    assert json.loads(tx.pending.read_bytes())["version"] == 6
    assert invoke(api.write_health, fixture, changes, reserved=True)["status"] == "applied"
    expected = deepcopy(sample_save)
    health = expected["dictionaryOfDictionaries"]["value"]["playerHealth"]
    health.update({edit["playerId"]: edit["value"] for edit in changes})
    assert SaveRepository.load(path) == expected
    assert tx.backup.read_bytes() == before
    assert list(path.parent.glob("*.bak-*")) == [tx.backup]
    pending = tx.pending.read_bytes()
    assert api.health_state(SAVE, root)["pending"]["intent"] == {"health": changes}
    result = api.recover_health(SAVE, OP, root, canonical=True, acknowledge=False)["transaction"]
    assert result["status"] == "applied"
    assert result["backupAvailable"] is True
    assert {p["id"]: p["health"] for p in result["canonical"]["players"]} == {
        "111": 17,
        "222": 42 if count == 2 else 0,
    }
    assert tx.pending.read_bytes() == pending
    assert api.recover_health(SAVE, OP, root, canonical=True)["transaction"] == result
    assert not tx.pending.exists()
    assert tx.archive.exists()
    assert tx.backup.read_bytes() == before
    assert invoke(api.prepare_health, fixture, changes)["reason"] == "write_duplicate"


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        ({"playerId": "999"}, "save_validation_failed"),
        ({"before": 1}, "save_stale"),
        ({"value": 101}, "save_validation_failed"),
        ({"value": True}, "invalid_request"),
        ({"value": 1.5}, "invalid_request"),
        ({"value": -1}, "invalid_request"),
        ({"value": 2_147_483_648}, "invalid_request"),
        ({"before": True}, "invalid_request"),
        ({"before": 9_007_199_254_740_992}, "invalid_request"),
        ({"playerId": "../file"}, "invalid_request"),
        ({"field": "currency"}, "invalid_request"),
        ({"value": 0}, "invalid_request"),
    ],
)
def test_invalid_second_player_never_partially_prepares_or_replaces(fixture, mutation, reason):
    _root, path, before = fixture
    changes = edits()
    changes[-1].update(mutation)
    result = invoke(api.prepare_health, fixture, changes)
    assert result["status"] == "rejected"
    assert result["reason"] == reason
    assert path.read_bytes() == before
    assert not list(path.parent.glob("*.json"))
    assert not list(path.parent.glob("*.bak-*"))


def test_empty_duplicate_and_oversized_health_batches_are_rejected(fixture):
    _root, path, before = fixture
    for changes in (
        [],
        edits() * 2,
        [edits()[0]] * 513,
        [{"playerId": str(n), "before": 0, "value": 1} for n in range(100)],
    ):
        assert invoke(api.prepare_health, fixture, changes)["reason"] == "invalid_request"
    assert path.read_bytes() == before
    assert not list(path.parent.glob("*.json"))
    assert not list(path.parent.glob("*.bak-*"))


@pytest.mark.parametrize("delta", [-1, 0, 1])
def test_health_intent_boundary_fits_the_unchanged_receipt_envelope(delta):
    changes = [{"playerId": str(n), "before": 0, "value": 1} for n in range(40)]
    intent = {"health": changes}

    def size():
        return len(json.dumps(intent, separators=(",", ":")).encode())

    target = storage.HEALTH_INTENT_LIMIT + delta
    for edit in changes:
        edit["playerId"] = "0" * min(target - size(), 20 - len(edit["playerId"])) + edit["playerId"]
    assert size() == target
    assert storage.valid_health_batch_intent(intent) is (delta <= 0)
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
            version=6,
            namespace="c" * 64,
            intent=intent,
        )
        assert len(storage._receipt_bytes(receipt)) <= 3177 < 4096


def test_reservation_handoff_requires_the_entire_exact_health_intent(fixture):
    _root, path, before = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    changed = edits()
    changed[-1]["value"] = 43
    result = invoke(api.write_health, fixture, changed, reserved=True)
    assert result["status"] == "uncertain"
    assert result["reason"] == "invalid_request"
    assert path.read_bytes() == before
    tx = storage.HealthTransaction(path, OP)
    assert json.loads(tx.pending.read_bytes())["intent"] == {"health": edits()}
    assert not tx.backup.exists()


def test_changed_source_after_reservation_blocks_the_entire_batch(fixture, sample_save):
    root, path, before = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    tx = storage.HealthTransaction(path, OP)
    pending = tx.pending.read_bytes()
    SaveRepository(root).save_as(path, sample_save)
    replaced = path.read_bytes()
    assert replaced != before
    result = invoke(api.write_health, fixture, reserved=True)
    # Namespace/source admission rejects before claiming the reservation.
    assert result["status"] == "rejected"
    assert result["reason"] == "write_conflict"
    assert path.read_bytes() == replaced
    assert tx.pending.read_bytes() == pending
    assert not tx.backup.exists()


@pytest.mark.parametrize("artifact", ["path", "backup", "temporary"])
def test_batch_recovery_preserves_oversized_source_and_evidence(fixture, artifact, monkeypatch):
    root, path, before = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    tx = storage.HealthTransaction(path, OP)
    tx.create_backup(before)
    tx.stage(b"synthetic staged evidence")
    getattr(tx, artifact).write_bytes(b"x" * (len(before) + 1))
    evidence = {p.name: p.read_bytes() for p in path.parent.iterdir()}
    monkeypatch.setattr(resources, "ENCRYPTED_LIMIT", len(before))
    result = api.recover_health(SAVE, OP, root, canonical=True)["transaction"]
    assert result["status"] == "conflict"
    assert result["reason"] == "save_unsupported"
    assert {p.name: p.read_bytes() for p in path.parent.iterdir()} == evidence


def test_other_domains_and_legacy_health_cannot_borrow_a_batch_reservation(fixture):
    root, path, before = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    requests = [
        ([{"feature": "players", "entity": "111", "field": "health", "after": 17}], {}),
        (
            [{"playerId": "111", "key": "playerUpgradeStrength", "before": 2, "value": 3}],
            {"upgrade_batch": True},
        ),
        ([{"field": "currency", "before": 12, "value": 13}], {"run_batch": True}),
    ]
    for changes, mode in requests:
        result = api.write_health(
            SAVE,
            sha256(before).hexdigest(),
            changes,
            OP,
            root,
            reserved=True,
            game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
            **mode,
        )["transaction"]
        assert result["status"] == "uncertain"
        assert result["reason"] == "invalid_request"
        assert path.read_bytes() == before
    assert not storage.HealthTransaction(path, OP).backup.exists()


@pytest.mark.parametrize("version", [3, 4, 5])
def test_health_batch_cannot_be_relabelled_as_an_older_receipt(fixture, version):
    root, path, before = fixture
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


@pytest.mark.parametrize(
    "final", [GameProcessStatus.RUNNING, GameProcessStatus.UNKNOWN, "query_error"]
)
def test_final_game_check_blocks_the_entire_health_batch(fixture, final):
    root, path, before = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    calls = 0

    def status():
        nonlocal calls
        calls += 1
        if calls < 3:
            return GameProcessStatus.NOT_RUNNING
        if final == "query_error":
            raise OSError("Synthetic final query failure")
        return final

    result = api.write_health(
        SAVE,
        sha256(before).hexdigest(),
        edits(),
        OP,
        root,
        health_batch=True,
        reserved=True,
        game_status_loader=status,
    )["transaction"]
    assert result["status"] == "uncertain"
    assert result["reason"] == (
        "game_running" if final is GameProcessStatus.RUNNING else "game_status_unknown"
    )
    assert path.read_bytes() == before
    tx = storage.HealthTransaction(path, OP)
    assert tx.backup.read_bytes() == before
    assert json.loads(tx.pending.read_bytes())["phase"] == "verified"
    recovered = api.recover_health(SAVE, OP, root, canonical=True, acknowledge=False)["transaction"]
    assert recovered["status"] == "unchanged"
    assert tx.pending.exists()
    assert api.health_state(SAVE, root)["pending"]["intent"] == {"health": edits()}


@pytest.mark.parametrize("kind", ["health", "upgrades", "run"])
def test_existing_health_upgrade_and_run_receipts_still_complete(fixture, kind):
    root, path, before = fixture
    changes, mode, version = {
        "health": (
            [{"feature": "players", "entity": "111", "field": "health", "after": 17}],
            {"remember_intent": True},
            3 if os.name == "nt" else 2,
        ),
        "upgrades": (
            [{"playerId": "111", "key": "playerUpgradeStrength", "before": 2, "value": 3}],
            {"upgrade_batch": True},
            4,
        ),
        "run": ([{"field": "currency", "before": 12, "value": 13}], {"run_batch": True}, 5),
    }[kind]
    assert (
        api.prepare_health(
            SAVE,
            sha256(before).hexdigest(),
            changes,
            OP,
            root,
            game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
            **mode,
        )["transaction"]["status"]
        == "prepared"
    )
    tx = storage.HealthTransaction(path, OP)
    assert json.loads(tx.pending.read_bytes())["version"] == version
    mode.pop("remember_intent", None)
    assert (
        api.write_health(
            SAVE,
            sha256(before).hexdigest(),
            changes,
            OP,
            root,
            reserved=True,
            game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
            **mode,
        )["transaction"]["status"]
        == "applied"
    )
    assert api.recover_health(SAVE, OP, root, canonical=True)["transaction"]["status"] == "applied"
    assert tx.backup.read_bytes() == before


@pytest.mark.parametrize("phase", ["before_replace", "after_replace"])
def test_killed_health_batch_writer_recovers_all_values_without_replay(fixture, tmp_path, phase):
    root, path, before = fixture
    environment = {
        **os.environ,
        "REPODITOR_E2E": "1",
        "REPODITOR_E2E_LOCAL_APP_DATA_LOW": str(tmp_path),
        "REPODITOR_E2E_STEAM_ROOT": str(tmp_path / "SteamLibrary"),
        "REPODITOR_RECOVERY_SYNTHETIC_STATUS": "not_running",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    environment.pop("REPO_GAME_DIR", None)
    common = [SAVE, sha256(before).hexdigest(), json.dumps(edits())]
    prepared = subprocess.run(  # noqa: S603 -- fixed test interpreter/entry and synthetic arguments.
        [PYTHON, "-B", str(WORKER), "health-batch-prepare", *common, OP],
        env=environment,
        capture_output=True,
        check=True,
        timeout=15,
    )
    assert prepared.stderr == b""
    assert json.loads(prepared.stdout)["transaction"]["status"] == "prepared"
    marker = tmp_path / "phase.json"
    process = subprocess.Popen(  # noqa: S603 -- fixed test interpreter/entry and synthetic arguments.
        [PYTHON, "-B", str(WORKER), "saves-write", *common, "--health-batch-operation", OP],
        env={
            **environment,
            "REPODITOR_RECOVERY_PHASE": phase,
            "REPODITOR_RECOVERY_PHASE_FILE": str(marker),
        },
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        deadline = time.monotonic() + 15
        reached = None
        while process.poll() is None and time.monotonic() < deadline:
            try:
                reached = json.loads(marker.read_bytes())
            except (OSError, ValueError):
                reached = None
            if reached is not None:
                break
            time.sleep(0.01)
        assert reached is not None, "Synthetic writer never reached its interruption point"
        assert reached["phase"] == phase
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate(timeout=5)
    assert api.health_state(SAVE, root)["pending"]["intent"] == {"health": edits()}
    written = path.read_bytes()
    tx = storage.HealthTransaction(path, OP)
    assert tx.backup.read_bytes() == before
    result = api.recover_health(SAVE, OP, root, canonical=True, acknowledge=False)["transaction"]
    applied = phase == "after_replace"
    assert result["status"] == ("applied" if applied else "unchanged")
    assert {p["id"]: p["health"] for p in result["canonical"]["players"]} == {
        "111": 17 if applied else 80,
        "222": 42 if applied else 0,
    }
    assert path.read_bytes() == written
    assert tx.pending.exists()
    assert api.recover_health(SAVE, OP, root, canonical=True)["transaction"] == result
    assert not tx.pending.exists()
    assert path.read_bytes() == written
