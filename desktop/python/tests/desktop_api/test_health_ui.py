from __future__ import annotations

import json
import os
import subprocess
import sys
from copy import deepcopy
from hashlib import sha256
from pathlib import Path

import pytest

from repo_save_editor.desktop_api import health_recovery as api
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.storage.health_recovery import HealthTransaction
from repo_save_editor.storage.repository import SaveRepository

ID = "REPO_SAVE_2026_08_08_10_20_30"
OP = "a" * 32
PROJECT = Path(__file__).resolve().parents[4]
PYTHON = sys._base_executable if os.name == "nt" else sys.executable


@pytest.fixture
def fixture(tmp_path, sample_save):
    root = tmp_path / "semiwork/Repo/saves"
    path = root / ID / f"{ID}.es3"
    SaveRepository(root).save_as(path, sample_save)
    return path, path.read_bytes(), root


def command(home, *args):
    environment = {
        **os.environ,
        "REPODITOR_E2E": "1",
        "REPODITOR_E2E_LOCAL_APP_DATA_LOW": str(home),
        "REPODITOR_E2E_STEAM_ROOT": str(home / "SteamLibrary"),
        "REPODITOR_RECOVERY_SYNTHETIC_STATUS": "not_running",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    environment.pop("REPO_GAME_DIR", None)
    result = subprocess.run(  # noqa: S603 -- fixed test interpreter/entry and synthetic arguments.
        [PYTHON, "-B", str(PROJECT / "desktop/e2e/support/recovery-sidecar.py"), *args],
        cwd=PROJECT,
        env=environment,
        capture_output=True,
        check=True,
        timeout=15,
    )
    assert result.stderr == b""
    return json.loads(result.stdout)


def prepare(home, before, *, legacy=False):
    change = [{"feature": "players", "entity": "111", "field": "health", "after": 17}]
    args = ["health-prepare", ID, sha256(before).hexdigest(), json.dumps(change), OP]
    if not legacy:
        args.append("--intent")
    assert command(home, *args)["transaction"]["status"] == "prepared"


def test_intent_survives_restart_and_held_reconciliation(fixture, tmp_path):
    path, before, root = fixture
    prepare(tmp_path, before)
    transaction = HealthTransaction(path, OP)
    original_receipt = transaction.pending.read_bytes()
    restored = command(tmp_path, "health-state", ID)
    assert restored["state"] == "pending"
    assert restored["pending"] == {
        "operationId": OP,
        "fingerprint": sha256(before).hexdigest(),
        "intent": {"playerId": "111", "health": 17, "before": 80},
    }
    assert transaction.pending.read_bytes() == original_receipt
    recovered = api.recover_health(ID, OP, root, canonical=True, acknowledge=False)["transaction"]
    assert recovered["status"] == "unchanged"
    assert recovered["canonical"]["opened"]["session"]["fingerprint"] == sha256(before).hexdigest()
    assert recovered["canonical"]["players"][0]["health"] == 80
    assert transaction.pending.exists()
    assert transaction.archive.exists()
    assert command(tmp_path, "health-state", ID)["pending"] == restored["pending"]
    assert (
        api.recover_health(ID, OP, root, canonical=True, acknowledge=False)["transaction"]
        == recovered
    )
    assert path.read_bytes() == before
    assert not transaction.backup.exists()
    api.recover_health(ID, OP, root, canonical=True, acknowledge=True)
    assert not transaction.pending.exists()
    assert api.health_state(ID, root)["state"] == "idle"


def test_verified_health_canonical_and_exact_backup(fixture, tmp_path, sample_save):
    path, before, root = fixture
    prepare(tmp_path, before)
    change = [{"feature": "players", "entity": "111", "field": "health", "after": 17}]
    written = command(
        tmp_path,
        "saves-write",
        ID,
        sha256(before).hexdigest(),
        json.dumps(change),
        "--health-operation",
        OP,
    )
    assert written["transaction"]["status"] == "applied"
    tx = HealthTransaction(path, OP)
    assert tx.backup.read_bytes() == before
    expected = deepcopy(sample_save)
    expected["dictionaryOfDictionaries"]["value"]["playerHealth"]["111"] = 17
    assert SaveRepository.load(path) == expected
    state = api.health_state(ID, root)
    assert state["state"] == "pending"
    assert state["pending"]["intent"]["before"] == 80
    recovered = api.recover_health(ID, OP, root, canonical=True, acknowledge=False)["transaction"]
    assert recovered["status"] == "applied"
    assert recovered["backupAvailable"] is True
    assert (
        recovered["canonical"]["opened"]["session"]["fingerprint"]
        == sha256(path.read_bytes()).hexdigest()
    )
    assert recovered["canonical"]["players"][0]["health"] == 17
    assert tx.pending.exists()
    assert command(tmp_path, "health-state", ID)["pending"] == state["pending"]
    ack = api.recover_health(ID, OP, root, canonical=True, acknowledge=True)["transaction"]
    assert ack == recovered
    assert not tx.pending.exists()
    assert tx.backup.read_bytes() == before


def test_legacy_receipt_remains_readable_and_uses_its_original_schema(fixture, tmp_path):
    path, before, root = fixture
    prepare(tmp_path, before, legacy=True)
    tx = HealthTransaction(path, OP)
    assert "intent" not in json.loads(tx.pending.read_text())
    pending = api.health_state(ID, root)["pending"]
    assert pending["operationId"] == OP
    assert pending["intent"] is None
    assert (
        api.recover_health(ID, OP, root, canonical=True, acknowledge=False)["transaction"]["status"]
        == "unchanged"
    )
    assert "intent" not in json.loads(tx.archive.read_text())
    assert path.read_bytes() == before


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("playerId", "../111"),
        ("health", True),
        ("health", -1),
        ("health", 1.5),
        ("health", 2_147_483_648),
        ("before", -1),
        ("before", "80"),
        ("path", "private"),
    ],
)
def test_malformed_ui_intent_stays_blocked(fixture, tmp_path, key, value):
    path, before, root = fixture
    prepare(tmp_path, before)
    tx = HealthTransaction(path, OP)
    raw = json.loads(tx.pending.read_text())
    raw["intent"][key] = value
    tx.pending.write_text(json.dumps(raw))
    assert api.health_state(ID, root)["state"] == "blocked"
    assert (
        api.recover_health(ID, OP, root, canonical=True, acknowledge=False)["transaction"]["status"]
        == "conflict"
    )
    assert tx.pending.exists()
    assert path.read_bytes() == before


