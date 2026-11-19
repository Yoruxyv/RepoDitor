from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from repo_save_editor.desktop_api import production_health as admission
from repo_save_editor.services.game.discovery import (
    APP_MANIFEST_NAME,
    CATALOG_RELATIVE_PATH,
    discover_game_installation,
)
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.services.saves.private_health import Bundle
from repo_save_editor.storage import health_recovery as storage
from repo_save_editor.storage.repository import SaveRepository

SAVE = "REPO_SAVE_2026_08_08_10_20_30"
OPERATION = "a" * 32


def test_unqualified_production_boundary_does_not_discover_a_save(monkeypatch):
    def unexpected():
        raise AssertionError("An unqualified build must not reach the save namespace")

    monkeypatch.setattr(admission, "get_default_save_root", unexpected)
    assert admission.production_health("state", SAVE) == {"ok": True, "state": "disabled"}
    assert (
        admission.production_health("write", SAVE, OPERATION)["transaction"]["reason"]
        == "save_unsupported"
    )


@pytest.mark.parametrize(
    ("change", "expected"),
    [
        ("unchanged", {"health"}),
        ("manifest-only", set()),
        ("managed-source", set()),
        ("presentation-only", {"health"}),
        ("run-only", {"run"}),
    ],
)
def test_write_admission_requires_the_reviewed_build_sources_and_domain(
    tmp_path, monkeypatch, change, expected
):
    steam = tmp_path / "Steam"
    game = steam / "steamapps/common/REPO"
    catalog = game / CATALOG_RELATIVE_PATH
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")
    manifest = steam / "steamapps" / APP_MANIFEST_NAME
    build_id = "26732418" if change == "manifest-only" else "26732417"
    manifest.write_text(
        f'"appid" "3241660"\n"installdir" "REPO"\n"buildid" "{build_id}"\n',
        encoding="utf-8",
    )
    for name in admission.HEALTH_BUILD_SOURCES:
        source = game / name
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(name.encode())
    pins = tuple(sha256(name.encode()).hexdigest() for name in admission.HEALTH_BUILD_SOURCES)
    picture = game / "REPO_Data/StreamingAssets/BakedIcons/Items/fixture.png"
    picture.parent.mkdir(parents=True)
    picture.write_bytes(b"presentation v1")
    if change == "presentation-only":
        picture.write_bytes(b"presentation v2")
    if change == "managed-source":
        (game / "REPO_Data/Managed/Assembly-CSharp.dll").write_bytes(b"changed writer code")

    monkeypatch.delenv("REPODITOR_E2E", raising=False)
    monkeypatch.setattr(admission, "platform", "win32")
    monkeypatch.setattr(
        admission,
        "discover_game_installation",
        lambda: discover_game_installation(steam_roots=(steam,), environment={}),
    )
    monkeypatch.setattr(
        admission, "APPROVED_HEALTH_BUILDS", {} if change == "run-only" else {"26732417": pins}
    )
    monkeypatch.setattr(
        admission,
        "APPROVED_RUN_BUILDS",
        {"26732417": (pins, frozenset({"run"}))} if change == "run-only" else {},
    )
    installed, build = admission._installed_game()
    assert build.build_id == build_id
    assert (admission._source_pins(installed, build) == pins) == (change != "managed-source")

    if not expected:
        with pytest.raises(admission.RecoveryError) as denied:
            admission._game()
        assert denied.value.code == "save_unsupported"
        return

    _, _, domains = admission._game()
    assert domains == expected
    health = {"health": [{"playerId": "111", "before": 80, "value": 79}]}
    run = {"run": [{"field": "currency", "before": 12, "value": 13}]}
    allowed, blocked = (health, run) if "health" in expected else (run, health)
    assert admission._admit_request(allowed, "a" * 64, domains, None) in expected
    with pytest.raises(admission.RecoveryError) as denied:
        admission._admit_request(blocked, "a" * 64, domains, None)
    assert denied.value.code == "save_unsupported"


