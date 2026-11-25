"""Exercise future Steam manifests using synthetic 0.5.2-format assets only."""

from __future__ import annotations

import importlib
import struct
from contextlib import nullcontext
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace

import pytest

from repo_save_editor.services.artwork import baked_artwork
from repo_save_editor.services.game import installed_build
from repo_save_editor.services.game.discovery import discover_game_installation
from repo_save_editor.services.game.installed_maps import read_installed_levels
from repo_save_editor.services.game.map_artwork import artwork_revision
from repo_save_editor.services.game.maps import discover_installed_maps
from repo_save_editor.services.game.write_evidence import (
    APPROVED_WRITE_SOURCES,
    ApprovedWriteSources,
)
from repo_save_editor.services.items import recharge_capability, recharge_evidence
from repo_save_editor.services.items.models import ItemRechargeCapability
from repo_save_editor.services.items.recharge_capability import (
    discover_installed_item_metadata_with_evidence,
)
from repo_save_editor.services.player.upgrade_textures import prepare_installed_upgrade_textures
from repo_save_editor.services.saves.private_health import Bundle
from repo_save_editor.services.texture_codec import encode_rgba_png
from repo_save_editor.services.unity_hash import unity_hash128
from repo_save_editor.services.unity_serialized import UnityMetadataError
from tests.services.test_baked_artwork import _item_definition
from tests.services.test_installed_build import _steam_install
from tests.services.test_installed_maps import installation as map_installation
from tests.services.test_upgrade_textures import (
    _game_object,
    _texture2d,
    _write_resource_manager,
    _write_upgrade_assets,
)
from tools.capabilities.tests.unity_serialized_fixture import (
    aligned_string,
    mono_script,
    pptr,
    write_serialized_file,
)

BASE_BUILD = "26732417"
NEXT_BUILD = "26732418"
UNITY = "6000.3.28f1"
UPGRADE = "playerUpgradeHealth"
ITEM = "Item Synthetic Tool"


def _simulate_next_build(library: Path) -> None:
    manifest = library / "steamapps/appmanifest_3241660.acf"
    manifest.write_bytes(manifest.read_bytes().replace(BASE_BUILD.encode(), NEXT_BUILD.encode()))


@pytest.fixture
def steam_install(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path]:
    library, root = _steam_install(tmp_path, BASE_BUILD)
    monkeypatch.setattr(
        installed_build,
        "discover_game_installation",
        lambda _: discover_game_installation(steam_roots=(library,), environment={}),
    )
    return library, root / "REPO_Data"


def test_upgrade_texture_rebinds_after_build_update_and_source_replacement(steam_install):
    library, data = steam_install
    stream = data / "resources.assets.resS"
    stream.write_bytes(struct.pack("<HHI", 0xF800, 0, 0))
    texture = _texture2d()
    width_offset = len(aligned_string("Upgrade_Health_Albedo")) + 4
    texture = texture[:width_offset] + texture[width_offset + 4 :]
    _write_upgrade_assets(data / "resources.assets", texture=texture, unity_version=UNITY)
    _write_resource_manager(
        data / "globalgamemanagers", ("items/item upgrade player health", 1, 1), unity_version=UNITY
    )

    def read():
        game = installed_build.artwork_installation(None)
        assert game is not None
        build = installed_build.installed_build_identity(game)
        assert build is not None
        return prepare_installed_upgrade_textures(
            (UPGRADE,), game, build, presentation=True
        ).textures[0][1]

    before = read()
    assert before is not None
    initial_revision = baked_artwork.entry_artwork_revision()
    assert initial_revision is not None
    _simulate_next_build(library)
    after = read()
    assert after is not None
    assert before.png == after.png
    previous_revision = baked_artwork.entry_artwork_revision()
    assert previous_revision != initial_revision
    stream.write_bytes(struct.pack("<HHI", 0x07E0, 0, 0))
    changed = read()
    assert changed is not None
    assert changed.png != after.png
    assert baked_artwork.entry_artwork_revision() != previous_revision
    stream.write_bytes(b"broken")
    assert read() is None


