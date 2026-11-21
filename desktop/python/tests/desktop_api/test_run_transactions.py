"""Run batches retain exact intent, shared exclusion, and authoritative recovery."""

import json
from hashlib import sha256

import pytest

from repo_save_editor.desktop_api import health_recovery as api
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.storage import health_recovery as storage
from repo_save_editor.storage.repository import SaveRepository

SAVE = "REPO_SAVE_2026_08_08_10_20_30"
OP = "c" * 32


@pytest.fixture
def fixture(tmp_path, sample_save, monkeypatch):
    root = tmp_path / "semiwork/Repo/saves"
    path = root / SAVE / f"{SAVE}.es3"
    SaveRepository(root).save_as(path, sample_save)
    monkeypatch.setattr(storage, "_owner_exited", lambda *_args: True)
    return root, path, path.read_bytes()


def edits():
    return [
        {"field": "level", "before": 5, "value": 2**31},
        {"field": "currency", "before": 12, "value": -(2**31)},
        {"field": "lives", "before": 3, "value": -1},
        {"field": "totalHaul", "before": 500, "value": 2**31 - 1},
        {"field": "resumeLocation", "before": "Normal", "value": "Shop / Service Station"},
    ]


def invoke(handler, fixture, changes=None, **kwargs):
    root, _path, before = fixture
    return handler(
        SAVE,
        sha256(before).hexdigest(),
        edits() if changes is None else changes,
        OP,
        root,
        run_batch=True,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
        **kwargs,
    )["transaction"]


def test_five_fields_persist_with_exact_backup_and_versioned_recovery(fixture):
    root, path, before = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    tx = storage.HealthTransaction(path, OP)
    receipt = json.loads(tx.pending.read_bytes())
    assert receipt["version"] == 5
    assert receipt["intent"] == {"run": edits()}
    assert len(tx.pending.read_bytes()) < 4096
    assert api.health_state(SAVE, root)["pending"]["intent"] == {"run": edits()}
    assert invoke(api.write_health, fixture, reserved=True)["status"] == "applied"
    assert tx.backup.read_bytes() == before
    stored = SaveRepository.load(path)["dictionaryOfDictionaries"]["value"]
    assert stored["runStats"] == {
        "level": 2**31 - 1,
        "currency": -(2**31),
        "lives": -1,
        "totalHaul": 2**31 - 1,
        "save level": 1,
    }
    assert stored["playerHealth"] == {"111": 80}
    result = api.recover_health(SAVE, OP, root, canonical=True, acknowledge=False)["transaction"]
    assert result["status"] == "applied"
    assert result["canonical"]["run"]["stats"][0]["value"] == 2**31
    assert result["canonical"]["run"]["resumeLocation"]["value"] == "Shop / Service Station"
    assert tx.pending.exists()
    assert api.recover_health(SAVE, OP, root, canonical=True)["transaction"]["status"] == "applied"
    assert not tx.pending.exists()
    assert tx.archive.exists()
    assert invoke(api.prepare_health, fixture)["reason"] == "write_duplicate"


@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ([], "invalid_request"),
        (None, "invalid_request"),
        ([{"field": "currency", "before": 12, "value": 12}], "invalid_request"),
        ([{"field": "level", "before": 5, "value": 0}], "invalid_request"),
        ([{"field": "currency", "before": 12, "value": True}], "invalid_request"),
        ([{"field": "currency", "before": True, "value": 4}], "invalid_request"),
        ([{"field": "currency", "before": 12, "value": 1.5}], "invalid_request"),
        ([{"field": "currency", "before": 12, "value": "4"}], "invalid_request"),
        ([{"field": "currency", "before": 12, "value": 2**31}], "invalid_request"),
        ([{"field": "currency", "before": 12, "value": -(2**31) - 1}], "invalid_request"),
        ([{"field": "currency", "before": 2**53, "value": 4}], "invalid_request"),
        ([{"field": "../save", "before": 0, "value": 4}], "invalid_request"),
        ([{"field": "currency", "before": 12, "value": 4, "path": "forged"}], "invalid_request"),
        ([edits()[0], edits()[0]], "invalid_request"),
        (
            [{"field": "resumeLocation", "before": "Normal", "value": "Unknown (9)"}],
            "invalid_request",
        ),
        ([{"field": "currency", "before": 13, "value": 4}], "save_stale"),
        ([{"field": "resumeLocation", "before": "Unknown (9)", "value": "Normal"}], "save_stale"),
    ],
)
def test_invalid_and_stale_requests_preserve_source_and_create_no_evidence(
    fixture, changes, reason
):
    root, path, before = fixture
    result = api.prepare_health(
        SAVE,
        sha256(before).hexdigest(),
        changes,
        OP,
        root,
        run_batch=True,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
    )["transaction"]
    assert result == {
        "operationId": OP,
        "status": "rejected",
        "fingerprint": None,
        "backupAvailable": False,
        "reason": reason,
    }
    assert path.read_bytes() == before
    assert not list(path.parent.glob("*.json"))
    assert not list(path.parent.glob("*.bak-*"))


@pytest.mark.parametrize("raw", [True, "12", 1.5])
def test_coercible_original_is_not_mutation_authority(fixture, raw):
    root, path, _ = fixture
    data = SaveRepository.load(path)
    data["dictionaryOfDictionaries"]["value"]["runStats"]["currency"] = raw
    SaveRepository(root).save_as(path, data)
    before = path.read_bytes()
    result = invoke(
        api.prepare_health,
        (root, path, before),
        [{"field": "currency", "before": int(raw), "value": 20}],
    )
    assert result["reason"] == "save_validation_failed"
    assert path.read_bytes() == before