@pytest.mark.parametrize(
    ("private_session", "storage_kind", "status"),
    [
        (True, "missing player", "applied"),
        (True, "missing dictionary", "applied"),
        (True, "malformed player", "rejected"),
        (True, "malformed dictionary", "rejected"),
        (False, "missing player", "rejected"),
    ],
)
def test_private_health_edit_uses_zero_only_for_absent_fields(
    tmp_path, sample_save, monkeypatch, private_session, storage_kind, status
):
    values = sample_save["dictionaryOfDictionaries"]["value"]
    if storage_kind == "missing dictionary":
        del values["playerHealth"]
    elif storage_kind == "malformed dictionary":
        values["playerHealth"] = None
    elif storage_kind == "malformed player":
        values["playerHealth"]["111"] = False
    else:
        del values["playerHealth"]["111"]

    root = tmp_path / "saves"
    target = root / SAVE / f"{SAVE}.es3"
    SaveRepository(root).save_as(target, sample_save)
    original = target.read_bytes()
    bundle = Bundle(tmp_path, b"", "901", (), session=True) if private_session else None
    monkeypatch.setattr(admission, "private_bundle", lambda: bundle)
    monkeypatch.setattr(admission, "get_default_save_root", lambda: root)
    monkeypatch.setattr(admission, "_game", lambda: (tmp_path / "REPO.exe", "901", {"health"}))
    monkeypatch.setattr(
        admission,
        "verified_private_game",
        lambda *_: (SimpleNamespace(root=tmp_path), SimpleNamespace(build_id="901")),
    )
    monkeypatch.setattr(admission, "_process_status", lambda *_: GameProcessStatus.NOT_RUNNING)

    result = admission.production_health(
        "apply",
        SAVE,
        OPERATION,
        sha256(original).hexdigest(),
        {"health": [{"playerId": "111", "before": 0, "value": 100}]},
        publication_allowed=lambda: True,
    )["transaction"]
    assert result["status"] == status
    backups = list(target.parent.glob("*.bak-health-*"))
    if status == "rejected":
        assert result["reason"] == "save_validation_failed"
        assert target.read_bytes() == original
        assert backups == []
        return

    assert len(backups) == 1
    assert backups[0].read_bytes() == original
    values.setdefault("playerHealth", {})["111"] = 100
    assert SaveRepository.load(target) == sample_save


