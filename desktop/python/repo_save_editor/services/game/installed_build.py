"""Validated installed-build identity shared by optional read-only metadata features."""

from __future__ import annotations

import os
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from repo_save_editor.services.game.discovery import (
    APP_MANIFEST_NAME,
    STEAM_APP_ID,
    GameInstallation,
    SteamAppManifestError,
    derive_steam_game_root,
    discover_game_installation,
    read_steam_app_manifest,
    validate_game_installation,
)

VALIDATED_BUILD_ID: Final = "23363152"
SUNSTONE_ARTWORK_BUILD_ID: Final = "26294889"
SUNSTONE_ARTWORK_ASSEMBLY_SHA256: Final = (
    "aa6b1ce0deef8d2b7104a3722864c4ba94c107257726471f8e44b45c99e36888"
)
_ARTWORK_BUILD_IDS: Final = frozenset({VALIDATED_BUILD_ID, SUNSTONE_ARTWORK_BUILD_ID})


def owned_file(root: Path, path: Path) -> Path:
    """Reject links/reparse points at every installed-source path component."""
    relative = path.relative_to(root)
    if not relative.parts or any(part in ("", ".", "..") for part in relative.parts):
        raise ValueError("Invalid artwork source path.")
    current = root
    for part in ("", *relative.parts):
        current = current / part
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("Artwork sources may not contain reparse points.")
    if not stat.S_ISREG(info.st_mode) or path.resolve(strict=True) != path:
        raise ValueError("Artwork source is not a regular owned file.")
    return path


@dataclass(frozen=True, slots=True)
class ValidatedInstalledBuild:
    """Steam-backed installation identity accepted by build-specific readers.

    Presence of this value authorizes only the optional readers that explicitly
    support ``build_id``; it does not authorize save mutation.
    """

    build_id: str
    manifest_path: Path


def _path_key(path: Path) -> str:
    return os.path.normpath(os.fspath(path)).replace("\\", "/").casefold()


def steam_manifest_path(installation: GameInstallation) -> Path | None:
    """Return authoritative Steam-manifest provenance recorded by discovery."""
    return installation.manifest_path


def _validated_for_build_ids(
    installation: GameInstallation, supported_build_ids: frozenset[str]
) -> ValidatedInstalledBuild | None:
    """Check authoritative Steam provenance against a domain-specific build set."""
    manifest_path = steam_manifest_path(installation)
    library_root = installation.steam_library_root
    if manifest_path is None or library_root is None:
        return None

    expected_manifest = library_root / "steamapps" / APP_MANIFEST_NAME
    if _path_key(manifest_path) != _path_key(expected_manifest):
        return None
    try:
        manifest = read_steam_app_manifest(manifest_path)
    except (OSError, SteamAppManifestError):
        return None
    if manifest.build_id not in supported_build_ids:
        return None
    if installation.steam_build_id is not None and installation.steam_build_id != manifest.build_id:
        return None

    expected_root = derive_steam_game_root(library_root, manifest.install_dir)
    if expected_root is None:
        return None
    try:
        if _path_key(expected_root.resolve(strict=True)) != _path_key(
            installation.root.resolve(strict=True)
        ):
            return None
    except OSError:
        return None
    return ValidatedInstalledBuild(manifest.build_id, manifest_path)


def validated_installed_build(installation: GameInstallation) -> ValidatedInstalledBuild | None:
    """Require the historical approved build for Recharge-sensitive readers."""
    return _validated_for_build_ids(installation, frozenset({VALIDATED_BUILD_ID}))


def installed_build_identity(installation: GameInstallation) -> ValidatedInstalledBuild | None:
    """Recheck discovered Steam provenance without granting a feature capability."""
    if installation.steam_build_id is None:
        return None
    return _validated_for_build_ids(installation, frozenset({installation.steam_build_id}))


def validated_installed_artwork_build(
    installation: GameInstallation,
) -> ValidatedInstalledBuild | None:
    """Allow explicitly reviewed artwork-only builds without authorizing Recharge."""
    return _validated_for_build_ids(installation, _ARTWORK_BUILD_IDS)


__all__ = [
    "STEAM_APP_ID",
    "SUNSTONE_ARTWORK_ASSEMBLY_SHA256",
    "SUNSTONE_ARTWORK_BUILD_ID",
    "VALIDATED_BUILD_ID",
    "ValidatedInstalledBuild",
    "installed_build_identity",
    "steam_manifest_path",
    "validated_installed_artwork_build",
    "validated_installed_build",
]


def artwork_installation(game_dir: Path | None) -> GameInstallation | None:
    installation = discover_game_installation(game_dir).installation
    if installation is None or installation.manifest_path is not None:
        return installation
    root = installation.root.resolve(strict=True)
    if len(root.parents) < 3:
        return installation
    library = root.parents[2]
    manifest_path = library / "steamapps" / APP_MANIFEST_NAME
    if not manifest_path.is_file():
        return installation
    manifest = read_steam_app_manifest(manifest_path)
    return validate_game_installation(
        root,
        steam_library_root=library,
        manifest_path=manifest_path,
        steam_build_id=manifest.build_id,
    )
