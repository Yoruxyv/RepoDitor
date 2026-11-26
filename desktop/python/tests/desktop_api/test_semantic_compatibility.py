"""Compatibility admission against synthetic encrypted saves and Unity sources."""

import json
import struct
from contextlib import nullcontext
from hashlib import sha256

import pytest

from repo_save_editor.core.crypto import encrypt_save
from repo_save_editor.desktop_api.transactions import production_health as policy
from repo_save_editor.desktop_api.transactions import production_meta as cosmetic_policy
from repo_save_editor.services.cosmetics import policy as mutation_policy
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.game import launcher, save_settings
from repo_save_editor.services.game.discovery import GameInstallation
from repo_save_editor.services.game.installed_build import installed_build_identity
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.services.game.write_evidence import ApprovedWriteSources
from repo_save_editor.services.items.models import InstalledItemMetadata, ItemRechargeCapability
from repo_save_editor.services.unity_serialized import UnityMetadataError
from repo_save_editor.storage import health_recovery as receipts
from repo_save_editor.storage.repository import SaveRepository
from tools.capabilities.tests.unity_serialized_fixture import (
    aligned_string,
    mono_script,
    pptr,
    write_serialized_file,
)

SAVE = "REPO_SAVE_2026_08_08_10_20_30"
BODY = b"independent settings fixture"
SCENES = b"independent scene fixture"


def _serialized(root, *, art=b"initial art", defaults=BODY, scenes=SCENES, duplicate=False):
    resource_entry = aligned_string("es3/es3defaults") + pptr(1, 12)
    entries = [
        aligned_string("unrelated/texture") + pptr(1, 13),
        resource_entry,
    ]
    if duplicate:
        entries.append(resource_entry)
    write_serialized_file(
        root / save_settings.MANAGERS,
        [
            (1, 147, struct.pack("<i", len(entries)) + b"".join(entries)),
            (2, 141, scenes),
            (3, 28, art),
        ],
        externals=(("", "resources.assets"),),
        unity_version=policy.RECHARGE_UNITY,
    )
    # Place artwork before the settings object so changing its size moves the settings bytes.
    write_serialized_file(
        root / save_settings.RESOURCES,
        [
            (13, 28, art),
            (
                12,
                114,
                pptr(0, 0) + b"\x01\0\0\0" + pptr(1, 21) + aligned_string("ES3Defaults") + defaults,
            ),
        ],
        externals=(("", "globalgamemanagers.assets"),),
        unity_version=policy.RECHARGE_UNITY,
    )
    script = (
        aligned_string("ES3Defaults")
        + b"\0" * 20
        + aligned_string("ES3Defaults")
        + aligned_string("")
        + aligned_string("Assembly-CSharp-firstpass")
    )
    write_serialized_file(
        root / save_settings.SCRIPTS,
        [
            (21, 115, script),
            (22, 115, mono_script("MetaManager", "MetaManager")),
            (23, 115, mono_script("CosmeticAsset", "CosmeticAsset")),
            (24, 115, mono_script("RunManager", "RunManager")),
            (25, 115, mono_script("Level", "Level")),
        ],
        unity_version=policy.RECHARGE_UNITY,
    )


def _levels(root, *, art=b"initial art", shop=31, rooms=1):
    def behaviour(script, name):
        return pptr(0, 0) + b"\1\0\0\0" + pptr(1, script) + aligned_string(name)

    def vector(*pointers):
        return struct.pack("<i", len(pointers)) + b"".join(pointers)

    prefix = struct.pack("<i", 0) + pptr(0, 0) + bytes(4) + pptr(0, 0) * 6
    manager = behaviour(24, "") + prefix + vector(pptr(2, shop)) + vector() + vector(pptr(2, 32))
    empty = aligned_string("") * 2 + pptr(0, 0) + b"\1\0\0\0"
    room = (
        aligned_string("Room") + aligned_string("Level/Somewhere/Room") + pptr(0, 0) + b"\1\0\0\0"
    )
    header = bytes(4) + aligned_string("") + pptr(0, 0) + struct.pack("<iiB3x", 1, 0, 0)
    level = header + empty * 5 + vector(*([room] * rooms)) + vector(room)
    write_serialized_file(
        root / "REPO_Data/level0",
        [(1, 114, manager)],
        externals=(("", "globalgamemanagers.assets"), ("", "sharedassets0.assets")),
        unity_version=policy.RECHARGE_UNITY,
    )
    write_serialized_file(
        root / "REPO_Data/sharedassets0.assets",
        [
            (28, 28, art),
            (31, 114, behaviour(25, "Shop") + level),
            (32, 114, behaviour(25, "Normal") + level),
        ],
        externals=(("", "globalgamemanagers.assets"),),
        unity_version=policy.RECHARGE_UNITY,
    )


