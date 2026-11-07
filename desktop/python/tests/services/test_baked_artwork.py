from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import struct
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from repo_save_editor.services import baked_artwork as baked
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.cosmetics.policy import mutation_eligible_ids
from repo_save_editor.services.game.discovery import GameInstallation
from repo_save_editor.services.game.installed_build import ValidatedInstalledBuild
from repo_save_editor.services.unity_artwork import SUNSTONE_UNITY_VERSION
from repo_save_editor.services.unity_hash import unity_hash128
from tests.unity_serialized_fixture import (
    aligned_string,
    mono_script,
    pptr,
    write_serialized_file,
)


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("Item Cart Small|Item Cart Small", "a13809b12dec3e54d6e320802e6797d4"),
        ("Cosmetic - Arm Left - Long Sleeve", "8706b3d2bb1dc86f0783d7bc02f0c454"),
        ("Cosmetic - Hat - B\u00f8lle", "8193dae81bbbdb2ebf34ef28bd17c63e"),
    ],
)
def test_filename_vectors_from_installed_game(key: str, expected: str) -> None:
    assert unity_hash128(key) == expected
    assert unity_hash128(key.lower()) != expected


@pytest.mark.parametrize(
    ("length", "expected"),
    [
        (1, "e7cc3c5394ea48aca4965e31732bec6c"),
        (7, "9050fccb229ba050b3c014d08e36e2ca"),
        (8, "ee8f65d785c21dbfa259f33f2401d6ba"),
        (15, "60c6b806eb827e84f4865338863fc864"),
        (16, "92c20f8a730005831f9d3d649193e6b7"),
        (31, "4f81744f978c22832d21f82e52532988"),
        (32, "0e21def3e8e94fc808eb0183b129cac7"),
        (33, "a03038c7ef8a38316503191ca895c760"),
        (63, "9f8e56c8df0387c5c637d876ce332b69"),
        (95, "f62810e755ee7f19e9f6faf904cbee1e"),
        (191, "d6d245acb4a5b86583f8cc8d65e870d9"),
    ],
)
def test_hash_short_message_boundaries_against_independent_spookyhash_vectors(
    length: int, expected: str
) -> None:
    assert unity_hash128("x" * length) == expected


@pytest.mark.parametrize("key", ["", "x" * 192, "\0", "../" + "x" * 190])
def test_hash_rejects_unsupported_keys(key: str) -> None:
    with pytest.raises(ValueError, match=r"Unsupported|Invalid"):
        unity_hash128(key)


def test_duplicate_hash_inputs_are_excluded_without_assigning_by_order() -> None:
    assert baked._supported_keys({"3": "Same", "8": "Same", "556": "Unique"}) == {"556": "Unique"}


def _prefix(script: int, name: str, owner: int = 0) -> bytes:
    return pptr(0, owner) + b"\x01\0\0\0" + pptr(1, script) + aligned_string(name)


def _item_definition(name: str, prefab: str, bundle_id: int = 0) -> bytes:
    return (
        _prefix(1, name)
        + struct.pack("<i", 2)
        + b"\0\0\0\0"
        + aligned_string("Display")
        + pptr(0, 0)
        + aligned_string("description")
        + b"\0" * 16
        + pptr(0, 0)
        + aligned_string(prefab)
        + aligned_string("Items/" + prefab)
        + pptr(0, bundle_id)
    )


