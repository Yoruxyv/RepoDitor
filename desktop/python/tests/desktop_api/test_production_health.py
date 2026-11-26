from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
from contextlib import nullcontext
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from repo_save_editor.desktop_api.transactions import production_health as admission
from repo_save_editor.desktop_api.transactions import production_meta as meta_admission
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.game.discovery import (
    APP_MANIFEST_NAME,
    CATALOG_RELATIVE_PATH,
    discover_game_installation,
)
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.services.game.write_evidence import ApprovedWriteSources
from repo_save_editor.services.items.models import ItemRechargeCapability
from repo_save_editor.services.saves.private_health import Bundle
from repo_save_editor.storage import health_recovery as storage
from repo_save_editor.storage.repository import SaveRepository

SAVE = "REPO_SAVE_2026_08_08_10_20_30"
OPERATION = "a" * 32


def test_private_catalog_checks_cached_bytes_against_reviewed_digest(tmp_path, monkeypatch):
    catalog = (InstalledCosmeticMetadata(0, "Reviewed", 1, 2, 0, None),)
    payload = json.dumps(meta_admission._catalog_payload(catalog), sort_keys=True).encode()
    digest = sha256(payload).hexdigest()
    frame = payload.replace(b"Reviewed", b"Unreviewed")
    decodes = []

    def publish(_scope, _revision, encoded):
        nonlocal frame
        frame = encoded

    cache = SimpleNamespace(editor_frame=lambda *_: frame, publish_editor_frame=publish)
    monkeypatch.setattr(meta_admission, "native_artwork_cache", lambda *_, **__: nullcontext(cache))
    monkeypatch.setattr(
        meta_admission, "read_installed_catalog", lambda root, **_: (catalog, decodes.append(root))
    )
    try:
        assert meta_admission._read_qualified_catalog(tmp_path, digest, True) == catalog
        assert decodes == [tmp_path]
        assert frame == payload
        meta_admission._read_qualified_catalog.cache_clear()
        assert meta_admission._read_qualified_catalog(tmp_path, digest, True) == catalog
        assert decodes == [tmp_path]
    finally:
        meta_admission._read_qualified_catalog.cache_clear()


def test_unqualified_production_boundary_does_not_discover_a_save(monkeypatch):
    def unexpected():
        raise AssertionError("An unqualified build must not reach the save namespace")

    def unqualified():
        raise admission.RecoveryError("save_unsupported")

    monkeypatch.setattr(admission, "_installed_game", unqualified)
    monkeypatch.setattr(admission, "get_default_save_root", unexpected)
    state = admission.production_health("state", SAVE)
    assert state["ok"] is True
    assert state["state"] == "disabled"
    assert set(state["compatibility"].values()) == {"unverified"}
    assert (
        admission.production_health("write", SAVE, OPERATION)["transaction"]["reason"]
        == "save_unsupported"
    )


