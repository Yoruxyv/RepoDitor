"""Renderer-safe player-upgrade reads for the desktop process boundary."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from pathlib import Path

from repo_save_editor.desktop_api.protocol import DesktopSaveError, _failure
from repo_save_editor.desktop_api.saves import load_discovered_save
from repo_save_editor.services.player.installed_upgrades import (
    discover_installed_upgrade_presentations,
)
from repo_save_editor.services.player.state import get_players
from repo_save_editor.services.player.upgrades import (
    UpgradePresentation,
    discover_player_upgrades,
    get_player_upgrade,
)

PresentationLoader = Callable[[Iterable[str]], Mapping[str, UpgradePresentation]]


def list_upgrades(
    save_id: str,
    root: Path | None = None,
    *,
    presentation_loader: PresentationLoader = discover_installed_upgrade_presentations,
) -> dict[str, object]:
    """Return dynamically discovered upgrades and their per-player values."""
    try:
        _, data, _ = load_discovered_save(save_id, root)
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)

    discovered = discover_player_upgrades(data)
    presentations = presentation_loader(upgrade.key for upgrade in discovered)
    upgrades = discover_player_upgrades(data, presentations)
    player_ids = [player.player_id for player in get_players(data)]
    return {
        "ok": True,
        "upgrades": [
            {
                "key": upgrade.key,
                "label": upgrade.label,
                "presentationSource": upgrade.presentation_source.value,
                "iconKey": upgrade.icon_cache_key,
                "gameplayCap": upgrade.gameplay_cap,
                "values": [
                    {
                        "playerId": player_id,
                        "value": get_player_upgrade(data, player_id, upgrade.key),
                    }
                    for player_id in player_ids
                ],
            }
            for upgrade in upgrades
        ],
    }