@pytest.mark.parametrize(
    ("folder", "bundle_id"), [("Items/", 0), ("Items/Removed Items/", 0), ("Items/", 999)]
)
def test_item_keys_follow_authored_prefab_identity_including_removed_subfolder(
    tmp_path: Path, folder: str, bundle_id: int
) -> None:
    data = tmp_path / "REPO_Data"
    data.mkdir()
    write_serialized_file(
        data / "globalgamemanagers.assets",
        [
            (1, 115, mono_script("Item", "Item")),
            (2, 115, mono_script("ItemAttributes", "ItemAttributes")),
        ],
        unity_version=SUNSTONE_UNITY_VERSION,
    )
    write_serialized_file(
        data / "resources.assets",
        [
            (
                10,
                114,
                _item_definition("Item Definition", "Prefab Identity", bundle_id).replace(
                    aligned_string("Items/Prefab Identity"),
                    aligned_string(folder + "Prefab Identity"),
                ),
            ),
            (
                20,
                1,
                struct.pack("<i", 1)
                + pptr(0, 21)
                + struct.pack("<i", 0)
                + aligned_string("Prefab Identity"),
            ),
            (21, 114, _prefix(2, "", 20) + pptr(0, 10)),
            (
                30,
                1,
                struct.pack("<i", 1)
                + pptr(0, 31)
                + struct.pack("<i", 0)
                + aligned_string("Other Variant"),
            ),
            (31, 114, _prefix(2, "", 30) + pptr(0, 10)),
        ],
        externals=(("globalgamemanagers.assets", "globalgamemanagers.assets"),),
        unity_version=SUNSTONE_UNITY_VERSION,
    )
    expected = {"Item Definition": "Item Definition|Prefab Identity"} if bundle_id == 0 else {}
    assert baked._item_keys(tmp_path) == expected


def _installation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, build_id: str = "26294889"
) -> tuple[Path, Path]:
    library = tmp_path / "library"
    root = library / "steamapps/common/REPO"
    for name in (*baked._SOURCE_NAMES, "REPO_Data/sharedassets0.assets"):
        source = root / name
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(b"synthetic source")
    manifest = library / "steamapps/appmanifest_3241660.acf"
    manifest.write_text(
        f'"AppState" {{"appid" "3241660" "installdir" "REPO" "buildid" "{build_id}"}}',
        encoding="utf-8",
    )
    (root / "REPO_Data/StreamingAssets/aa").mkdir(parents=True)
    (root / "REPO_Data/StreamingAssets/aa/catalog.json").write_text("{}", encoding="utf-8")
    expected = hashlib.sha256(b"synthetic source").hexdigest()
    monkeypatch.setattr(
        baked, "artwork_assembly_sha256", lambda build: expected if build == build_id else None
    )
    monkeypatch.setattr(
        baked,
        "_cosmetic_keys",
        lambda _: (
            {"0": "First", "547": "New", "556": "Last"},
            {root / "REPO_Data/sharedassets0.assets"},
            tuple(InstalledCosmeticMetadata(i, str(i), 0, 0, 0) for i in range(557)),
        ),
    )
    monkeypatch.setattr(baked, "_item_keys", lambda _: {"Item Tool": "Item Tool|Prefab"})
    return root, tmp_path / "metadata-cache"


def test_dynamic_discovery_from_existing_installation_and_steam_manifest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, cache = _installation(tmp_path, monkeypatch)
    discovery = SimpleNamespace(
        installation=GameInstallation(root, root / "REPO_Data/StreamingAssets/aa/catalog.json")
    )
    monkeypatch.setattr(
        "repo_save_editor.services.game.installed_build.discover_game_installation",
        lambda _: discovery,
    )
    result = baked.discover_baked_artwork(cache_dir=cache)
    assert result is not None
    assert result["root"] == str(root)
    assert "itemCacheKeys" not in result
    assert result["cosmetic"]["556"] == unity_hash128("Last") + ".png"
    assert not (root / "REPO_Data/StreamingAssets/BakedIcons").exists()


