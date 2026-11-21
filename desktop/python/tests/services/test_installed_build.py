from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from repo_save_editor.services.game import installed_build
from repo_save_editor.services.game.discovery import (
    APP_MANIFEST_NAME,
    CATALOG_RELATIVE_PATH,
    GameDiscoveryStatus,
    discover_game_installation,
)
from repo_save_editor.services.game.installed_build import (
    SUNSTONE_ARTWORK_BUILD_ID,
    VALIDATED_BUILD_ID,
    artwork_assembly_sha256,
    installed_build_identity,
    validated_installed_artwork_build,
    validated_installed_build,
)


def _steam_install(tmp_path: Path, build_id: str) -> tuple[Path, Path]:
    steam_root = tmp_path / "Steam"
    game_root = steam_root / "steamapps/common/REPO"
    catalog = game_root / CATALOG_RELATIVE_PATH
    catalog.parent.mkdir(parents=True)
    catalog.write_text("{}", encoding="utf-8")
    manifest = steam_root / "steamapps" / APP_MANIFEST_NAME
    manifest.write_text(
        f'"AppState"\n{{\n"appid" "3241660"\n"installdir" "REPO"\n"buildid" "{build_id}"\n}}\n',
        encoding="utf-8",
    )
    return steam_root, game_root


def test_discovery_and_supported_build_validation_are_separate_steps(tmp_path: Path) -> None:
    steam_root, game_root = _steam_install(tmp_path, VALIDATED_BUILD_ID)

    result = discover_game_installation(steam_roots=(steam_root,), environment={})

    assert result.status is GameDiscoveryStatus.FOUND
    assert result.installation is not None
    assert result.installation.root == game_root.resolve()
    build = validated_installed_build(result.installation)
    assert build is not None
    assert build.build_id == VALIDATED_BUILD_ID


def test_discovery_can_succeed_when_build_validation_rejects_candidate(tmp_path: Path) -> None:
    steam_root, _game_root = _steam_install(tmp_path, "99999999")

    result = discover_game_installation(steam_roots=(steam_root,), environment={})

    assert result.status is GameDiscoveryStatus.FOUND
    assert result.installation is not None
    assert validated_installed_build(result.installation) is None


def test_explicit_root_does_not_gain_steam_provenance_from_path_shape(tmp_path: Path) -> None:
    _steam_root, game_root = _steam_install(tmp_path, VALIDATED_BUILD_ID)

    result = discover_game_installation(game_root)

    assert result.status is GameDiscoveryStatus.FOUND
    assert result.installation is not None
    assert result.installation.manifest_path is None
    assert result.installation.steam_library_root is None
    assert validated_installed_build(result.installation) is None


def test_build_validation_rechecks_authoritative_manifest(tmp_path: Path) -> None:
    steam_root, _game_root = _steam_install(tmp_path, VALIDATED_BUILD_ID)
    result = discover_game_installation(steam_roots=(steam_root,), environment={})
    assert result.installation is not None
    manifest = result.installation.manifest_path
    assert manifest is not None

    manifest.write_text(
        '"AppState" { "appid" "3241660" "installdir" "REPO" "buildid" "99999999" }',
        encoding="utf-8",
    )

    assert validated_installed_build(result.installation) is None
    assert installed_build_identity(result.installation) is None


def test_identity_for_an_unreviewed_build_is_not_a_mutation_capability(tmp_path: Path) -> None:
    steam_root, _ = _steam_install(tmp_path, "99999999")
    result = discover_game_installation(steam_roots=(steam_root,), environment={})
    assert result.installation is not None
    identity = installed_build_identity(result.installation)
    assert identity is not None
    assert identity.build_id == "99999999"
    assert validated_installed_build(result.installation) is None


def test_identity_requires_authoritative_provenance(tmp_path: Path) -> None:
    _, game_root = _steam_install(tmp_path, VALIDATED_BUILD_ID)
    installation = discover_game_installation(game_root).installation
    assert installation is not None
    assert installed_build_identity(installation) is None


@pytest.mark.parametrize("build_id", [SUNSTONE_ARTWORK_BUILD_ID, "26407089"])
def test_artwork_compatibility_does_not_authorize_recharge_mutations(
    tmp_path: Path, build_id: str
) -> None:
    steam_root, game_root = _steam_install(tmp_path, build_id)
    result = discover_game_installation(steam_roots=(steam_root,), environment={})
    assert result.installation is not None
    assert result.installation.root == game_root.resolve()
    assert validated_installed_build(result.installation) is None
    artwork = validated_installed_artwork_build(result.installation)
    assert artwork is not None
    assert artwork.build_id == build_id


def test_artwork_digests_are_bound_to_the_reviewed_builds() -> None:
    assert artwork_assembly_sha256("26294889") == (
        "aa6b1ce0deef8d2b7104a3722864c4ba94c107257726471f8e44b45c99e36888"
    )
    assert artwork_assembly_sha256("26407089") == (
        "7df0ff1d03755a71a6755d01fc4c58c3cc044f8aa740f3d1c1379a6d6bd66724"
    )
    assert artwork_assembly_sha256("99999999") is None


