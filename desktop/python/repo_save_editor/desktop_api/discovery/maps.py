"""Renderer-safe installed-map discovery for the desktop process boundary."""

from __future__ import annotations

from pathlib import Path

from repo_save_editor.desktop_api.protocol import _failure
from repo_save_editor.services.baked_artwork import entry_artwork_revision
from repo_save_editor.services.editor_artwork_cache import cached_editor_images
from repo_save_editor.services.game.map_artwork import artwork_revision, decode_map_artwork
from repo_save_editor.services.game.maps import MapDiscoveryError, discover_installed_maps


def list_maps(game_dir: Path | None = None, *, entry_proof: bool = False) -> dict[str, object]:
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
        **({"entryArtworkRevision": entry_artwork_revision()} if entry_proof else {}),
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


def get_native_map_artwork(
    revision: str, family: str, *, persistent: bool = False
) -> dict[str, object]:
    """Return a single admitted preview without forwarding source paths."""
    unavailable: dict[str, object] = {"ok": True, "artwork": None}
    if len(revision) != 64 or any(c not in "0123456789abcdef" for c in revision):
        return unavailable
    result = _native_map_images(revision, (family,), persistent=persistent)
    return {"ok": True, "artwork": result.get(family)}


def _map_preview(family: str, artwork_by_family: dict[str, object]) -> dict[str, object] | None:
    artwork = artwork_by_family.get(family)
    if not isinstance(artwork, dict):
        return None
    return {
        "mapFamily": family,
        **{key: artwork[key] for key in ("sourceIdentity", "width", "height", "pngBase64")},
    }


def get_native_map_artwork_batch(
    revision: str, families: list[str], *, persistent: bool = False
) -> dict[str, object]:
    if (
        len(revision) != 64
        or any(c not in "0123456789abcdef" for c in revision)
        or not 2 <= len(families) <= 5
        or len(set(families)) != len(families)
    ):
        return {"ok": False}
    decoded = _native_map_images(revision, tuple(families), persistent=persistent)
    # Five individually bounded 1 MiB PNGs expand to less than 8 MiB in base64.
    remaining = 8 * 1024 * 1024 - 4096
    results: list[object] = []
    for family in families:
        image = decoded.get(family)
        if isinstance(image, dict):
            size = len(str(image["pngBase64"]))
            if size > remaining:
                results.append(False)
                continue
            remaining -= size
        results.append(image)
    return {"ok": True, "artworks": results}


def _native_map_images(
    revision: str, families: tuple[str, ...], *, persistent: bool
) -> dict[str, dict[str, str | int] | bool | None]:
    def extract(requested: tuple[str, ...]) -> dict[str, dict[str, str | int]]:
        decoded = (
            decode_map_artwork(family=requested[0], expected_revision=revision)
            if len(requested) == 1
            else decode_map_artwork(expected_revision=revision, families=requested)
        )
        return {
            family: {key: value for key, value in image.items() if isinstance(value, (str, int))}
            for family in requested
            if (image := _map_preview(family, decoded)) is not None
        }

    if persistent:
        return cached_editor_images("map", families, extract, map_revision=revision)
    return dict(extract(families))