@pytest.fixture
def candidate(tmp_path, monkeypatch, sample_save):
    library = tmp_path / "SteamLibrary"
    root = library / "steamapps/common/REPO"
    manifest = library / "steamapps/appmanifest_3241660.acf"
    catalog = root / "REPO_Data/StreamingAssets/aa/catalog.json"
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")
    manifest.write_text(
        '"appid" "3241660"\n"installdir" "REPO"\n"buildid" "9000"\n', encoding="utf-8"
    )
    for name in (*policy.HEALTH_BUILD_SOURCES[:3], *policy.SAVE_FORMAT_SOURCES):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(name.encode())
    _serialized(root)
    levels = ("REPO_Data/level0", "REPO_Data/sharedassets0.assets")
    _levels(root)
    game = GameInstallation(root, catalog, library, manifest, "9000")
    build = installed_build_identity(game)
    assert build is not None
    approved = ApprovedWriteSources(
        policy._source_pins(game, build, policy.HEALTH_BUILD_SOURCES),
        tuple(
            zip(
                (save_settings.RESOURCES, save_settings.SCRIPTS),
                policy._source_pins(game, build, (save_settings.RESOURCES, save_settings.SCRIPTS)),
                strict=True,
            )
        ),
        tuple(
            zip(
                (*levels, save_settings.SCRIPTS),
                policy._source_pins(game, build, (*levels, save_settings.SCRIPTS)),
                strict=True,
            )
        ),
    )
    monkeypatch.setattr(policy, "APPROVED_WRITE_SOURCES", (approved,))
    monkeypatch.setattr(
        policy, "SAVE_FORMAT_PINS", policy._source_pins(game, build, policy.SAVE_FORMAT_SOURCES)
    )
    monkeypatch.setattr(policy, "SUNSTONE_ES3_DEFAULTS", sha256(BODY).hexdigest())
    monkeypatch.setattr(policy, "SUNSTONE_BUILD_SETTINGS", sha256(SCENES).hexdigest())
    monkeypatch.setattr(policy, "_installed_game", lambda: (game, build))
    monkeypatch.setattr(policy, "private_bundle", lambda: None)
    monkeypatch.setattr(policy, "_process_status", lambda *_: GameProcessStatus.NOT_RUNNING)
    saves = tmp_path / "saves"
    path = saves / SAVE / f"{SAVE}.es3"
    SaveRepository(saves).save_as(path, sample_save)
    monkeypatch.setattr(policy, "get_default_save_root", lambda: saves)
    return root, path


def test_settings_reader_uses_typed_resource_binding_and_ignores_unrelated_objects(tmp_path):
    _serialized(tmp_path)
    expected = sha256(BODY).hexdigest(), sha256(SCENES).hexdigest()
    resources = tmp_path / save_settings.RESOURCES
    old_offset = resources.read_bytes().index(BODY)
    assert save_settings.inspect_save_settings(tmp_path) == expected
    _serialized(tmp_path, art=b"changed unrelated artwork" * 4)
    assert resources.read_bytes().index(BODY) != old_offset
    assert save_settings.inspect_save_settings(tmp_path) == expected
    _serialized(tmp_path, duplicate=True)
    with pytest.raises(UnityMetadataError, match="ambiguous"):
        save_settings.inspect_save_settings(tmp_path)


