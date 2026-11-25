"""Save queries, startup preparation, and artwork streaming for the sidecar CLI."""

# Route imports keep command-specific dependencies out of unrelated processes.
# ruff: noqa: PLC0415

from __future__ import annotations

import argparse
import json
import os
import sys
from functools import partial
from time import perf_counter

from repo_save_editor.desktop_api.protocol import invalid_request


def _missing_save() -> dict[str, object]:
    return invalid_request("The required save or player ID is missing.")


def open_save(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.saves.saves import open_save
    from repo_save_editor.services.artwork.baked_artwork import entry_artwork_revision

    if args.save_id is None:
        return _missing_save()
    started = perf_counter()
    current_revision = entry_artwork_revision() if args.entry_revision is not None else None
    source_verified = perf_counter()
    result = open_save(args.save_id)
    if os.environ.get("REPODITOR_PROFILE_TIMING") == "1":
        print(
            f"REPODITOR_PROFILE_SOURCE_MS={(source_verified - started) * 1000:.2f}\n"
            f"REPODITOR_PROFILE_SAVE_MS={(perf_counter() - source_verified) * 1000:.2f}",
            file=sys.stderr,
        )
    if result["ok"] is True and args.native:
        result["supportsEntryBatch"] = True
        if current_revision is not None and current_revision == args.entry_revision:
            result["verifiedEntryRevision"] = current_revision
    return result


def list_maps(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.discovery.maps import list_maps
    from repo_save_editor.desktop_api.saves.saves import open_save

    catalog = list_maps(entry_proof=args.entry_artwork_proof)
    if not catalog["ok"] or args.verify_save is None:
        return catalog
    opened = open_save(args.verify_save)
    if not opened["ok"]:
        return opened
    session = opened.get("session")
    if isinstance(session, dict) and session.get("id") == args.verify_save:
        catalog["entrySaveFingerprint"] = session.get("fingerprint")
    return catalog


def list_players(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.player.players import list_players

    return (
        _missing_save()
        if args.save_id is None
        else list_players(args.save_id, include_fingerprint=True)
    )


def player_avatar(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.player.players import get_player_avatar

    if args.save_id is None or args.player_id is None:
        return _missing_save()
    return get_player_avatar(args.save_id, args.player_id)


def list_upgrades(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.player.upgrades import list_upgrades
    from repo_save_editor.services.artwork.baked_artwork import entry_artwork_revision
    from repo_save_editor.services.items.recharge_capability import (
        discover_installed_item_metadata,
    )
    from repo_save_editor.services.player.installed_upgrades import (
        discover_installed_upgrade_presentations,
    )

    if args.save_id is None:
        return _missing_save()
    if not args.reuse_installed_metadata:
        return list_upgrades(args.save_id)
    revision = entry_artwork_revision()
    result = list_upgrades(
        args.save_id,
        presentation_loader=partial(
            discover_installed_upgrade_presentations,
            metadata_loader=partial(discover_installed_item_metadata, reuse_native_metadata=True),
        ),
    )
    if result.get("ok") is True and revision and revision == entry_artwork_revision():
        result["artworkRevision"] = revision
    return result


def upgrade_texture(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.icons import get_upgrade_texture

    if args.upgrade_key is None:
        return invalid_request("The required upgrade identity is missing.")
    return get_upgrade_texture(args.upgrade_key)


def native_upgrade_artwork(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.icons import get_native_upgrade_artwork

    return get_native_upgrade_artwork(
        args.save_id, args.fingerprint, args.upgrade_key, persistent=True
    )


def cosmetic_artwork(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.cosmetics.cosmetic_artwork import get_cosmetic_artwork

    if args.cosmetic_id is None:
        return invalid_request("A canonical cosmetic ID is required.")
    return get_cosmetic_artwork(args.cosmetic_id)


def prepare_cosmetics(_args: argparse.Namespace) -> None:
    from repo_save_editor.desktop_api.cosmetics.cosmetic_preparation import (
        parse_cosmetic_ids,
        stream_cosmetic_artwork,
    )

    def emit(record: dict[str, object]) -> None:
        print(json.dumps(record, separators=(",", ":")), flush=True)

    try:
        ids = parse_cosmetic_ids(sys.stdin.buffer)
    except ValueError:
        emit({"type": "final", "ok": False, "completed": 0, "total": 0})
        return
    stream_cosmetic_artwork(ids, emit)


def prepare_assets(_args: argparse.Namespace) -> None:
    from repo_save_editor.desktop_api.editor.game_assets import (
        prepare_game_assets,
        read_upgrade_keys_stdin,
    )

    def emit(record: dict[str, object]) -> None:
        print(json.dumps(record, separators=(",", ":")), flush=True)

    try:
        upgrade_keys = read_upgrade_keys_stdin(sys.stdin.buffer)
    except ValueError:
        emit(
            {
                "type": "final",
                "ok": False,
                "installationFound": False,
                "buildVerified": False,
                "completed": None,
                "total": None,
                "degraded": True,
                "error": {
                    "code": "invalid_request",
                    "message": "The upgrade preparation payload is invalid.",
                },
            }
        )
        return
    prepare_game_assets(upgrade_keys, emit)


def run_state(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.saves.run import get_run_state

    return (
        _missing_save()
        if args.save_id is None
        else get_run_state(args.save_id, include_fingerprint=True)
    )


def advanced_save(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.items import get_advanced_save

    if args.save_id is None:
        return _missing_save()
    return get_advanced_save(args.save_id, reuse_native_metadata=args.reuse_installed_metadata)


def discover_environment(_args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.discovery.environment import (
        discover_environment,
    )

    return discover_environment()


def get_game_status(_args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.editor.game_status import get_game_status

    return get_game_status()


def decode_map_artwork(_args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.services.game.map_artwork import decode_map_artwork

    return {"ok": True, "artworks": decode_map_artwork()}


def get_native_map_artwork(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.discovery.maps import get_native_map_artwork

    return get_native_map_artwork(args.revision, args.family, persistent=True)


def get_native_map_artwork_batch(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.discovery.maps import (
        get_native_map_artwork_batch,
    )

    return get_native_map_artwork_batch(args.revision, args.families, persistent=True)


def get_icon_roots(_args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.icons import get_icon_roots

    return get_icon_roots()


def get_baked_artwork(_args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.icons import get_baked_artwork

    return get_baked_artwork()


def get_native_cosmetics(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.cosmetics.cosmetic_artwork import get_native_cosmetics
    from repo_save_editor.desktop_api.cosmetics.cosmetics import get_cosmetics

    return (
        get_native_cosmetics(warm_artwork=args.warm_artwork)
        if args.native_artwork
        else get_cosmetics()
    )


def get_native_cosmetic_artwork(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.cosmetics.cosmetic_artwork import (
        get_native_cosmetic_artwork,
    )

    return get_native_cosmetic_artwork(args.fingerprint, args.proof, args.identity)


def get_native_cosmetic_artwork_batch(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.cosmetics.cosmetic_artwork import (
        get_native_cosmetic_artwork_batch,
    )

    return get_native_cosmetic_artwork_batch(args.fingerprint, args.members)


def prepare_editor_entry(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.editor.editor_entry import prepare_editor_entry

    return prepare_editor_entry(args.save_id, args.fingerprint)


def get_native_upgrade_artwork_batch(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.icons import get_native_upgrade_artwork_batch

    return get_native_upgrade_artwork_batch(
        args.save_id, args.fingerprint, args.keys, persistent=True
    )


def get_native_item_artwork(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.icons import get_native_item_artwork

    return get_native_item_artwork(args.save_id, args.fingerprint, args.item_name, persistent=True)


def get_native_item_artwork_batch(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.icons import get_native_item_artwork_batch

    return get_native_item_artwork_batch(
        args.save_id, args.fingerprint, args.names, persistent=True
    )
