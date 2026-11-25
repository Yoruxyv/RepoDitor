"""Prepare native editor views from one verified save snapshot."""

from __future__ import annotations

from hashlib import sha256
from typing import TYPE_CHECKING

from repo_save_editor.desktop_api.discovery.maps import list_maps
from repo_save_editor.desktop_api.items import editor_item_metadata, serialize_advanced_save
from repo_save_editor.desktop_api.player.players import serialize_players
from repo_save_editor.desktop_api.player.upgrades import serialize_upgrades
from repo_save_editor.desktop_api.protocol import DesktopSaveError, _failure
from repo_save_editor.desktop_api.saves.run import serialize_run
from repo_save_editor.desktop_api.saves.saves import load_discovered_save, open_save
from repo_save_editor.services.artwork.baked_artwork import entry_artwork_revision
from repo_save_editor.services.items.discovery import discover_item_type_names
from repo_save_editor.services.items.models import AdvancedSaveError
from repo_save_editor.services.player.installed_upgrades import (
    discover_installed_upgrade_presentations,
)
from repo_save_editor.services.player.upgrades import discover_player_upgrades

if TYPE_CHECKING:
    from pathlib import Path


def prepare_editor_entry(
    save_id: str, fingerprint: str, root: Path | None = None
) -> dict[str, object]:
    """Produce the existing view DTOs and check the save again after discovery."""
    try:
        _, data, source = load_discovered_save(save_id, root)
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)
    if sha256(source).hexdigest() != fingerprint:
        return _failure("save_stale", "The selected save changed during editor preparation.")

    initial_revision = entry_artwork_revision()
    keys = [upgrade.key for upgrade in discover_player_upgrades(data)]
    try:
        item_names = discover_item_type_names(data)
    except AdvancedSaveError:
        # The item projection still reports its own domain error below.
        item_names = ()
    metadata = editor_item_metadata(item_names, keys)
    presentation = discover_installed_upgrade_presentations(
        keys, metadata_loader=lambda _: metadata
    )
    prepared = {
        "players": {"ok": True, "players": serialize_players(data)},
        "upgrades": {"ok": True, "upgrades": serialize_upgrades(data, presentation)},
        "run": {"ok": True, "run": serialize_run(data)},
        "items": serialize_advanced_save(data, metadata_loader=lambda _: metadata),
        "maps": list_maps(entry_proof=True),
    }
    verified = open_save(save_id, root)
    if verified["ok"] is not True:
        return verified
    session = verified.get("session")
    if not isinstance(session, dict) or session.get("fingerprint") != fingerprint:
        return _failure("save_stale", "The selected save changed during editor preparation.")
    artwork_revision = (
        initial_revision
        if initial_revision == prepared["maps"].get("entryArtworkRevision")
        else None
    )
    # Incomplete metadata is retried on reopen, independently of the installed artwork proof.
    cache_revision = (
        artwork_revision
        if not metadata or any(item.canonical_name is not None for item in metadata.values())
        else None
    )
    return {
        "ok": True,
        "fingerprint": fingerprint,
        "artworkRevision": artwork_revision,
        "cacheRevision": cache_revision,
        **prepared,
    }