def test_inventory_unknown_resume_and_exact_safe_original(fixture):
    root, path, _ = fixture
    data = SaveRepository.load(path)
    stats = data["dictionaryOfDictionaries"]["value"]["runStats"]
    del stats["lives"]
    stats["save level"] = 9
    stats["currency"] = -(2**53 - 1)
    SaveRepository(root).save_as(path, data)
    before = path.read_bytes()
    f = root, path, before
    assert invoke(api.prepare_health, f, [edits()[2]])["reason"] == "save_validation_failed"
    changes = [{"field": "currency", "before": -(2**53 - 1), "value": -1}]
    assert invoke(api.prepare_health, f, changes)["status"] == "prepared"
    assert invoke(api.write_health, f, changes, reserved=True)["status"] == "applied"
    assert (
        SaveRepository.load(path)["dictionaryOfDictionaries"]["value"]["runStats"]["save level"]
        == 9
    )


@pytest.mark.parametrize("domain", ["health", "upgrades", "run"])
def test_pending_run_excludes_all_writer_domains_and_handoff_cannot_change_intent(fixture, domain):
    root, path, before = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    changes = {
        "health": [{"feature": "players", "entity": "111", "field": "health", "after": 17}],
        "upgrades": [{"playerId": "111", "key": "playerUpgradeStrength", "before": 2, "value": 3}],
        "run": [{"field": "currency", "before": 12, "value": 99}],
    }[domain]
    flags = {
        "upgrade_batch": domain == "upgrades",
        "run_batch": domain == "run",
        "game_status_loader": lambda: GameProcessStatus.NOT_RUNNING,
    }
    assert (
        api.prepare_health(SAVE, sha256(before).hexdigest(), changes, "d" * 32, root, **flags)[
            "transaction"
        ]["reason"]
        == "write_recovery_required"
    )
    assert (
        api.write_health(
            SAVE, sha256(before).hexdigest(), changes, OP, root, reserved=True, **flags
        )["transaction"]["reason"]
        == "invalid_request"
    )
    assert path.read_bytes() == before
    assert json.loads(storage.HealthTransaction(path, OP).pending.read_bytes())["intent"] == {
        "run": edits()
    }


@pytest.mark.parametrize("final", [GameProcessStatus.RUNNING, GameProcessStatus.UNKNOWN, "failure"])
def test_final_game_rejection_preserves_bytes_backup_and_unchanged_recovery(fixture, final):
    root, path, before = fixture
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    statuses = iter([GameProcessStatus.NOT_RUNNING, GameProcessStatus.NOT_RUNNING, final])

    def status():
        value = next(statuses)
        if value == "failure":
            raise OSError("synthetic status failure")
        return value

    result = api.write_health(
        SAVE,
        sha256(before).hexdigest(),
        edits(),
        OP,
        root,
        run_batch=True,
        reserved=True,
        game_status_loader=status,
    )["transaction"]
    assert result["status"] == "uncertain"
    assert result["reason"] == (
        "game_running" if final is GameProcessStatus.RUNNING else "game_status_unknown"
    )
    tx = storage.HealthTransaction(path, OP)
    assert tx.backup.read_bytes() == before
    assert path.read_bytes() == before
    assert (
        api.recover_health(SAVE, OP, root, canonical=True, acknowledge=False)["transaction"][
            "status"
        ]
        == "unchanged"
    )
    assert tx.pending.exists()


def test_stale_fingerprint_and_source_change_during_handoff(fixture):
    root, path, before = fixture
    assert invoke(api.prepare_health, (root, path, b"stale"))["reason"] == "save_stale"
    assert invoke(api.prepare_health, fixture)["status"] == "prepared"
    path.write_bytes(before + b"changed")
    assert invoke(api.write_health, fixture, reserved=True)["reason"] == "write_conflict"
    assert path.read_bytes() == before + b"changed"


def test_unknown_resume_changes_only_on_explicit_known_selection(fixture):
    root, path, _before = fixture
    data = SaveRepository.load(path)
    data["dictionaryOfDictionaries"]["value"]["runStats"]["save level"] = 9
    SaveRepository(root).save_as(path, data)
    before = path.read_bytes()
    request = [{"field": "resumeLocation", "before": "Unknown (9)", "value": "Normal"}]
    assert invoke(api.prepare_health, (root, path, before), request)["status"] == "prepared"
    assert path.read_bytes() == before
    assert (
        invoke(api.write_health, (root, path, before), request, reserved=True)["status"]
        == "applied"
    )
    assert (
        SaveRepository.load(path)["dictionaryOfDictionaries"]["value"]["runStats"]["save level"]
        == 0
    )


def test_unsafe_precision_original_cannot_match_a_rounded_request(fixture):
    root, path, _before = fixture
    data = SaveRepository.load(path)
    data["dictionaryOfDictionaries"]["value"]["runStats"]["totalHaul"] = 2**53 + 1
    SaveRepository(root).save_as(path, data)
    before = path.read_bytes()
    result = invoke(
        api.prepare_health,
        (root, path, before),
        [{"field": "totalHaul", "before": 2**53 - 1, "value": 19}],
    )
    assert result["reason"] == "save_stale"
    assert path.read_bytes() == before


def test_largest_five_field_intent_and_receipt_fit_existing_budgets():
    changes = edits()
    for edit in changes[:-1]:
        edit["before"] = 2**53 - 1
    changes[-1]["before"] = "x" * 64
    intent = {"run": changes}
    assert (
        len(json.dumps(intent, separators=(",", ":")).encode()) <= storage.RUN_INTENT_LIMIT == 512
    )
    assert storage.valid_run_intent(intent)
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
        version=5,
        namespace="c" * 64,
        intent=intent,
    )
    assert len(storage._receipt_bytes(receipt)) < 4096
    changes[-1]["before"] += "x"
    assert not storage.valid_run_intent(intent)