@pytest.mark.parametrize(
    ("domain", "edits", "group", "field", "after"),
    [
        ("health", [{"playerId": "111", "before": 80, "value": 79}], "playerHealth", "111", 79),
        (
            "upgrades",
            [{"playerId": "111", "key": "playerUpgradeStrength", "before": 2, "value": 4}],
            "playerUpgradeStrength",
            "111",
            4,
        ),
        ("run", [{"field": "currency", "before": 12, "value": 27}], "runStats", "currency", 27),
        (
            "run",
            [{"field": "resumeLocation", "before": "Normal", "value": "Shop / Service Station"}],
            "runStats",
            "save level",
            1,
        ),
    ],
)
def test_runtime_verified_field_uses_normal_write_and_recovery(
    candidate, monkeypatch, domain, edits, group, field, after
):
    root, path = candidate
    assert policy.production_health("state", SAVE)["compatibility"][domain] == "verified"
    _serialized(root, art=b"different art only")
    _levels(root, art=b"repacked Level assets with different artwork")
    before = path.read_bytes()
    fingerprint = sha256(before).hexdigest()
    state = policy.production_health("state", SAVE)
    assert state["compatibility"][domain] == "verified"
    assert state["resumeAllowed"] is True
    operation = "a" * 32
    intent = {domain: edits}
    assert (
        policy.production_health("prepare", SAVE, operation, fingerprint, intent)["transaction"][
            "status"
        ]
        == "rejected"
    )
    assert path.read_bytes() == before
    assert list(path.parent.glob("*.bak-health-*")) == []
    result = policy.production_health(
        "apply",
        SAVE,
        operation,
        fingerprint,
        intent,
        publication_allowed=lambda: True,
    )
    assert result["transaction"]["status"] == "applied"
    assert SaveRepository.load(path)["dictionaryOfDictionaries"]["value"][group][field] == after
    assert [backup.read_bytes() for backup in path.parent.glob("*.bak-health-*")] == [before]
    assert policy.production_health("inspect", SAVE, operation)["transaction"]["status"] == "busy"
    monkeypatch.setattr(receipts, "_owner_exited", lambda *_: True)
    settled = policy.production_health("acknowledge", SAVE, operation)
    assert settled["transaction"]["status"] == "applied"
    assert policy.production_health("state", SAVE)["state"] == "idle"


def test_changed_shared_defaults_and_resume_dependency_are_independent(candidate):
    root, path = candidate
    before = path.read_bytes()
    fingerprint = sha256(before).hexdigest()
    _serialized(root, scenes=b"incompatible scene roster")
    state = policy.production_health("state", SAVE)
    assert state["resumeAllowed"] is False
    assert set(state["domains"]) == {"health", "run", "upgrades", "refillToFull"}
    assert state["compatibility"]["resume"] == "unverified"
    assert state["compatibility"]["refillToFull"] == "verified"
    result = policy.production_health(
        "apply",
        SAVE,
        "a" * 32,
        fingerprint,
        {
            "run": [
                {"field": "resumeLocation", "before": "Normal", "value": "Shop / Service Station"}
            ],
        },
        publication_allowed=lambda: pytest.fail("unsupported Resume crossed native publication"),
    )
    assert result["transaction"]["reason"] == "save_unsupported"
    assert path.read_bytes() == before
    _serialized(root, defaults=b"changed ES3 configuration")
    state = policy.production_health("state", SAVE)
    assert state["state"] == "disabled"
    assert set(state["compatibility"].values()) == {"incompatible"}


