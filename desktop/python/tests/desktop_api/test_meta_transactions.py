"""Disposable MetaSave persistence and recovery use independent, pinned admission."""

import json
import runpy
from copy import deepcopy
from hashlib import sha256
from pathlib import Path

import pytest

from repo_save_editor.core import save_resources
from repo_save_editor.core.crypto import _decrypt_plaintext, _encrypt_plaintext, decrypt_save
from repo_save_editor.desktop_api import meta_transactions as api
from repo_save_editor.desktop_api.cosmetics import save_cosmetics
from repo_save_editor.services.cosmetics import admission, synthetic_fixture
from repo_save_editor.services.cosmetics.synthetic_fixture import MANIFEST, PIN
from repo_save_editor.services.game.processes import GameProcessStatus as Status
from repo_save_editor.storage import health_recovery as storage
from repo_save_editor.storage.health_recovery import Receipt, _receipt_bytes

OP = "a" * 32
SOURCE = b"""{
 "cosmeticHistory":{"value":[27,999],"future":1.230000000000000000009},
 "cosmeticUnlocks":{"value":[27,999]},
 "cosmeticEquipped":{"value":[]},
 "cosmeticPresets":{"value":[[],[]]},
 "colorPresets":{"value":[[1,2,3],[]]},
 "future":{"value":90071992547409931234567890,"decimal":1.230000000000000000009}
}"""


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    project = Path(__file__).resolve().parents[4]
    create = runpy.run_path(
        str(project / "desktop/e2e/fixture_generators/create-meta-cosmetics-fixture.py")
    )["create"]
    game = create(tmp_path)
    root = tmp_path / "AppData/LocalLow/semiwork/Repo/saves"
    root.mkdir(parents=True)
    path = root.parent / "MetaSave.es3"
    path.write_bytes(_encrypt_plaintext(SOURCE))
    monkeypatch.setattr(storage, "_owner_exited", lambda *_args: True)
    return root, path, path.read_bytes(), game


def intent(fixture, action="unlockIds", ids=None):
    root, _path, _before, _game = fixture
    proof, _catalog = admission.admit_cosmetics(root.parents[2])
    value = {"action": action, "admission": proof["digest"]}
    if action == "unlockIds":
        value["ids"] = [0, 2] if ids is None else ids
    return {"metaCosmetics": value}


def write(fixture, value, prepare=False, **kwargs):
    root, _path, before, _game = fixture
    return api.meta_write(
        root,
        OP,
        sha256(before).hexdigest(),
        value,
        namespace=api.meta_state(root)["namespace"],
        prepare=prepare,
        game_status_loader=kwargs.pop("game_status_loader", lambda: Status.NOT_RUNNING),
        **kwargs,
    )


def test_actual_fixture_anchor_and_admission_are_source_pinned(fixture, monkeypatch):
    assert sha256(MANIFEST).hexdigest() == PIN
    root, _path, _before, _game = fixture
    proof, catalog = admission.admit_cosmetics(root.parents[2])
    assert proof["manifest"] == PIN
    assert [c.cosmetic_id for c in catalog] == list(range(28))
    monkeypatch.setattr(admission, "MANIFEST", MANIFEST + b" ")
    with pytest.raises(ValueError, match="anchor"):
        admission.admit_cosmetics(root.parents[2])