@pytest.mark.parametrize("mixed", [False, True])
@pytest.mark.parametrize("apply", [False, True])
def test_production_transaction_reconciles_from_another_process(
    tmp_path, sample_save, mixed, apply
):
    key = "Item Melee Inflatable Hammer/1"
    values = sample_save["dictionaryOfDictionaries"]["value"]
    if mixed:
        values["item"] = {key: 21}
        values["itemStatBattery"] = {key: 99}

    root = tmp_path / "saves"
    save = root / SAVE / f"{SAVE}.es3"
    SaveRepository(root).save_as(save, sample_save)
    original = save.read_bytes()
    fingerprint = sha256(original).hexdigest()
    steam = tmp_path / "Steam"
    game = steam / "steamapps/common/REPO"
    catalog = game / CATALOG_RELATIVE_PATH
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")
    manifest = steam / "steamapps" / APP_MANIFEST_NAME
    manifest.write_text(
        '"appid" "3241660"\n"installdir" "REPO"\n"buildid" "901"\n', encoding="utf-8"
    )
    assembly = game / "REPO_Data/Managed/Assembly-CSharp.dll"
    assembly.parent.mkdir(parents=True)
    for name in admission.HEALTH_BUILD_SOURCES:
        (game / name).write_bytes(name.encode("utf-8"))
    worker = """
import json, sys
from functools import partial
from hashlib import sha256
from pathlib import Path
from repo_save_editor.desktop_api import health_recovery as transactions
from repo_save_editor.desktop_api import production_health as health
from repo_save_editor.services.items.models import ItemRechargeCapability
from repo_save_editor.services.game.discovery import discover_game_installation
from repo_save_editor.services.game.processes import ProcessInspection
root, steam, game = map(Path, sys.argv[1:4])
health.platform = "win32"
health.APPROVED_HEALTH_BUILDS = {"901": tuple(sha256(name.encode()).hexdigest() for name in health.HEALTH_BUILD_SOURCES)}
health.APPROVED_RUN_BUILDS = {"901": (health.APPROVED_HEALTH_BUILDS["901"], frozenset({"upgrades", "run", "refillToFull"}))}
capabilities = lambda names: {name: ItemRechargeCapability.RECHARGEABLE for name in names}
health.prepare_health = partial(health.prepare_health, recharge_capability_loader=capabilities)
health.write_health = partial(health.write_health, recharge_capability_loader=capabilities)
transactions.serialize_advanced_save = partial(transactions.serialize_advanced_save, capability_loader=capabilities)
if sys.argv[4] == "health-only":
    health.APPROVED_RUN_BUILDS = {}
health.discover_game_installation = lambda: discover_game_installation(steam_roots=(steam,), environment={})
health.get_default_save_root = lambda: root
health.inspect_windows_processes = lambda executable: ProcessInspection(
    (executable,) if sys.argv[4] == "running" else (),
    has_unverifiable_candidate=sys.argv[4] == "unknown",
)
def publication():
    if sys.argv[4] == "build-replaced":
        (game / health.HEALTH_BUILD_SOURCES[-1]).write_bytes(b"unreviewed replacement")
    return sys.argv[4] != "closed-editor"
print(json.dumps(health.production_health(*sys.argv[5:9], json.loads(sys.argv[9]), publication_allowed=publication)))
"""
    payload = {"health": [{"playerId": "111", "before": 80, "value": 79}]}

    if mixed:
        payload = {
            "mixed": {
                **payload,
                "upgrades": [
                    {"playerId": "111", "key": "playerUpgradeStrength", "before": 2, "value": 3}
                ],
                "run": [{"field": "currency", "before": 12, "value": -19}],
                "refillToFull": [{"saveKey": key, "before": 99}],
            }
        }

    operation = OPERATION

    def command(action, status="closed", changes=payload):
        env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[2])}
        env.pop("REPODITOR_E2E", None)
        # The interpreter and inline worker are fixed; fixture arguments are data.
        output = subprocess.check_output(  # noqa: S603
            [
                sys.executable,
                "-B",
                "-c",
                worker,
                str(root),
                str(steam),
                str(game),
                status,
                action,
                SAVE,
                operation,
                fingerprint,
                json.dumps(changes),
            ],
            env=env,
            timeout=15,
        )
        return json.loads(output)["transaction"]

    if mixed:
        assert command("prepare", "health-only")["reason"] == "save_unsupported"
        invalid = {**payload["mixed"], "run": [{"field": "currency", "before": 13, "value": 1}]}
        assert command("prepare", changes={"mixed": invalid})["reason"] == "save_stale"
        assert save.read_bytes() == original
        assert list(save.parent.glob("*.bak-*")) == []
    assert command("prepare", "running")["reason"] == "game_running"
    assert command("prepare", "unknown")["reason"] == "game_status_unknown"
    assert (
        command("prepare", changes=[{"feature": "run", "value": 2}])["reason"] == "invalid_request"
    )
    assembly.write_bytes(b"unreviewed managed assembly")
    assert command("prepare")["reason"] == "save_unsupported"
    assembly.write_bytes(b"REPO_Data/Managed/Assembly-CSharp.dll")
    assert save.read_bytes() == original
    if apply:
        assert command("apply", "closed-editor")["reason"] == "write_recovery_required"
        assert save.read_bytes() == original
        assert list(save.parent.glob("*.bak-*")) == []
        assert command("acknowledge")["status"] == "unchanged"
        # Each authorization is one operation; a recovered ID cannot be replayed.
        assert command("apply")["reason"] == "write_duplicate"
        operation = "b" * 32
        assert command("apply", "build-replaced")["reason"] == "save_unsupported"
        assert save.read_bytes() == original
        (game / admission.HEALTH_BUILD_SOURCES[-1]).write_bytes(
            admission.HEALTH_BUILD_SOURCES[-1].encode()
        )
        assert command("acknowledge")["status"] == "unchanged"
        operation = "c" * 32
        assert command("apply")["status"] == "applied"
    else:
        assert command("prepare")["status"] == "prepared"
        assert command("write")["status"] == "applied"
    inspected = command("inspect")
    assert inspected["status"] == "applied"
    assert inspected["backupAvailable"] is True
    assert inspected["canonical"]["opened"]["session"]["fingerprint"] == inspected["fingerprint"]
    if mixed:
        assert command("acknowledge", "health-only")["reason"] == "save_unsupported"
        canonical = inspected["canonical"]
        assert canonical["advanced"]["items"][0]["chargeState"] == "default_full"
        assert (
            next(stat for stat in canonical["run"]["stats"] if stat["key"] == "currency")["value"]
            == -19
        )
    settled = command("acknowledge")
    assert settled == inspected
    assert command("inspect") == settled
    assert next(save.parent.glob("*.bak-health-*")).read_bytes() == original
    assert not list(save.parent.glob("*.health-pending.json"))
    values["playerHealth"]["111"] = 79
    if mixed:
        values["playerUpgradeStrength"]["111"] = 3
        values["runStats"]["currency"] = -19
        del values["itemStatBattery"][key]
    assert SaveRepository.load(save) == sample_save