def test_item_identity_replacement_never_reuses_artwork_or_grants_recharge(
    steam_install, monkeypatch
):
    library, data = steam_install
    resources = data / "resources.assets"
    write_serialized_file(
        data / "globalgamemanagers.assets",
        [(1, 115, mono_script("Item", "Item"))],
        unity_version=UNITY,
    )

    def write_item(name: str) -> None:
        tail = b"\0" * 4 + pptr(0, 0) + struct.pack("<ii", 6, 2)
        definition = _item_definition(name, name).replace(
            aligned_string("Display"), aligned_string("Authored name")
        )
        write_serialized_file(
            resources,
            [(10, 114, definition + tail), (20, 1, _game_object(name, []))],
            externals=(("", "globalgamemanagers.assets"),),
            unity_version=UNITY,
        )

    replacement = ITEM.replace("Tool", "Gear")
    write_item(ITEM)
    png = encode_rgba_png(bytes((1, 2, 3, 255)), 1, 1)
    artwork = data / "StreamingAssets/BakedIcons/Items"
    artwork.mkdir(parents=True)
    for name in (ITEM, replacement):
        (artwork / (unity_hash128(f"{name}|{name}") + ".png")).write_bytes(png)
    root = data.parent
    frames = {}
    cache = SimpleNamespace(
        editor_frame=lambda scope, revision: frames.get((scope, revision)),
        publish_editor_frame=lambda scope, revision, data: frames.__setitem__(
            (scope, revision), data
        ),
        note=lambda *_: None,
    )
    monkeypatch.setattr(
        recharge_capability, "native_artwork_cache", lambda *_, **__: nullcontext(cache)
    )
    scan = recharge_capability.discover_installed_item_metadata_from_assets
    scans = []

    def record_scan(*args, **kwargs):
        scans.append(True)
        return scan(*args, **kwargs)

    monkeypatch.setattr(
        recharge_capability, "discover_installed_item_metadata_from_assets", record_scan
    )
    assert list(baked_artwork.read_baked_item_pngs((ITEM, replacement))[0]) == [ITEM]
    _simulate_next_build(library)
    metadata, evidence = discover_installed_item_metadata_with_evidence(
        (ITEM, replacement), root, reuse_native_metadata=True
    )
    assert evidence is None
    assert metadata[ITEM].canonical_name == ITEM
    assert metadata[ITEM].display_name == "Authored name"
    assert metadata[ITEM].gameplay_cap == 6
    assert metadata[ITEM].recharge_capability == ItemRechargeCapability.UNKNOWN
    assert list(baked_artwork.read_baked_item_pngs((ITEM, replacement))[0]) == [ITEM]
    recharge_capability._cached_item_metadata.cache_clear()
    reused, evidence = discover_installed_item_metadata_with_evidence(
        (replacement, ITEM), root, reuse_native_metadata=True
    )
    assert reused == metadata
    assert evidence is None
    assert len(scans) == 1

    # Identical approved bytes retain authoritative Recharge metadata on the new BuildID.
    monkeypatch.setattr(
        recharge_evidence,
        "discover_game_installation",
        lambda _: discover_game_installation(steam_roots=(library,), environment={}),
    )
    monkeypatch.setattr(
        recharge_evidence,
        "APPROVED_WRITE_SOURCES",
        (
            *APPROVED_WRITE_SOURCES,
            ApprovedWriteSources(
                (),
                tuple(
                    (f"REPO_Data/{name}", sha256((data / name).read_bytes()).hexdigest())
                    for name in ("resources.assets", "globalgamemanagers.assets")
                ),
                (),
            ),
        ),
    )
    qualified, proof = discover_installed_item_metadata_with_evidence((ITEM,))
    assert proof is not None
    assert proof.build_id == NEXT_BUILD
    assert qualified[ITEM].display_name == "Authored name"
    assert qualified[ITEM].recharge_capability != ItemRechargeCapability.RECHARGEABLE

    write_item(replacement)
    _, proof = discover_installed_item_metadata_with_evidence((ITEM,))
    assert proof is None
    metadata, evidence = discover_installed_item_metadata_with_evidence(
        (ITEM, replacement), root, reuse_native_metadata=True
    )
    assert evidence is None
    assert metadata[ITEM].canonical_name is None
    assert metadata[replacement].canonical_name == replacement
    assert len(scans) == 3
    images, _, missing = baked_artwork.read_baked_item_pngs((ITEM, replacement))
    assert list(images) == [replacement]
    assert missing == {ITEM}
    resources.unlink()
    assert baked_artwork.read_baked_item_pngs((replacement,))[0] == {}
    missing_metadata, evidence = discover_installed_item_metadata_with_evidence(
        (ITEM, replacement), root, reuse_native_metadata=True
    )
    assert evidence is None
    assert all(row.canonical_name is None for row in missing_metadata.values())