@pytest.mark.parametrize("action", ["unlockIds", "unlockAll", "lockAll", "clearPresets"])
def test_actions_preserve_exact_backup_unrelated_bytes_and_recover_without_replay(fixture, action):
    root, path, before, _game = fixture
    value = intent(fixture, action)
    assert write(fixture, value, prepare=True)["status"] == "prepared"
    tx = storage.HealthTransaction(path, OP)
    receipt = json.loads(tx.pending.read_bytes())
    assert receipt["version"] == 8
    assert receipt["namespace"] is not None
    assert write(fixture, value)["status"] == "applied"
    assert tx.backup.read_bytes() == before
    plain = _decrypt_plaintext(path.read_bytes())
    assert (
        b'"future":{"value":90071992547409931234567890,"decimal":1.230000000000000000009}' in plain
    )
    assert b'"future":1.230000000000000000009' in plain
    data = decrypt_save(path.read_bytes())
    assert 999 in data["cosmeticUnlocks"]["value"]
    if action == "unlockIds":
        assert data["cosmeticUnlocks"]["value"] == [27, 999, 0, 2]
    if action == "lockAll":
        assert data["cosmeticUnlocks"]["value"] == [999]
    if action == "clearPresets":
        assert data["colorPresets"]["value"] == [[], []]
        assert data["cosmeticPresets"]["value"] == [[], []]
    evidence = tx.pending.read_bytes()
    state = api.meta_state(root)
    assert state["state"] == "pending"
    assert tx.pending.read_bytes() == evidence
    written = path.read_bytes()
    assert api.meta_recover(root, OP, state["pending"]["proof"])["status"] == "applied"
    assert path.read_bytes() == written
    assert not tx.pending.exists()
    state = api.meta_state(root, OP)
    assert api.meta_recover(root, OP, state["pending"]["proof"])["status"] == "applied"
    assert write(fixture, value, prepare=True)["reason"] == "write_duplicate"


@pytest.mark.parametrize(
    "ids", [[999], [1, 999], [1, 1], [True], [1.5], [-1], [9007199254740992], list(range(513))]
)
def test_invalid_or_unknown_ids_never_partially_prepare(fixture, ids):
    _root, path, before, _game = fixture
    result = write(fixture, intent(fixture, ids=ids), prepare=True)
    assert result["status"] == "rejected"
    assert path.read_bytes() == before
    assert not list(path.parent.glob("*.json"))
    assert not list(path.parent.glob("*.bak-*"))


@pytest.mark.parametrize("damage", ["build", "assembly", "catalog", "missing", "external-anchor"])
def test_fixture_controlled_inputs_cannot_select_their_own_trust(fixture, damage):
    root, path, before, game = fixture
    value = intent(fixture)
    if damage == "build":
        manifest = game.parents[1] / "appmanifest_3241660.acf"
        manifest.write_bytes(manifest.read_bytes().replace(b"26294889", b"99999999"))
    elif damage == "external-anchor":
        (game / "manifest.json").write_text(json.dumps({"manifest": "f" * 64}))
        value["metaCosmetics"]["admission"] = "f" * 64
    else:
        p = game / (
            "REPO_Data/Managed/Assembly-CSharp.dll" if damage == "assembly" else "REPO_Data/level0"
        )
        if damage == "missing":
            p.rename(p.with_suffix(".hidden"))
        else:
            p.write_bytes(p.read_bytes() + b"changed")
    state = api.meta_state(root)
    if damage == "external-anchor":
        assert state["admission"]["manifest"] == PIN
        assert state["admission"]["digest"] != value["metaCosmetics"]["admission"]
    else:
        assert state["admission"] is None
    assert write(fixture, value, prepare=True)["status"] == "rejected"
    assert path.read_bytes() == before


def test_catalog_unavailable_recovery_does_not_grant_fresh_admission(fixture):
    root, path, before, game = fixture
    value = intent(fixture)
    assert write(fixture, value, prepare=True)["status"] == "prepared"
    level = game / "REPO_Data/level0"
    level.rename(level.with_suffix(".hidden"))
    tx = storage.HealthTransaction(path, OP)
    pending = tx.pending.read_bytes()
    state = api.meta_state(root)
    assert state["state"] == "pending"
    assert state["admission"] is None
    assert state["view"]["capabilities"]["canUnlockAll"] is False
    assert tx.pending.read_bytes() == pending
    assert api.meta_recover(root, OP, state["pending"]["proof"])["status"] == "unchanged"
    assert path.read_bytes() == before
    assert write(fixture, value, prepare=True)["status"] == "rejected"


