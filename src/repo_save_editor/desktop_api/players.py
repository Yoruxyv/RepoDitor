"""Renderer-safe player reads for the desktop process boundary."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from repo_save_editor.desktop_api.saves import DesktopSaveError, _failure, load_discovered_save
from repo_save_editor.services.players import get_player_health, get_players
from repo_save_editor.services.steam_profiles import get_steam_avatar_url


def list_players(save_id: str, root: Path | None = None) -> dict[str, object]:
    """Return friendly player identity and current-health DTOs."""
    try:
        _, data = load_discovered_save(save_id, root)
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)

    return {
        "ok": True,
        "players": [
            {
                "id": player.player_id,
                "name": player.name,
                "health": get_player_health(data, player.player_id),
            }
            for player in get_players(data)
        ],
    }


def get_player_avatar(
    save_id: str,
    player_id: str,
    root: Path | None = None,
    *,
    resolver: Callable[[str], str | None] = get_steam_avatar_url,
) -> dict[str, object]:
    """Resolve one optional avatar only for a player present in the selected save."""
    try:
        _, data = load_discovered_save(save_id, root)
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)

    if player_id not in {player.player_id for player in get_players(data)}:
        return _failure("invalid_request", "The selected player is not present in this save.")

    return {
        "ok": True,
        "avatar": {
            "playerId": player_id,
            "avatarUrl": resolver(player_id),
        },
    }
