"""Installed-game recharge-capability discovery for item types."""

from __future__ import annotations

import re
from collections.abc import Iterable
from functools import lru_cache
from pathlib import Path
from typing import Final

from repo_save_editor.services.game.discovery import (
    GameInstallation,
    discover_game_installation,
)
from repo_save_editor.services.items.installed_metadata import (
    discover_installed_item_metadata as discover_installed_item_metadata_from_assets,
)
from repo_save_editor.services.items.models import InstalledItemMetadata, ItemRechargeCapability

STEAM_APP_ID: Final = "3241660"
VALIDATED_BUILD_ID: Final = "23363152"
RESOURCES_RELATIVE_PATH: Final = Path("REPO_Data/resources.assets")
GLOBAL_MANAGERS_RELATIVE_PATH: Final = Path("REPO_Data/globalgamemanagers.assets")
APP_MANIFEST_NAME: Final = f"appmanifest_{STEAM_APP_ID}.acf"
BUILD_ID_PATTERN: Final = re.compile(r'"buildid"\s+"(?P<buildid>\d+)"', re.IGNORECASE)


def _manifest_path(installation: GameInstallation) -> Path | None:
    if installation.steam_library_root is not None:
        return installation.steam_library_root / "steamapps" / APP_MANIFEST_NAME
    root = installation.root
    try:
        if (
            root.parent.name.casefold() == "common"
            and root.parent.parent.name.casefold() == "steamapps"
        ):
            return root.parent.parent / APP_MANIFEST_NAME
    except IndexError:
        return None
    return None


def _validated_build(installation: GameInstallation) -> bool:
    manifest = _manifest_path(installation)
    if manifest is None:
        return False
    try:
        text = manifest.read_text(encoding="utf-8", errors="strict")
    except (OSError, UnicodeError):
        return False
    match = BUILD_ID_PATTERN.search(text)
    return match is not None and match.group("buildid") == VALIDATED_BUILD_ID


def discover_installed_recharge_capabilities(
    item_names: Iterable[str],
    game_dir: Path | None = None,
) -> dict[str, ItemRechargeCapability]:
    """Return conservative installed-game recharge capability for requested item types.

    Only the validated installed-game build is supported. Missing
    discovery, a different Steam build, missing assets, or any parser/layout
    mismatch returns ``unknown`` rather than affecting save reads.
    """
    return {
        name: metadata.recharge_capability
        for name, metadata in discover_installed_item_metadata(item_names, game_dir).items()
    }


def discover_installed_item_metadata(
    item_names: Iterable[str],
    game_dir: Path | None = None,
) -> dict[str, InstalledItemMetadata]:
    """Return conservative installed icon and recharge metadata for item types."""
    names = tuple(dict.fromkeys(name for name in item_names if isinstance(name, str) and name))
    unknown = {name: InstalledItemMetadata(ItemRechargeCapability.UNKNOWN, None) for name in names}
    if not names:
        return {}
    discovery = discover_game_installation(game_dir)
    installation = discovery.installation
    if installation is None or not _validated_build(installation):
        return unknown
    resources_path = installation.root / RESOURCES_RELATIVE_PATH
    global_managers_path = installation.root / GLOBAL_MANAGERS_RELATIVE_PATH
    try:
        if not resources_path.is_file() or not global_managers_path.is_file():
            return unknown
    except OSError:
        return unknown
    try:
        resources_stat = resources_path.stat()
        globals_stat = global_managers_path.stat()
    except OSError:
        return unknown
    discovered = dict(
        _cached_item_metadata(
            resources_path,
            resources_stat.st_size,
            resources_stat.st_mtime_ns,
            global_managers_path,
            globals_stat.st_size,
            globals_stat.st_mtime_ns,
            names,
        )
    )
    return {name: discovered.get(name, unknown[name]) for name in names}


@lru_cache(maxsize=16)
def _cached_item_metadata(
    resources_path: Path,
    _resources_size: int,
    _resources_mtime_ns: int,
    global_managers_path: Path,
    _globals_size: int,
    _globals_mtime_ns: int,
    names: tuple[str, ...],
) -> tuple[tuple[str, InstalledItemMetadata], ...]:
    """Cache derived metadata by requested identities and installed file identity."""
    return tuple(
        discover_installed_item_metadata_from_assets(
            resources_path, global_managers_path, names
        ).items()
    )


__all__ = ["discover_installed_item_metadata", "discover_installed_recharge_capabilities"]