def test_changed_recovery_evidence_and_legacy_writes_fail_closed(fixture):
    root, path, before, _game = fixture
    assert write(fixture, intent(fixture), prepare=True)["status"] == "prepared"
    state = api.meta_state(root)
    result = save_cosmetics(
        sha256(before).hexdigest(), [], root, game_status_loader=lambda: Status.NOT_RUNNING
    )
    assert result["ok"] is False
    tx = storage.HealthTransaction(path, OP)
    pending = tx.pending.read_bytes()
    tx.backup.write_bytes(b"damaged")
    assert api.meta_recover(root, OP, state["pending"]["proof"])["status"] == "conflict"
    assert tx.pending.read_bytes() == pending
    assert tx.backup.read_bytes() == b"damaged"
    assert path.read_bytes() == before


@pytest.mark.parametrize("final", [Status.NOT_RUNNING, Status.RUNNING, Status.UNKNOWN, "failure"])
def test_final_admission_then_game_query_then_replace(fixture, monkeypatch, final):
    _root, path, before, _game = fixture
    value = intent(fixture)
    assert write(fixture, value, prepare=True)["status"] == "prepared"
    events = []
    verified = False
    original = storage.HealthTransaction.verified
    admit = api.admit_cosmetics

    def verify(tx, written):
        nonlocal verified
        original(tx, written)
        verified = True

    def admission_after_stage(low):
        if verified:
            events.append("admission")
        return admit(low)

    def status():
        if verified:
            events.append("game")
            if final == "failure":
                raise OSError("private query failure")
            return final
        return Status.NOT_RUNNING

    monkeypatch.setattr(storage.HealthTransaction, "verified", verify)
    monkeypatch.setattr(api, "admit_cosmetics", admission_after_stage)
    result = write(fixture, value, game_status_loader=status)
    assert events == ["admission", "game"]
    assert result["status"] == ("applied" if final == Status.NOT_RUNNING else "uncertain")
    if final != Status.NOT_RUNNING:
        assert path.read_bytes() == before
        assert storage.HealthTransaction(path, OP).backup.read_bytes() == before


@pytest.mark.parametrize("phase", ["backup", "stage", "verify"])
def test_partial_failure_preserves_source_and_recovery_evidence(fixture, monkeypatch, phase):
    _root, path, before, _game = fixture
    value = intent(fixture)
    assert write(fixture, value, prepare=True)["status"] == "prepared"

    def fail(*_args):
        raise OSError("private synthetic failure")

    monkeypatch.setattr(
        storage.HealthTransaction,
        {"backup": "create_backup", "stage": "stage", "verify": "verified"}[phase],
        fail,
    )
    result = write(fixture, value)
    assert result["status"] == "uncertain"
    assert "private" not in str(result)
    assert path.read_bytes() == before
    assert storage.HealthTransaction(path, OP).pending.exists()


def test_reserved_intent_stale_source_and_cross_domain_receipts_are_rejected(fixture):
    root, path, before, _game = fixture
    value = intent(fixture)
    assert write(fixture, value, prepare=True)["status"] == "prepared"
    altered = deepcopy(value)
    altered["metaCosmetics"]["ids"] = [3]
    assert write(fixture, altered)["status"] == "uncertain"
    assert path.read_bytes() == before
    tx = storage.HealthTransaction(path, OP)
    receipt = json.loads(tx.pending.read_bytes())
    for version in range(1, 8):
        damaged = {**receipt, "version": version}
        tx.pending.write_text(json.dumps(damaged))
        assert api.meta_state(root)["state"] == "blocked"
    tx.pending.write_text(json.dumps(receipt))
    run = path.with_name("Run.es3")
    with pytest.raises(storage.RecoveryError):
        storage.HealthTransaction(run, OP, intent=value)


def test_python_packaging_verifies_the_independent_rust_pin(monkeypatch):
    project = Path(__file__).resolve().parents[4]
    check = project / "desktop/scripts/tauri/check-meta-anchor.py"
    runpy.run_path(str(check))
    monkeypatch.setattr(synthetic_fixture, "PIN", "f" * 64)
    with pytest.raises(SystemExit, match="disagree"):
        runpy.run_path(str(check))


