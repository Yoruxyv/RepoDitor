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


def validated_installed_build(installation: GameInstallation) -> ValidatedInstalledBuild | None:
    """Validate supported build identity independently from installation discovery."""
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
    if manifest.build_id != VALIDATED_BUILD_ID:
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
    return ValidatedInstalledBuild(VALIDATED_BUILD_ID, manifest_path)


__all__ = [
    "STEAM_APP_ID",
    "VALIDATED_BUILD_ID",
    "ValidatedInstalledBuild",
    "steam_manifest_path",
    "validated_installed_build",
]
