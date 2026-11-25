"""Focused tests for installed_reader_native and production_meta fail-closed paths."""

from __future__ import annotations

import json
from contextlib import nullcontext
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace

import pytest

from repo_save_editor.desktop_api.transactions import production_meta as meta_admission
from repo_save_editor.services.cosmetics import installed_reader as pinned_reader
from repo_save_editor.services.cosmetics import installed_reader_native as native_reader
from repo_save_editor.services.cosmetics.installed_catalog import _catalog_payload
from repo_save_editor.services.unity_serialized import UnityMetadataError
from repo_save_editor.storage.health_recovery import RecoveryError
from tests.services.test_installed_cosmetic_catalog import _build_install


def test_native_reader_matches_pinned_catalog_identities_and_targets(tmp_path: Path) -> None:
    root, _level, _target, _manifest = _build_install(
        tmp_path,
        names=("Cowboy Hat", "Cowboy boot", "Cowboy boot", "Neck Bandana"),
        unity_version="6000.3.17f1",
        build_id="26294889",
    )
    pinned_catalog, pinned_targets = pinned_reader.read_installed_catalog(root)
    delegated_catalog, delegated_targets = native_reader.read_installed_catalog(root, native=False)
    native_catalog, native_targets = native_reader.read_installed_catalog(root, native=True)

    assert delegated_catalog == pinned_catalog
    assert delegated_targets == pinned_targets
    assert native_catalog == pinned_catalog
    assert native_targets == pinned_targets
    assert [(entry.cosmetic_id, entry.asset_name) for entry in native_catalog] == [
        (0, "Cowboy Hat"),
        (1, "Cowboy boot"),
        (2, "Cowboy boot"),
        (3, "Neck Bandana"),
    ]


def test_native_resolver_rejects_external_escape_and_file_limit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, _level, _target, _manifest = _build_install(
        tmp_path,
        unity_version="6000.3.17f1",
        build_id="26294889",
    )
    outside = tmp_path / "outside.assets"
    outside.write_bytes(b"outside")
    with native_reader.NativeCosmeticCatalogResolver(root / "REPO_Data") as resolver:
        with pytest.raises(ValueError, match=r"subpath|relative|Invalid"):
            resolver.open(outside)
        with pytest.raises(ValueError, match="Invalid artwork source path"):
            resolver.open(root / "REPO_Data" / ".." / "outside.assets")
        assert not resolver._indexes

    monkeypatch.setattr(native_reader, "MAX_OPEN_FILES", 1)
    with native_reader.NativeCosmeticCatalogResolver(root / "REPO_Data") as resolver:
        resolver.open(root / "REPO_Data" / "level0")
        with pytest.raises(UnityMetadataError, match="Too many serialized files"):
            resolver.open(root / "REPO_Data" / "globalgamemanagers.assets")


def test_native_reader_rejects_unreviewed_unity_version(tmp_path: Path) -> None:
    root, level0, _target, _manifest = _build_install(
        tmp_path,
        unity_version="6000.3.17f1",
        build_id="26294889",
    )
    level0.write_bytes(level0.read_bytes().replace(b"6000.3.17f1", b"6000.9.99f1"))
    with pytest.raises(UnityMetadataError, match="version"):
        native_reader.read_installed_catalog(root, native=True)


def test_production_meta_verified_catalog_checks_digest_cache_and_source_pins(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, level0, target, _manifest = _build_install(
        tmp_path,
        names=("Hat", "Hat", "Glasses"),
        unity_version="6000.3.17f1",
        build_id="26732417",
    )
    expected_catalog, _ = native_reader.read_installed_catalog(root, native=True)
    expected_payload = json.dumps(_catalog_payload(expected_catalog), sort_keys=True).encode()
    expected_digest = sha256(expected_payload).hexdigest()
    sources = (
        ("REPO_Data/level0", sha256(level0.read_bytes()).hexdigest()),
        (
            "REPO_Data/globalgamemanagers.assets",
            sha256((root / "REPO_Data" / "globalgamemanagers.assets").read_bytes()).hexdigest(),
        ),
        ("REPO_Data/sharedassets9.assets", sha256(target.read_bytes()).hexdigest()),
    )

    published: list[tuple[str, str, bytes]] = []
    tampered_frame = expected_payload.replace(b"Glasses", b"Tampered")
    cache = SimpleNamespace(
        editor_frame=lambda *_: tampered_frame,
        publish_editor_frame=lambda scope, rev, data: published.append((scope, rev, data)),
    )
    monkeypatch.setattr(meta_admission, "native_artwork_cache", lambda *_, **__: nullcontext(cache))

    meta_admission._read_qualified_catalog.cache_clear()
    try:
        # 1. Tampered cache frame is ignored; real native reader verifies exact digest & publishes.
        verified = meta_admission._verified_catalog(root, sources, expected_digest, True)
        assert verified == expected_catalog
        assert published == [("cosmetic-metadata", expected_digest, expected_payload)]

        # 2. Wrong catalog digest fails closed without publishing unverified bytes.
        published.clear()
        meta_admission._read_qualified_catalog.cache_clear()
        with pytest.raises(RecoveryError, match="save_unsupported"):
            meta_admission._verified_catalog(root, sources, "0" * 64, True)
        assert published == []

        # 3. Any source-file modification fails closed before/after native catalog reading.
        target.write_bytes(target.read_bytes().replace(b"Glasses", b"Mutated"))
        meta_admission._read_qualified_catalog.cache_clear()
        with pytest.raises(RecoveryError, match="save_unsupported"):
            meta_admission._verified_catalog(root, sources, expected_digest, True)
    finally:
        meta_admission._read_qualified_catalog.cache_clear()
