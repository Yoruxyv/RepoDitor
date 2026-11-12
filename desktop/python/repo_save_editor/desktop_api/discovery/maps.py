"""Renderer-safe installed-map discovery for the desktop process boundary."""

from __future__ import annotations

from pathlib import Path

from repo_save_editor.desktop_api.protocol import _failure
from repo_save_editor.services.game.map_artwork import artwork_revision, decode_map_artwork
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

    revision = artwork_revision(catalog)
    return {
        "ok": True,
        "available": True,
        "catalogPath": str(catalog.path),
        "maps": [
            {
                "internalName": game_map.internal_name,
                "displayName": game_map.display_name,
                "knownLabel": game_map.known_label,
                "artworkRevision": revision if game_map.loading_paths else None,
            }
            for game_map in catalog.maps
        ],
    }


def get_native_map_artwork(revision: str, family: str) -> dict[str, object]:
    """Return a single admitted preview without forwarding source paths."""
    unavailable: dict[str, object] = {"ok": True, "artwork": None}
    if len(revision) != 64 or any(c not in "0123456789abcdef" for c in revision):
        return unavailable
    artwork = decode_map_artwork(family=family, expected_revision=revision).get(family)
    if not isinstance(artwork, dict):
        return unavailable
    return {
        "ok": True,
        "artwork": {
            "mapFamily": family,
            **{key: artwork[key] for key in ("sourceIdentity", "width", "height", "pngBase64")},
        },
    }