def test_partial_receipt_status_never_claims_idle(fixture):
    path, before, root = fixture
    tx = HealthTransaction(path, OP)
    tx.receipt_temp.write_bytes(b"{")
    assert api.health_state(ID, root)["state"] == "blocked"
    assert tx.receipt_temp.read_bytes() == b"{"
    assert path.read_bytes() == before


def test_orphan_receipt_cannot_report_a_different_operation_identity(fixture, tmp_path):
    path, before, root = fixture
    prepare(tmp_path, before)
    transaction = HealthTransaction(path, OP)
    other = HealthTransaction(path, "b" * 32)
    other.receipt_temp.write_bytes(transaction.pending.read_bytes())
    transaction.pending.unlink()
    assert api.health_state(ID, root)["state"] == "blocked"
    assert other.receipt_temp.exists()
    assert path.read_bytes() == before


def test_acknowledgement_rechecks_external_modification(
    fixture, tmp_path, monkeypatch, sample_save
):
    path, before, root = fixture
    prepare(tmp_path, before)
    original = api._canonical
    changed = deepcopy(sample_save)
    changed["teamName"]["value"] = "external owner"

    def change_after_projection(*args):
        result = original(*args)
        SaveRepository(root).save_as(path, changed)
        return result

    monkeypatch.setattr(api, "_canonical", change_after_projection)
    result = api.recover_health(ID, OP, root, canonical=True, acknowledge=True)["transaction"]
    assert result["status"] == "conflict"
    assert HealthTransaction(path, OP).pending.exists()
    assert SaveRepository.load(path) == changed
    assert path.read_bytes() != before


def test_reserved_writer_cannot_change_the_recorded_intent(fixture, tmp_path):
    path, before, root = fixture
    prepare(tmp_path, before)
    result = api.write_health(
        ID,
        sha256(before).hexdigest(),
        [{"feature": "players", "entity": "222", "field": "health", "after": 17}],
        OP,
        root,
        reserved=True,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
    )["transaction"]
    assert result["status"] == "uncertain"
    assert result["reason"] == "invalid_request"
    assert path.read_bytes() == before
    assert not HealthTransaction(path, OP).backup.exists()