@pytest.mark.parametrize(
    "manifest_text",
    [
        '"AppState" {"appid" "1" "installdir" "REPO" "buildid" "26407089"}',
        '"AppState" {"appid" "3241660" "installdir" "Other" "buildid" "26407089"}',
        '"AppState" {"appid" "3241660" "installdir" "REPO" "buildid" "26294889"}',
        '"AppState" {"appid" "3241660" "installdir" "../REPO" "buildid" "26407089"}',
    ],
)
def test_new_artwork_rejects_changed_manifest_provenance(
    tmp_path: Path, manifest_text: str
) -> None:
    library, _ = _steam_install(tmp_path, "26407089")
    installation = discover_game_installation(steam_roots=(library,), environment={}).installation
    assert installation is not None
    assert validated_installed_artwork_build(installation) is not None
    assert installation.manifest_path is not None
    installation.manifest_path.write_text(manifest_text, encoding="utf-8")
    assert validated_installed_artwork_build(installation) is None


def test_artwork_rejects_unreviewed_build(tmp_path: Path) -> None:
    steam_root, _ = _steam_install(tmp_path, "99999999")
    result = discover_game_installation(steam_roots=(steam_root,), environment={})
    assert result.installation is not None
    assert validated_installed_artwork_build(result.installation) is None


@pytest.mark.parametrize("reviewed_build", ["26294889", "26407089"])
def test_build_only_hotfix_requires_reviewed_bytes_without_granting_writes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, reviewed_build: str
) -> None:
    library, root = _steam_install(tmp_path, "99999999")
    assembly = root / "REPO_Data/Managed/Assembly-CSharp.dll"
    assembly.parent.mkdir()
    assembly.write_bytes(b"independently reviewed synthetic assembly")
    digest = hashlib.sha256(assembly.read_bytes()).hexdigest()
    game = discover_game_installation(steam_roots=(library,), environment={}).installation
    assert game is not None
    assert validated_installed_artwork_build(game) is None
    monkeypatch.setitem(installed_build._UNITY6_ARTWORK_ASSEMBLIES, reviewed_build, digest)
    build = validated_installed_artwork_build(game)
    assert build is not None
    assert build.build_id == "99999999"
    assert artwork_assembly_sha256("99999999") is None
    assert validated_installed_build(game) is None
    assembly.write_bytes(b"different assembly, same game/Unity version")
    assert validated_installed_artwork_build(game) is None


def test_known_build_cannot_borrow_another_builds_reviewed_assembly() -> None:
    digest = artwork_assembly_sha256("26407089")
    assert digest is not None
    assert not installed_build.artwork_assembly_matches("26294889", digest)
    assert not installed_build.artwork_assembly_matches(VALIDATED_BUILD_ID, digest)
    assert installed_build.artwork_assembly_matches("99999999", digest)


@pytest.mark.parametrize("damage", ["manifest", "oversized", "source_changed", "reparse"])
def test_hotfix_admission_rejects_invalid_or_changed_sources(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, damage: str
) -> None:
    library, root = _steam_install(tmp_path, "99999999")
    assembly = root / "REPO_Data/Managed/Assembly-CSharp.dll"
    assembly.parent.mkdir()
    assembly.write_bytes(b"reviewed")
    monkeypatch.setitem(
        installed_build._UNITY6_ARTWORK_ASSEMBLIES,
        "26407089",
        hashlib.sha256(b"reviewed").hexdigest(),
    )
    game = discover_game_installation(steam_roots=(library,), environment={}).installation
    assert game is not None
    assert game.manifest_path is not None
    if damage == "manifest":
        game.manifest_path.write_text(
            '"AppState" {"appid" "1" "buildid" "99999999"}', encoding="utf-8"
        )
    elif damage == "oversized":
        with assembly.open("r+b") as handle:
            handle.truncate(32 * 1024 * 1024 + 1)
    elif damage == "reparse":
        original = installed_build.owned_file

        def reject(root: Path, path: Path) -> Path:
            if path == assembly:
                raise ValueError("reparse point")
            return original(root, path)

        monkeypatch.setattr(installed_build, "owned_file", reject)
    else:
        matches = installed_build.artwork_assembly_matches

        def changed(build_id: str, digest: str) -> bool:
            assembly.write_bytes(b"changed during admission")
            return matches(build_id, digest)

        monkeypatch.setattr(installed_build, "artwork_assembly_matches", changed)
    assert validated_installed_artwork_build(game) is None


def test_artwork_build_validation_requires_manifest_provenance(tmp_path: Path) -> None:
    _steam_root, game_root = _steam_install(tmp_path, SUNSTONE_ARTWORK_BUILD_ID)
    result = discover_game_installation(game_root)
    assert result.installation is not None
    assert validated_installed_artwork_build(result.installation) is None


def test_artwork_build_validation_rechecks_manifest_changes(tmp_path: Path) -> None:
    steam_root, _ = _steam_install(tmp_path, SUNSTONE_ARTWORK_BUILD_ID)
    result = discover_game_installation(steam_roots=(steam_root,), environment={})
    assert result.installation is not None
    manifest = result.installation.manifest_path
    assert manifest is not None
    manifest.write_text(
        '"AppState" { "appid" "3241660" "installdir" "REPO" "buildid" "99999999" }',
        encoding="utf-8",
    )
    assert validated_installed_artwork_build(result.installation) is None
