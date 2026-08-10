"""Renderer-safe player-upgrade reads for the desktop process boundary."""

from __future__ import annotations

from pathlib import Path

from repo_save_editor.desktop_api.saves import DesktopSaveError, _failure, load_discovered_save
from repo_save_editor.services.player.state import get_players
from repo_save_editor.services.player.upgrades import discover_player_upgrades, get_player_upgrade


def list_upgrades(save_id: str, root: Path | None = None) -> dict[str, object]:
    """Return dynamically discovered upgrades and their per-player values."""
    try:
        _, data, _ = load_discovered_save(save_id, root)
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)

    player_ids = [player.player_id for player in get_players(data)]
    return {
        "ok": True,
        "upgrades": [
            {
                "key": upgrade.key,
                "label": upgrade.label,
                "known": upgrade.known,
                "values": [
                    {
                        "playerId": player_id,
                        "value": get_player_upgrade(data, player_id, upgrade.key),
                    }
                    for player_id in player_ids
                ],
            }
            for upgrade in discover_player_upgrades(data)
        ],
    }