@pytest.mark.parametrize(("shop", "rooms"), [(99, 1), (32, 1), (31, 0)])
def test_malformed_level_roster_restricts_only_resume(candidate, shop, rooms):
    root, path = candidate
    _levels(root, shop=shop, rooms=rooms)
    state = policy.production_health("state", SAVE)
    assert state["resumeAllowed"] is False
    assert state["compatibility"]["run"] == "verified"
    before = path.read_bytes()
    result = policy.production_health(
        "apply",
        SAVE,
        "1" * 32,
        sha256(before).hexdigest(),
        {
            "run": [
                {"field": "resumeLocation", "before": "Normal", "value": "Shop / Service Station"}
            ]
        },
        publication_allowed=lambda: pytest.fail("Invalid Level contract crossed publication"),
    )
    assert result["transaction"]["reason"] == "save_unsupported"
    assert path.read_bytes() == before
    assert list(path.parent.glob("*.bak-health-*")) == []


def test_launcher_metadata_change_preserves_writes_but_other_executable_bytes_do_not(
    candidate, monkeypatch
):
    root, _ = candidate
    original = bytearray(512)
    original[:2] = b"MZ"
    struct.pack_into("<I", original, 60, 64)
    original[64:70] = b"PE\0\0\x64\x86"
    struct.pack_into("<H", original, 84, 240)
    struct.pack_into("<H", original, 88, 0x20B)
    monkeypatch.setattr(launcher, "_REVIEWED_LAUNCHER", sha256(original).hexdigest())
    struct.pack_into("<I", original, 72, 987654321)
    struct.pack_into("<I", original, 152, 0xABCD)
    path = root / "REPO.exe"
    path.write_bytes(original)
    state = policy.production_health("state", SAVE)
    assert state["compatibility"]["health"] == "verified"
    assert state["resumeAllowed"] is True
    original[-1] = 1
    path.write_bytes(original)
    assert policy.production_health("state", SAVE)["state"] == "disabled"


@pytest.mark.parametrize("value", [None, True, "0", 9])
def test_resume_requires_a_supported_saved_integer(candidate, value):
    root, path = candidate
    _levels(root, art=b"repacked assets")
    data = SaveRepository.load(path)
    stats = data["dictionaryOfDictionaries"]["value"]["runStats"]
    if value is None:
        stats.pop("save level")
    else:
        stats["save level"] = value
    SaveRepository(path.parent.parent).save_as(path, data)
    state = policy.production_health("state", SAVE)
    assert state["resumeAllowed"] is False
    assert state["compatibility"]["run"] == "verified"
    before = path.read_bytes()
    result = policy.production_health(
        "apply",
        SAVE,
        "2" * 32,
        sha256(before).hexdigest(),
        {
            "run": [
                {"field": "resumeLocation", "before": "Normal", "value": "Shop / Service Station"}
            ]
        },
        publication_allowed=lambda: pytest.fail("Unsupported save field crossed publication"),
    )
    assert result["transaction"]["reason"] == "save_unsupported"
    assert path.read_bytes() == before


@pytest.mark.parametrize("change_resume", [False, True])
def test_level_sources_are_rechecked_only_for_resume_writes(candidate, change_resume):
    root, path = candidate
    _levels(root, art=b"repacked assets")
    before = path.read_bytes()
    edit = (
        {"field": "resumeLocation", "before": "Normal", "value": "Shop / Service Station"}
        if change_resume
        else {"field": "currency", "before": 12, "value": 14}
    )

    def change_level_assets():
        _levels(root, art=b"repacked again during publication")
        return True

    result = policy.production_health(
        "apply",
        SAVE,
        "3" * 32,
        sha256(before).hexdigest(),
        {"run": [edit]},
        publication_allowed=change_level_assets,
    )["transaction"]
    if change_resume:
        assert result["reason"] == "save_verification_unavailable"
        assert path.read_bytes() == before
    else:
        assert result["status"] == "applied"
        assert (
            SaveRepository.load(path)["dictionaryOfDictionaries"]["value"]["runStats"]["currency"]
            == 14
        )
        assert next(path.parent.glob("*.bak-health-*")).read_bytes() == before