@pytest.mark.parametrize(
    ("change", "run_and_players", "recharge", "cosmetics"),
    [
        ("none", True, True, True),
        ("build-only", True, True, True),
        ("presentation", True, True, True),
        ("item", True, False, True),
        ("cosmetics", True, True, False),
        ("item-and-cosmetics", True, False, False),
        ("other-approved-assets", True, False, False),
        ("mixed-gameplay", False, False, False),
        ("game-code", False, False, False),
        ("es3-serializer", False, False, False),
        ("crypto-runtime", False, False, False),
        ("legacy-approval", False, False, False),
        ("incomplete-evidence", False, False, False),
    ],
)
@pytest.mark.parametrize("public", [False, True])
def test_write_admission_reuses_only_the_reviewed_domain_evidence(
    tmp_path, monkeypatch, change, run_and_players, recharge, cosmetics, public
):
    steam = tmp_path / "Steam"
    game = steam / "steamapps/common/REPO"
    catalog = game / CATALOG_RELATIVE_PATH
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")
    build_id = "26732417" if change == "none" else "26732418"
    (steam / "steamapps" / APP_MANIFEST_NAME).write_text(
        f'"appid" "3241660"\n"installdir" "REPO"\n"buildid" "{build_id}"\n',
        encoding="utf-8",
    )
    item = "REPO_Data/resources.assets"
    cosmetics_source = "REPO_Data/level0"
    managers = "REPO_Data/globalgamemanagers.assets"
    changes = {
        "presentation": "REPO_Data/StreamingAssets/BakedIcons/Items/fixture.png",
        "item": item,
        "cosmetics": cosmetics_source,
        "item-and-cosmetics": managers,
        "game-code": "REPO_Data/Managed/Assembly-CSharp.dll",
        "es3-serializer": "REPO_Data/Managed/Assembly-CSharp-firstpass.dll",
        "crypto-runtime": "REPO_Data/Managed/mscorlib.dll",
    }
    for name in (
        *admission.HEALTH_BUILD_SOURCES,
        *admission.SAVE_FORMAT_SOURCES,
        item,
        cosmetics_source,
        managers,
    ):
        source = game / name
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(name.encode())
    if change in changes:
        source = game / changes[change]
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(b"changed source")

    def pin(name):
        return sha256(name.encode()).hexdigest()

    other_revision_files = {
        "other-approved-assets": (item, cosmetics_source, managers),
        "mixed-gameplay": (admission.HEALTH_BUILD_SOURCES[-1],),
    }
    for name in other_revision_files.get(change, ()):
        (game / name).write_bytes(f"other revision {name}".encode())

    format_pins = tuple(map(pin, admission.SAVE_FORMAT_SOURCES))
    pin_count = {"legacy-approval": 0, "incomplete-evidence": -1}.get(change, len(format_pins))
    format_pins = format_pins[:pin_count]
    reviewed = "Item Melee Inflatable Hammer"
    bundle = Bundle(
        tmp_path,
        b"",
        "26732417",
        tuple(map(pin, admission.HEALTH_BUILD_SOURCES)),
        session=True,
        save_format_pins=format_pins,
        item_sources=((item, pin(item)), (managers, pin(managers))),
        recharge_identities=frozenset({reviewed}),
        cosmetic_sources=((cosmetics_source, pin(cosmetics_source)), (managers, pin(managers))),
        cosmetic_catalog_digest=sha256(b"[]").hexdigest(),
    )
    monkeypatch.delenv("REPODITOR_E2E", raising=False)
    monkeypatch.setattr(admission, "platform", "win32")
    monkeypatch.setattr(
        admission,
        "discover_game_installation",
        lambda: discover_game_installation(steam_roots=(steam,), environment={}),
    )
    if public:
        other = ApprovedWriteSources(
            tuple(pin(f"other revision {name}") for name in admission.HEALTH_BUILD_SOURCES),
            tuple((name, pin(f"other revision {name}")) for name, _ in bundle.item_sources),
            tuple((name, pin(f"other revision {name}")) for name, _ in bundle.cosmetic_sources),
        )
        matching = ApprovedWriteSources(
            bundle.source_pins, bundle.item_sources, bundle.cosmetic_sources
        )
        # The later approved record must work even when the first one fails to match.
        approved = (matching, other) if change == "none" else (other, matching)
        monkeypatch.setattr(admission, "APPROVED_WRITE_SOURCES", approved)
        # This fixture varies optional asset pins and supplies an unchanged shared ES3 object.
        monkeypatch.setattr(
            admission,
            "inspect_save_settings",
            lambda _: (admission.SUNSTONE_ES3_DEFAULTS if run_and_players else "unreviewed", None),
        )
        monkeypatch.setattr(admission, "SAVE_FORMAT_PINS", format_pins)
        monkeypatch.setattr(meta_admission, "SAVE_FORMAT_PINS", format_pins)
        monkeypatch.setattr(
            meta_admission, "COSMETIC_CATALOG_DIGEST", bundle.cosmetic_catalog_digest
        )
        monkeypatch.setattr(meta_admission, "get_default_save_root", lambda: tmp_path)
        monkeypatch.setattr(
            meta_admission, "native_artwork_cache", lambda *_, **__: nullcontext(None)
        )
        monkeypatch.setattr(meta_admission, "entry_artwork_revision", lambda _: None)
    else:
        monkeypatch.setattr(meta_admission, "private_bundle", lambda: bundle)

    session_bundle = None if public else bundle

    def state(root, _operation, admit):
        try:
            proof, _ = admit(root)
        except admission.RecoveryError:
            return {"ok": True, "state": "disabled"}
        return {"ok": True, "state": "enabled", "build": proof["build"]}

    if public:
        monkeypatch.setattr(meta_admission, "meta_state", state)
    if not run_and_players:
        with pytest.raises(admission.RecoveryError, match="save_unsupported"):
            admission._authorize_build(session_bundle, None, SAVE)
        assert meta_admission.production_meta("state", None) == {"ok": True, "state": "disabled"}
        return

    _, current_build, domains, _ = admission._authorize_build(session_bundle, None, SAVE)
    assert current_build == build_id
    assert domains == {"health", "upgrades", "run"} | ({"refillToFull"} if recharge else set())
    assert bundle.reviewed_recharge((reviewed, "Item Unknown")) == {
        reviewed: ItemRechargeCapability.RECHARGEABLE
    }
    if build_id != bundle.build:
        assert not bundle._replace(session=False).accepts_build_id(build_id)

    reads = []

    def read_catalog(root, *, native):
        assert native
        reads.append(root)
        return (), ()

    monkeypatch.setattr(meta_admission, "read_installed_catalog", read_catalog)
    if public:
        result = meta_admission.production_meta("state", None)
        assert result["state"] == ("enabled" if cosmetics else "disabled")
        if cosmetics:
            assert result["build"] == build_id
            (game / cosmetics_source).write_bytes(b"changed after decoding")
            assert meta_admission.production_meta("state", None)["state"] == "disabled"
        assert reads == ([game] if cosmetics else [])
        return
    if not cosmetics:
        with pytest.raises(admission.RecoveryError, match="save_unsupported"):
            meta_admission.verified_private_cosmetics(game, bundle)
        assert reads == []
        return

    assert meta_admission.verified_private_cosmetics(game, bundle) == ()
    assert meta_admission.verified_private_cosmetics(game, bundle) == ()
    assert reads == [game]
    (game / cosmetics_source).write_bytes(b"changed after decoding")
    with pytest.raises(admission.RecoveryError, match="save_unsupported"):
        meta_admission.verified_private_cosmetics(game, bundle)


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
    monkeypatch.setattr(
        admission,
        "_game",
        lambda: (tmp_path / "REPO.exe", "901", frozenset({"health"}), None),
    )
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
    for name in (*admission.HEALTH_BUILD_SOURCES, *admission.SAVE_FORMAT_SOURCES):
        source = game / name
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(name.encode())
    (game / "REPO_Data/resources.assets").write_bytes(b"reviewed recharge")
    worker = """
import json, sys
from functools import partial
from hashlib import sha256
from pathlib import Path
from repo_save_editor.desktop_api.transactions import health_recovery as transactions
from repo_save_editor.desktop_api.transactions import production_health as health
from repo_save_editor.services.items.models import ItemRechargeCapability
from repo_save_editor.services.game.discovery import discover_game_installation
from repo_save_editor.services.game.processes import ProcessInspection
root, steam, game = map(Path, sys.argv[1:4])
health.platform = "win32"
pin = lambda name: sha256(name.encode()).hexdigest()
gameplay = tuple(map(pin, health.HEALTH_BUILD_SOURCES))
updated_gameplay = (*gameplay[:-1], pin("other reviewed revision"))
health.SAVE_FORMAT_PINS = tuple(map(pin, health.SAVE_FORMAT_SOURCES))
recharge = (("REPO_Data/resources.assets", pin("reviewed recharge")),)
capabilities = lambda names: {name: ItemRechargeCapability.RECHARGEABLE for name in names}
health.RECHARGE_IDENTITIES = frozenset({"Item Melee Inflatable Hammer"})
transactions.serialize_advanced_save = partial(transactions.serialize_advanced_save, capability_loader=capabilities)
if sys.argv[4] == "health-only":
    health.APPROVED_RUN_DOMAINS = frozenset({"health"})
    recharge = ()
health.APPROVED_WRITE_SOURCES = (
    health.ApprovedWriteSources(gameplay, recharge, ()),
    health.ApprovedWriteSources(updated_gameplay, recharge, ()),
)
health.discover_game_installation = lambda: discover_game_installation(steam_roots=(steam,), environment={})
health.get_default_save_root = lambda: root
health.inspect_windows_processes = lambda executable: ProcessInspection(
    (executable,) if sys.argv[4] == "running" else (),
    has_unverifiable_candidate=sys.argv[4] == "unknown",
)
def publication():
    if sys.argv[4] == "build-replaced":
        (game / health.HEALTH_BUILD_SOURCES[-1]).write_bytes(b"unreviewed replacement")
    if sys.argv[4] == "build-other-approved":
        (game / health.HEALTH_BUILD_SOURCES[-1]).write_bytes(b"other reviewed revision")
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
        for rejected_operation, status, reason in (
            ("b" * 32, "build-replaced", "save_unsupported"),
            ("c" * 32, "build-other-approved", "save_verification_unavailable"),
        ):
            operation = rejected_operation
            assert command("apply", status)["reason"] == reason
            assert save.read_bytes() == original
            (game / admission.HEALTH_BUILD_SOURCES[-1]).write_bytes(
                admission.HEALTH_BUILD_SOURCES[-1].encode()
            )
            assert command("acknowledge")["status"] == "unchanged"
        operation = "d" * 32
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
