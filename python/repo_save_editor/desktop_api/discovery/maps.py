"""Renderer-safe installed-map discovery for the desktop process boundary."""

from __future__ import annotations

from pathlib import Path

from repo_save_editor.desktop_api.saves import _failure
from repo_save_editor.services.game.maps import MapDiscoveryError, discover_installed_maps


def list_maps(game_dir: Path | None = None) -> dict[str, object]:
    """Return installed maps, or an available-false result when the game is absent."""
    try:
        catalog = discover_installed_maps(game_dir)
    except MapDiscoveryError:
        return _failure(
            "backend_unavailable",
            "Installed map metadata could not be read safely.",
        )

    if catalog is None:
        return {"ok": True, "available": False, "catalogPath": None, "maps": []}

    return {
        "ok": True,
        "available": True,
        "catalogPath": str(catalog.path),
        "maps": [
            {
                "internalName": game_map.internal_name,
                "displayName": game_map.display_name,
                "knownLabel": game_map.known_label,
            }
            for game_map in catalog.maps
        ],
    }