def test_changed_source_after_native_reservation_does_not_publish(candidate, monkeypatch):
    root, path = candidate
    _serialized(root, art=b"first update")
    before = path.read_bytes()

    def update_during_publication():
        _serialized(root, art=b"second update")
        return True

    result = policy.production_health(
        "apply",
        SAVE,
        "a" * 32,
        sha256(before).hexdigest(),
        {"health": [{"playerId": "111", "before": 80, "value": 79}]},
        publication_allowed=update_during_publication,
    )
    assert result["transaction"]["status"] == "uncertain"
    assert result["transaction"]["reason"] == "save_verification_unavailable"
    assert path.read_bytes() == before
    assert all(backup.read_bytes() == before for backup in path.parent.glob("*.bak-health-*"))
    monkeypatch.setattr(receipts, "_owner_exited", lambda *_: True)
    assert policy.production_health("acknowledge", SAVE, "a" * 32)["transaction"]["status"] == (
        "unchanged"
    )


def test_recharge_rechecks_only_previously_reviewed_identities(candidate, monkeypatch):
    root, _ = candidate
    _serialized(root, art=b"unrelated asset delta")
    known, changed = policy.RECHARGE_IDENTITIES[:2]
    capabilities = {
        known: InstalledItemMetadata(ItemRechargeCapability.RECHARGEABLE, None, known),
        changed: InstalledItemMetadata(ItemRechargeCapability.UNKNOWN, None, changed),
        "Item newly detected": InstalledItemMetadata(
            ItemRechargeCapability.RECHARGEABLE, None, "Item newly detected"
        ),
    }
    monkeypatch.setattr(policy, "discover_installed_item_metadata", lambda *_, **__: capabilities)
    _, _, domains, proof = policy._game()
    assert "refillToFull" in domains
    assert isinstance(proof, policy.DynamicRechargeSources)
    assert isinstance(proof.shared, policy.RuntimeSaveSources)
    assert proof.identities == (known,)
    del capabilities[known]
    assert policy._game()[2] == {"health", "upgrades", "run"}


def test_runtime_verified_recharge_preserves_other_instances(candidate, monkeypatch):
    root, path = candidate
    _serialized(root, art=b"unrelated asset delta")
    name = policy.RECHARGE_IDENTITIES[0]
    added_name = "Item Additive Future Fixture"
    key, other, added = f"{name}/1", f"{name}/2", f"{added_name}/1"
    data = SaveRepository.load(path)
    values = data["dictionaryOfDictionaries"]["value"]
    values["item"] = {key: 21, other: 21, added: 21}
    values["itemStatBattery"] = {key: 99, other: 23, added: 11}
    SaveRepository(path.parent.parent).save_as(path, data)
    before = path.read_bytes()
    monkeypatch.setattr(
        policy,
        "discover_installed_item_metadata",
        lambda *_, **__: {
            name: InstalledItemMetadata(ItemRechargeCapability.RECHARGEABLE, None, name),
            added_name: InstalledItemMetadata(
                ItemRechargeCapability.RECHARGEABLE, None, added_name
            ),
        },
    )
    refused = policy.production_health(
        "apply",
        SAVE,
        "b" * 32,
        sha256(before).hexdigest(),
        {"refillToFull": [{"saveKey": added, "before": 11}]},
        publication_allowed=lambda: pytest.fail("unreviewed Item crossed publication"),
    )
    assert refused["transaction"]["status"] == "rejected"
    assert path.read_bytes() == before
    result = policy.production_health(
        "apply",
        SAVE,
        "a" * 32,
        sha256(before).hexdigest(),
        {"refillToFull": [{"saveKey": key, "before": 99}]},
        publication_allowed=lambda: True,
    )
    assert result["transaction"]["status"] == "applied"
    del values["itemStatBattery"][key]
    assert SaveRepository.load(path) == data
    assert [backup.read_bytes() for backup in path.parent.glob("*.bak-health-*")] == [before]


