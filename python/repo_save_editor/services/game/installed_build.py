"""Validated installed-build identity shared by optional read-only metadata features."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from repo_save_editor.services.game.discovery import GameInstallation

STEAM_APP_ID: Final = "3241660"
VALIDATED_BUILD_ID: Final = "23363152"
APP_MANIFEST_NAME: Final = f"appmanifest_{STEAM_APP_ID}.acf"
BUILD_ID_PATTERN: Final = re.compile(r'"buildid"\s+"(?P<buildid>\d+)"', re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class ValidatedInstalledBuild:
    build_id: str
    manifest_path: Path


def steam_manifest_path(installation: GameInstallation) -> Path | None:
    """Return the fixed Steam app manifest belonging to this installation, when derivable."""
    if installation.steam_library_root is not None:
        return installation.steam_library_root / "steamapps" / APP_MANIFEST_NAME
    root = installation.root
    if root.parent.name.casefold() == "common" and root.parent.parent.name.casefold() == "steamapps":
        return root.parent.parent / APP_MANIFEST_NAME
    return None


def validated_installed_build(installation: GameInstallation) -> ValidatedInstalledBuild | None:
    """Return the validated Steam build identity, otherwise fail closed."""
    manifest = steam_manifest_path(installation)
    if manifest is None:
        return None
    try:
        text = manifest.read_text(encoding="utf-8", errors="strict")
    except (OSError, UnicodeError):
        return None
    match = BUILD_ID_PATTERN.search(text)
    if match is None or match.group("buildid") != VALIDATED_BUILD_ID:
        return None
    return ValidatedInstalledBuild(VALIDATED_BUILD_ID, manifest)


__all__ = [
    "STEAM_APP_ID",
    "VALIDATED_BUILD_ID",
    "ValidatedInstalledBuild",
    "steam_manifest_path",
    "validated_installed_build",
]