@pytest.mark.parametrize("build_id", ["26294889", "26407089"])
def test_warm_launch_reuses_metadata_and_preserves_mutation_authority(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, build_id: str
) -> None:
    root, cache = _installation(tmp_path, monkeypatch, build_id)
    catalog = tuple(InstalledCosmeticMetadata(i, str(i), 0, 0, 0) for i in (0, 546, 547, 556, 557))
    before = mutation_eligible_ids(catalog)
    cold = baked.discover_baked_artwork(root, cache_dir=cache)
    assert cold is not None
    monkeypatch.setattr(
        baked, "_cosmetic_keys", lambda _: pytest.fail("warm launch rescanned cosmetics")
    )
    monkeypatch.setattr(baked, "_item_keys", lambda _: pytest.fail("warm launch rescanned items"))
    assert baked.discover_baked_artwork(root, cache_dir=cache) == cold
    assert mutation_eligible_ids(catalog) == before
    assert before == (0, 546, 547, 556)
    assert 557 not in before
    assert {p.suffix for p in cache.iterdir()} == {".json"}


@pytest.mark.parametrize("build_id", ["26294889", "26407089"])
@pytest.mark.parametrize(
    "source", ["REPO_Data/level0", "REPO_Data/resources.assets", "REPO_Data/sharedassets0.assets"]
)
def test_changed_source_invalidates_identity_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, source: str, build_id: str
) -> None:
    root, cache = _installation(tmp_path, monkeypatch, build_id)
    assert baked.discover_baked_artwork(root, cache_dir=cache) is not None
    (root / source).write_bytes(b"changed source")
    seen: list[Path] = []
    monkeypatch.setattr(baked, "_item_keys", lambda p: seen.append(p) or {})
    assert baked.discover_baked_artwork(root, cache_dir=cache) is not None
    assert seen == [root]


@pytest.mark.parametrize("build_id", ["26294889", "26407089"])
@pytest.mark.parametrize("change", ["timestamp", "identity"])
def test_same_content_source_change_rebuilds_cached_mappings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, build_id: str, change: str
) -> None:
    root, cache = _installation(tmp_path, monkeypatch, build_id)
    assert baked.discover_baked_artwork(root, cache_dir=cache) is not None
    source = root / "REPO_Data/level0"
    before = source.stat()
    if change == "identity":
        replacement = source.with_suffix(".replacement")
        replacement.write_bytes(source.read_bytes())
        os.utime(replacement, ns=(before.st_atime_ns, before.st_mtime_ns))
        replacement.replace(source)
        assert source.stat().st_ino != before.st_ino
    else:
        os.utime(source, ns=(before.st_atime_ns, before.st_mtime_ns + 1_000_000_000))
    scans = []
    monkeypatch.setattr(baked, "_item_keys", lambda p: scans.append(p) or {})
    assert baked.discover_baked_artwork(root, cache_dir=cache) is not None
    assert scans == [root]


@pytest.mark.parametrize(
    "damage", ["previous_schema", "missing_catalog", "invalid_id", "unmapped_key"]
)
def test_catalog_cache_migration_and_invalid_projection_rebuild(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    damage: str,
) -> None:
    root, cache = _installation(tmp_path, monkeypatch)
    expected = baked.discover_baked_artwork(root, cache_dir=cache)
    path = cache / "baked-artwork.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    if damage == "previous_schema":
        data["schema"] -= 1
    elif damage == "missing_catalog":
        del data["cosmeticCatalog"]
    elif damage == "invalid_id":
        data["cosmeticCatalog"][547]["id"] = 999
    else:
        data["keys"]["cosmetic"]["557"] = "Unmapped"
    path.write_text(json.dumps(data), encoding="utf-8")
    scans = []
    monkeypatch.setattr(
        baked,
        "_item_keys",
        lambda source: scans.append(source) or {"Item Tool": "Item Tool|Prefab"},
    )
    assert baked.discover_baked_artwork(root, cache_dir=cache) == expected
    assert scans == [root]