def test_malformed_item_projection_does_not_disable_other_editing(candidate, monkeypatch):
    root, path = candidate
    _serialized(root, art=b"unrelated asset delta")
    name = policy.RECHARGE_IDENTITIES[0]
    monkeypatch.setattr(
        policy,
        "discover_installed_item_metadata",
        lambda *_, **__: {
            name: InstalledItemMetadata(ItemRechargeCapability.RECHARGEABLE, None, name)
        },
    )
    data = SaveRepository.load(path)
    data["dictionaryOfDictionaries"]["value"]["item"] = "unsupported item shape"
    SaveRepository(path.parent.parent).save_as(path, data)
    state = policy.production_health("state", SAVE)
    assert state["state"] == "idle"
    assert state["compatibility"]["health"] == "verified"
    assert "advanced" not in state["canonical"]


def test_serializer_defaults_are_checked_even_if_the_managers_file_is_unchanged(candidate):
    root, _ = candidate
    managers = root / save_settings.MANAGERS
    before = managers.read_bytes()
    _serialized(root, defaults=b"different required serializer configuration")
    assert managers.read_bytes() == before
    state = policy.production_health("state", SAVE)
    assert state["state"] == "disabled"
    assert set(state["compatibility"].values()) == {"incompatible"}


def test_changed_cosmetic_assets_require_fresh_ownership_proof(candidate, monkeypatch):
    root, _ = candidate
    game, build = policy._installed_game()
    reviewed = policy.APPROVED_WRITE_SOURCES[0].cosmetics
    (root / "REPO_Data/sharedassets0.assets").write_bytes(b"unrelated asset update")
    sources = cosmetic_policy._changed_catalog_sources(game, build, reviewed)
    assert sources is not None
    row = InstalledCosmeticMetadata(0, "Reviewed", 1, 2, 0)
    payload = json.dumps(cosmetic_policy._catalog_payload((row,)), sort_keys=True).encode()
    monkeypatch.setattr(cosmetic_policy, "COSMETIC_CATALOG_DIGEST", sha256(payload).hexdigest())
    monkeypatch.setattr(
        cosmetic_policy,
        "read_installed_catalog",
        lambda *_args, **_kw: ((row,), (("sharedassets0.assets", 10, 1),)),
    )
    assert cosmetic_policy._verify_changed_catalog(root, sources) == (row,)
    _serialized(root, art=b"settings offset and unrelated art")
    monkeypatch.setattr(cosmetic_policy, "private_bundle", lambda: None)
    monkeypatch.setattr(cosmetic_policy, "_installed_game", lambda: (game, build))
    monkeypatch.setattr(cosmetic_policy, "get_default_save_root", lambda: root / "saves")
    monkeypatch.setattr(cosmetic_policy, "entry_artwork_revision", lambda _: None)
    monkeypatch.setattr(
        cosmetic_policy,
        "meta_state",
        lambda root, _operation, *, admit: {"ids": [item.cosmetic_id for item in admit(root)[1]]},
    )
    assert cosmetic_policy.production_meta("state", None)["ids"] == [0]
    (root / "REPO_Data/level0").write_bytes(b"changed ownership vector source")
    with pytest.raises(policy.RecoveryError, match="save_verification_unavailable"):
        cosmetic_policy._verify_changed_catalog(root, sources)