@pytest.mark.parametrize("live", [False, True])
def test_private_approval_is_required_and_bound_to_one_unchanged_file(
    tmp_path, sample_save, monkeypatch, live
):

    key = Ed25519PrivateKey.generate()
    public = key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )
    bundle = Bundle(tmp_path, public, "26407089", ("a" * 64,), live)
    low = tmp_path / "normal/AppData/LocalLow" if live else bundle.local_low
    root = low / "semiwork/Repo/saves"
    target = root / SAVE / f"{SAVE}.es3"
    SaveRepository(root).save_as(target, sample_save)
    source = target.read_bytes()
    with storage.health_lock(target) as directory:
        fingerprint, identity = storage._snapshot(target, directory)
        namespace = storage.HealthTransaction(target, OPERATION, directory=directory).namespace()
    monkeypatch.setattr(admission, "private_bundle", lambda: bundle)
    monkeypatch.setattr(admission, "get_default_save_root", lambda: root)
    monkeypatch.setattr(
        admission,
        "_installed_game",
        lambda: (SimpleNamespace(root=tmp_path), SimpleNamespace(build_id=bundle.build)),
    )
    monkeypatch.setattr(admission, "_source_pins", lambda *_: bundle.source_pins)
    monkeypatch.setattr(admission, "_process_status", lambda *_: GameProcessStatus.NOT_RUNNING)
    monkeypatch.setattr(storage, "_owner_exited", lambda *_: True)
    ticket = tmp_path / "approval.json"
    edit = {"playerId": "111", "before": 80, "value": 79}
    intent = {"health": [edit]}
    record = {
        "version": 2 if live else 1,
        "save": SAVE,
        "build": bundle.build,
        "identity": identity,
        "namespace": namespace,
        "fingerprint": fingerprint,
        "edit": edit,
    }
    if live:
        record["existingPath"] = str(target)

    def signed(record):
        payload = json.dumps(record).encode()
        return {
            "payload": base64.b64encode(payload).decode(),
            "signature": base64.b64encode(key.sign(payload)).decode(),
        }

    envelope = signed(record)
    payload = json.dumps(record).encode()
    request = (SAVE, OPERATION, fingerprint, intent)
    command = admission.production_health
    assert command("state", SAVE)["state"] == "disabled"
    ticket.write_text(
        json.dumps({**envelope, "payload": base64.b64encode(payload + b" ").decode()})
    )
    assert command("prepare", *request)["transaction"]["reason"] == "save_unsupported"
    if live:
        other = {**record, "existingPath": str(target.with_name("other.es3"))}
        ticket.write_text(json.dumps(signed(other)))
        assert command("prepare", *request)["transaction"]["reason"] == "save_unsupported"
        assert command("state", SAVE)["state"] == "disabled"
        assert target.read_bytes() == source
    ticket.write_text(json.dumps(envelope))
    assert command("state", SAVE)["domains"] == ["health"]
    assert (
        command("prepare", SAVE, OPERATION, fingerprint, {"health": [{**edit, "value": 78}]})[
            "transaction"
        ]["reason"]
        == "save_unsupported"
    )
    assert command("prepare", *request)["transaction"]["status"] == "prepared"
    original = target.with_suffix(".original")
    target.rename(original)
    target.write_bytes(source)
    assert command("write", *request)["transaction"]["reason"] == "save_stale"
    assert list(target.parent.glob("*.bak-*")) == []
    # Restore the admitted object before handing the unclaimed reservation to its writer.
    replacement = target.with_suffix(".replacement")
    target.rename(replacement)
    original.rename(target)
    assert command("write", *request)["transaction"]["status"] == "applied"
    assert command("acknowledge", SAVE, OPERATION)["transaction"]["status"] == "applied"
    assert command("state", SAVE)["state"] == "disabled"
    assert command("prepare", *request)["transaction"]["status"] == "rejected"
    assert next(target.parent.glob("*.bak-health-*")).read_bytes() == source
