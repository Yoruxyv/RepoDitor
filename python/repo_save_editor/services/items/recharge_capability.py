"""Installed-game recharge-capability discovery for item types."""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path
from typing import Final

from repo_save_editor.services.game.discovery import (
    GameInstallation,
    discover_game_installation,
)
from repo_save_editor.services.items.models import ItemRechargeCapability
from repo_save_editor.services.items.unity_serialized import discover_item_recharge_capabilities

STEAM_APP_ID: Final = "3241660"
VALIDATED_BUILD_ID: Final = "23363152"
RESOURCES_RELATIVE_PATH: Final = Path("REPO_Data/resources.assets")
GLOBAL_MANAGERS_RELATIVE_PATH: Final = Path("REPO_Data/globalgamemanagers.assets")
APP_MANIFEST_NAME: Final = f"appmanifest_{STEAM_APP_ID}.acf"
BUILD_ID_PATTERN: Final = re.compile(r'"buildid"\s+"(?P<buildid>\d+)"', re.IGNORECASE)


def _unknown(item_names: Iterable[str]) -> dict[str, ItemRechargeCapability]:
    return {
        name: ItemRechargeCapability.UNKNOWN
        for name in dict.fromkeys(item_names)
        if isinstance(name, str) and name
    }


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
    names = tuple(dict.fromkeys(name for name in item_names if isinstance(name, str) and name))
    unknown = _unknown(names)
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

    discovered = discover_item_recharge_capabilities(
        resources_path,
        global_managers_path,
        names,
    )
    return {name: discovered.get(name, ItemRechargeCapability.UNKNOWN) for name in names}


__all__ = ["discover_installed_recharge_capabilities"]