def test_map_roster_accepts_compatible_future_patch_and_rejects_changed_layout(
    tmp_path, monkeypatch
):
    game = map_installation(tmp_path, monkeypatch, BASE_BUILD)
    data = game.root / "REPO_Data"
    game.catalog_path.parent.mkdir(parents=True)
    game.catalog_path.write_text("{}", encoding="utf-8")
    for path in (
        data / "level0",
        data / "globalgamemanagers.assets",
        data / "sharedassets0.assets",
    ):
        path.write_bytes(path.read_bytes().replace(b"6000.3.17f1", UNITY.encode()))
    for name in ("globalgamemanagers", "resources.assets", "resources.assets.resS"):
        (data / name).write_bytes(b"synthetic artwork revision source")
    before = read_installed_levels(game, presentation=True)
    assert before is not None
    old_catalog = discover_installed_maps(game.root, presentation=True)
    assert old_catalog is not None
    old_revision = artwork_revision(old_catalog)
    assert old_revision is not None
    _simulate_next_build(tmp_path)
    updated = discover_installed_maps(game.root, presentation=True)
    assert updated is not None
    assert updated.maps == old_catalog.maps
    assert artwork_revision(updated) != old_revision
    source = data / "level0"
    source.write_bytes(source.read_bytes().replace(UNITY.encode(), b"6000.4.28f1"))
    current = installed_build.artwork_installation(game.root)
    assert current is not None
    with pytest.raises(UnityMetadataError, match="version"):
        read_installed_levels(current, presentation=True)


def test_compatible_future_manifest_cannot_enter_private_or_public_write_flow(
    steam_install, monkeypatch
):
    library, _ = steam_install
    _simulate_next_build(library)
    game = installed_build.artwork_installation(None)
    assert game is not None
    installed = installed_build.installed_build_identity(game)
    assert installed is not None
    run = importlib.import_module("repo_save_editor.desktop_api.transactions.production_health")
    meta = importlib.import_module("repo_save_editor.desktop_api.transactions.production_meta")
    monkeypatch.setattr(run, "_installed_game", lambda: (game, installed))
    monkeypatch.setattr(meta, "_installed_game", lambda: (game, installed))
    monkeypatch.setattr(
        run, "_authorized_root", lambda *_: pytest.fail("Run write target resolved")
    )
    monkeypatch.setattr(
        meta, "get_default_save_root", lambda: pytest.fail("MetaSave write target resolved")
    )
    bundle = Bundle(library, b"", BASE_BUILD, (), session=True)
    for authority in (None, bundle):
        monkeypatch.setattr(run, "private_bundle", lambda bundle=authority: bundle)
        monkeypatch.setattr(meta, "private_bundle", lambda bundle=authority: bundle)
        save = "REPO_SAVE_2026_08_08_10_20_37"
        assert run.production_health("write", save)["transaction"]["reason"] == "save_unsupported"
        assert meta.production_meta("write", "a" * 32)["reason"] == "save_unsupported"