@pytest.mark.parametrize("catalog_change", ["append", "reorder", "duplicate", "wrongField"])
def test_cosmetics_requires_an_unchanged_reviewed_ownership_prefix(
    candidate, monkeypatch, catalog_change
):
    root, run = candidate
    game, build = policy._installed_game()
    level = root / "REPO_Data/level0"
    shared = root / "REPO_Data/sharedassets0.assets"

    def write_catalog(names, *, typed=True):
        objects, pointers = [], []
        for index, name in enumerate(names, start=1):
            pointers.append(pptr(2, index))
            body = struct.pack("<i", 2) + aligned_string(name) + struct.pack("<ii", 3, 4)
            objects.append(
                (index, 114, (pptr(0, 0) + b"\1\0\0\0" + pptr(1, 23) + aligned_string(name) + body))
            )
        manager = pptr(0, 0) + b"\1\0\0\0" + pptr(1, 22) + aligned_string("MetaManager")
        if typed:
            manager += (struct.pack("<i", 1) + pptr(2, 900)) * 2
        vector = struct.pack("<i", len(pointers)) + b"".join(pointers)
        write_serialized_file(
            level,
            [(40, 114, manager + vector)],
            externals=(
                ("", "globalgamemanagers.assets"),
                ("", "sharedassets0.assets"),
            ),
            unity_version=policy.RECHARGE_UNITY,
        )
        write_serialized_file(
            shared,
            objects,
            externals=(("", "globalgamemanagers.assets"),),
            unity_version=policy.RECHARGE_UNITY,
        )
        return cosmetic_policy.read_installed_catalog(root, native=True)[0]

    initial = write_catalog(("Fixture A", "Fixture B"))
    reviewed = policy.APPROVED_WRITE_SOURCES[0]
    paths = tuple(name for name, _ in reviewed.cosmetics)
    reviewed = reviewed._replace(
        cosmetics=tuple(zip(paths, policy._source_pins(game, build, paths), strict=True))
    )
    monkeypatch.setattr(policy, "APPROVED_WRITE_SOURCES", (reviewed,))
    digest = sha256(json.dumps(cosmetic_policy._catalog_payload(initial), sort_keys=True).encode())
    monkeypatch.setattr(cosmetic_policy, "COSMETIC_CATALOG_DIGEST", digest.hexdigest())
    monkeypatch.setattr(cosmetic_policy, "PROVEN_MUTATION_IDS", (0, 1))
    monkeypatch.setattr(mutation_policy, "PROVEN_MUTATION_IDS", (0, 1))
    monkeypatch.setattr(mutation_policy, "PROVEN_MUTATION_ID_SET", frozenset({0, 1}))
    monkeypatch.setattr(cosmetic_policy, "native_artwork_cache", lambda *_, **__: nullcontext(None))
    monkeypatch.setattr(cosmetic_policy, "_installed_game", lambda: (game, build))
    monkeypatch.setattr(cosmetic_policy, "private_bundle", lambda: None)
    monkeypatch.setattr(cosmetic_policy, "entry_artwork_revision", lambda *_: None)
    monkeypatch.setattr(
        cosmetic_policy, "_process_status", lambda *_: GameProcessStatus.NOT_RUNNING
    )
    saves = run.parent.parent
    monkeypatch.setattr(cosmetic_policy, "get_default_save_root", lambda: saves)
    meta = saves.parent / "MetaSave.es3"
    source = encrypt_save(
        {
            "cosmeticHistory": {"value": []},
            "cosmeticUnlocks": {"value": []},
            "cosmeticEquipped": {"value": []},
            "cosmeticPresets": {"value": [[]]},
            "colorPresets": {"value": [[1, 2, 3]]},
        }
    )
    meta.write_bytes(source)
    checkpoint = cosmetic_policy.production_meta("state", None)
    assert checkpoint["admission"]

    names = {
        "append": ("Fixture A", "Fixture B", "Future Fixture"),
        "reorder": ("Fixture B", "Fixture A", "Future Fixture"),
        "duplicate": ("Fixture A", "Fixture B", "Fixture A"),
        "wrongField": ("Fixture A", "Fixture B", "Future Fixture"),
    }
    catalog = write_catalog(names[catalog_change], typed=catalog_change != "wrongField")
    assert catalog[2].cosmetic_id == 2
    run_state = policy.production_health("state", SAVE)
    assert run_state["compatibility"]["run"] == "verified"
    assert run_state["resumeAllowed"] is False
    current = cosmetic_policy.production_meta("state", None)
    if catalog_change != "append":
        assert current["admission"] is None
        assert current["view"]["capabilities"]["canUnlockCosmetic"] is False
        assert meta.read_bytes() == source
        return
    assert current["admission"]["digest"] != checkpoint["admission"]["digest"]
    assert current["view"]["capabilities"]["canUnlockCosmetic"] is True
    assert current["view"]["cosmetics"][2]["mutationEligible"] is False
    intent = {
        "metaCosmetics": {"action": "unlockIds", "ids": [0], "admission": ""},
    }
    args = {"fingerprint": sha256(source).hexdigest(), "namespace": current["namespace"]}
    intent["metaCosmetics"]["admission"] = checkpoint["admission"]["digest"]
    stale = cosmetic_policy.production_meta(
        "prepare",
        "c" * 32,
        intent=intent,
        **args,
    )
    assert stale["status"] == "rejected"
    assert stale["reason"] == "save_stale"
    assert meta.read_bytes() == source
    intent["metaCosmetics"]["admission"] = current["admission"]["digest"]
    intent["metaCosmetics"]["ids"] = [2]
    unsupported = cosmetic_policy.production_meta("prepare", "e" * 32, intent=intent, **args)
    assert unsupported["status"] == "rejected"
    assert meta.read_bytes() == source
    assert list(meta.parent.glob("*.bak-*")) == []
    intent["metaCosmetics"]["ids"] = [0]
    operation = "d" * 32
    prepared = cosmetic_policy.production_meta("prepare", operation, intent=intent, **args)
    assert prepared["status"] == "prepared"
    monkeypatch.setattr(receipts, "_owner_exited", lambda *_: True)
    result = cosmetic_policy.production_meta("apply", operation, intent=intent, **args)
    assert result["status"] == "applied", result
    assert result["view"]["knownOwnedCount"] == 1
    assert next(meta.parent.glob("*.bak-*")).read_bytes() == source


