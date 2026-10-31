"""Validated installed-build identity shared by optional read-only metadata features."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from repo_save_editor.services.game.discovery import (
    APP_MANIFEST_NAME,
    STEAM_APP_ID,
    GameInstallation,
    SteamAppManifestError,
    derive_steam_game_root,
    read_steam_app_manifest,
)

VALIDATED_BUILD_ID: Final = "23363152"
SUNSTONE_ARTWORK_BUILD_ID: Final = "26294889"
_ARTWORK_BUILD_IDS: Final = frozenset({VALIDATED_BUILD_ID, SUNSTONE_ARTWORK_BUILD_ID})


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


def validated_installed_artwork_build(
    installation: GameInstallation,
) -> ValidatedInstalledBuild | None:
    """Allow explicitly reviewed artwork-only builds without authorizing Recharge."""
    return _validated_for_build_ids(installation, _ARTWORK_BUILD_IDS)


__all__ = [
    "STEAM_APP_ID",
    "VALIDATED_BUILD_ID",
    "SUNSTONE_ARTWORK_BUILD_ID",
    "validated_installed_artwork_build",
    "ValidatedInstalledBuild",
    "steam_manifest_path",
    "validated_installed_build",
]