def test_catalog_changed_after_staging_aborts_before_final_game_query(fixture, monkeypatch):
    _root, path, before, game = fixture
    value = intent(fixture)
    assert write(fixture, value, prepare=True)["status"] == "prepared"
    verified = storage.HealthTransaction.verified
    staged = False
    observations = []

    def verify(tx, written):
        nonlocal staged
        verified(tx, written)
        staged = True
        level = game / "REPO_Data/level0"
        level.write_bytes(level.read_bytes() + b"changed")

    def status():
        observations.append(staged)
        return Status.NOT_RUNNING

    monkeypatch.setattr(storage.HealthTransaction, "verified", verify)
    assert write(fixture, value, game_status_loader=status)["status"] == "uncertain"
    assert observations == [False]
    assert path.read_bytes() == before
    assert storage.HealthTransaction(path, OP).backup.read_bytes() == before


def test_live_owner_blocks_inspection_without_modifying_evidence(fixture, monkeypatch):
    root, path, before, _game = fixture
    value = intent(fixture)
    assert write(fixture, value, prepare=True)["status"] == "prepared"
    tx = storage.HealthTransaction(path, OP)
    pending = tx.pending.read_bytes()
    monkeypatch.setattr(storage, "_owner_exited", lambda *_args: False)
    assert api.meta_state(root)["state"] == "busy"
    assert tx.pending.read_bytes() == pending
    assert path.read_bytes() == before


def test_meta_namespace_and_stale_fingerprint_are_independently_required(fixture):
    root, path, before, _game = fixture
    value = intent(fixture)
    result = api.meta_write(
        root,
        OP,
        sha256(before).hexdigest(),
        value,
        namespace="f" * 64,
        prepare=True,
        game_status_loader=lambda: Status.NOT_RUNNING,
    )
    assert result["reason"] == "write_conflict"
    namespace = api.meta_state(root)["namespace"]
    result = api.meta_write(
        root,
        OP,
        "f" * 64,
        value,
        namespace=namespace,
        prepare=True,
        game_status_loader=lambda: Status.NOT_RUNNING,
    )
    assert result["reason"] == "save_stale"
    assert path.read_bytes() == before
    assert not list(path.parent.glob("*.json"))


def test_meta_intents_keep_the_existing_receipt_and_numeric_bounds():
    value = {
        "metaCosmetics": {"action": "unlockIds", "admission": "a" * 64, "ids": list(range(457))}
    }
    assert storage.valid_meta_intent(value)
    receipt = Receipt(
        OP,
        "MetaSave.es3",
        "a" * 64,
        [2**64] * 4,
        2**32 - 1,
        2**64 - 1,
        after="b" * 64,
        after_identity=[2**64] * 4,
        phase="verified",
        version=8,
        intent=value,
        namespace="c" * 64,
    )
    assert len(_receipt_bytes(receipt)) < 4096
    for field, bad in [
        ("ids", [True]),
        ("ids", [1.1]),
        ("ids", []),
        ("unexpected", True),
        ("admission", "f" * 2049),
    ]:
        damaged = deepcopy(value)
        damaged["metaCosmetics"][field] = bad
        assert not storage.valid_meta_intent(damaged)


def test_recovery_receipt_proofs_do_not_consume_encrypted_save_budget(fixture, monkeypatch):
    root, path, before, _game = fixture
    value = intent(fixture)
    assert write(fixture, value, prepare=True)["status"] == "prepared"
    assert write(fixture, value)["status"] == "applied"
    monkeypatch.setattr(
        save_resources, "ENCRYPTED_OPERATION_LIMIT", len(before) + path.stat().st_size
    )
    with save_resources.save_operation() as budget:
        state = api.meta_state(root)
        assert state["state"] == "pending"
        assert len(budget.encrypted) == 2
        assert api.meta_recover(root, OP, state["pending"]["proof"])["status"] == "applied"