def test_validated_sources_do_not_authorize_a_different_saved_dictionary_type(
    candidate, sample_save
):
    root, path = candidate
    _serialized(root, art=b"unrelated asset update")
    sample_save["dictionaryOfDictionaries"]["__type"] = (
        "System.Collections.Generic.Dictionary`2[[System.Int32],[System.String]]"
    )
    SaveRepository(path.parent.parent).save_as(path, sample_save)
    before = path.read_bytes()
    result = policy.production_health(
        "apply",
        SAVE,
        "a" * 32,
        sha256(before).hexdigest(),
        {"health": [{"playerId": "111", "before": 80, "value": 79}]},
        publication_allowed=lambda: pytest.fail("unsupported dictionary crossed publication"),
    )
    assert result["transaction"]["reason"] == "save_unsupported"
    assert path.read_bytes() == before
    assert list(path.parent.glob("*.bak-health-*")) == []


@pytest.mark.parametrize("assembly", ["mscorlib", "untrusted"])
def test_public_health_accepts_game_qualified_dictionary_types(candidate, sample_save, assembly):
    root, path = candidate
    _serialized(root, art=b"asset repack")
    assembly_name = f"{assembly}, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089"
    dictionary = "System.Collections.Generic.Dictionary`2"
    text = f"System.String, {assembly_name}"
    integer = f"System.Int32, {assembly_name}"
    sample_save["playerNames"]["__type"] = f"{dictionary}[[{text}],[{text}]],mscorlib"
    sample_save["dictionaryOfDictionaries"]["__type"] = (
        f"{dictionary}[[{text}],[{dictionary}[[{text}],[{integer}]], {assembly_name}]],mscorlib"
    )
    SaveRepository(path.parent.parent).save_as(path, sample_save)
    source = path.read_bytes()
    result = policy.production_health(
        "apply",
        SAVE,
        "d" * 32,
        sha256(source).hexdigest(),
        {"health": [{"playerId": "111", "before": 80, "value": 79}]},
        publication_allowed=lambda: True,
    )["transaction"]
    if assembly == "mscorlib":
        assert result["status"] == "applied"
        after = SaveRepository.load(path)
        sample_save["dictionaryOfDictionaries"]["value"]["playerHealth"]["111"] = 79
        assert after == sample_save
        assert next(path.parent.glob("*.bak-health-*")).read_bytes() == source
    else:
        assert result["reason"] == "save_unsupported"
        assert path.read_bytes() == source