@pytest.mark.parametrize("build_id", ["26294889", "26407089"])
def test_bad_assembly_unsupported_build_and_missing_installation_fail_soft(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, build_id: str
) -> None:
    root, cache = _installation(tmp_path, monkeypatch, build_id)
    (root / baked._SOURCE_NAMES[0]).write_bytes(b"unsupported assembly")
    assert baked.discover_baked_artwork(root, cache_dir=cache) is None
    monkeypatch.setattr(
        baked,
        "validated_installed_artwork_build",
        lambda _: ValidatedInstalledBuild("unknown", root.parents[1] / "appmanifest_3241660.acf"),
    )
    assert baked.discover_baked_artwork(root, cache_dir=cache) is None
    assert baked.discover_baked_artwork(tmp_path / "missing", cache_dir=cache) is None


def test_source_changed_during_scan_is_not_cached(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, cache = _installation(tmp_path, monkeypatch)

    def changed(_: Path) -> dict[str, str]:
        (root / "REPO_Data/level0").write_bytes(b"changed during scan")
        return {}

    monkeypatch.setattr(baked, "_item_keys", changed)
    assert baked.discover_baked_artwork(root, cache_dir=cache) is None
    assert not (cache / "baked-artwork.json").exists()


def test_malformed_and_oversized_cache_rebuild_without_trusting_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, cache = _installation(tmp_path, monkeypatch)
    cache.mkdir()
    file = cache / "baked-artwork.json"
    for content in [
        "{",
        "[]",
        json.dumps(
            {"schema": baked.SCHEMA, "root": str(root), "sources": [{"path": "../outside"}]}
        ),
        "x" * (baked.MAX_CACHE_BYTES + 1),
    ]:
        file.write_text(content, encoding="utf-8")
        assert baked.discover_baked_artwork(root, cache_dir=cache) is not None


def test_owned_files_reject_parent_escape_and_nonregular_sources(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match=r"Unsupported|Invalid"):
        baked.owned_file(tmp_path, tmp_path / "../outside")
    with pytest.raises(ValueError, match=r"Unsupported|Invalid"):
        baked.owned_file(tmp_path, tmp_path)


def test_owned_files_reject_junction_escapes(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "outside"
    source.mkdir()
    target.mkdir()
    (target / "file").write_bytes(b"x")
    link = source / "link"
    if os.name == "nt":
        subprocess.run(  # noqa: S603 - Fixed junction command uses temporary paths.
            [
                str(Path(os.environ["SYSTEMROOT"]) / "System32/cmd.exe"),
                "/c",
                "mklink",
                "/J",
                str(link),
                str(target),
            ],
            check=True,
            capture_output=True,
        )
    else:
        link.symlink_to(target, target_is_directory=True)
    with pytest.raises(ValueError, match="reparse"):
        baked.owned_file(source, link / "file")


def test_source_watch_matches_node_runtime_file_identity(tmp_path: Path) -> None:
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is required for the cross-runtime file identity check.")
    source = tmp_path / "source"
    source.write_bytes(b"synthetic source")
    result = subprocess.run(  # noqa: S603 - Fixed Node script reads a temporary fixture.
        [
            node,
            "-e",
            "const s=require('node:fs').statSync(process.argv[1],{bigint:true});process.stdout.write(JSON.stringify({device:String(s.dev),inode:String(s.ino),size:String(s.size),mtimeNs:String(s.mtimeNs)}))",
            str(source),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    watch = baked._watch(tmp_path, source)
    expected = json.loads(result.stdout)
    assert {key: watch[key] for key in expected} == expected


def test_managed_assembly_read_is_bounded_and_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, cache = _installation(tmp_path, monkeypatch)
    assembly = root / baked._SOURCE_NAMES[0]

    class BoundedAssembly(io.BytesIO):
        def read(self, size: int = -1) -> bytes:
            assert size == 32 * 1024 * 1024 + 1
            return super().read(size)

    reader = BoundedAssembly(b"synthetic source")
    original_open = Path.open

    def open_path(path: Path, *args: object, **kwargs: object):
        return reader if path == assembly else original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", open_path)
    assert baked.discover_baked_artwork(root, cache_dir=cache) is not None
    assert reader.closed
