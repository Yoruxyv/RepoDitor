"""Command-line entry point for the bundled RepoDitor desktop sidecar."""

from __future__ import annotations

import argparse
import json
import os
import sys
from time import perf_counter

from repo_save_editor.core.save_resources import bounded_save_operation
from repo_save_editor.desktop_api import read_commands
from repo_save_editor.desktop_api.transactions import cli as transaction_commands


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="repo_save_editor.desktop_api")
    commands = parser.add_subparsers(dest="command", required=True)

    for prefix in ("", "production-"):
        meta_status = commands.add_parser(prefix + "meta-state")
        meta_status.add_argument("operation", nargs="?")
        meta_status.set_defaults(handler=transaction_commands.meta_transaction)
        for name in ("meta-prepare", "meta-write"):
            meta = commands.add_parser(prefix + name)
            meta.add_argument("operation")
            meta.add_argument("fingerprint")
            meta.add_argument("payload")
            meta.add_argument("namespace")
            meta.set_defaults(handler=transaction_commands.meta_transaction)
        meta_recovery = commands.add_parser(prefix + "meta-recover")
        meta_recovery.add_argument("operation")
        meta_recovery.add_argument("proof")
        meta_recovery.set_defaults(handler=transaction_commands.meta_transaction)

    commands.add_parser("environment").set_defaults(handler=read_commands.discover_environment)
    commands.add_parser("game-status").set_defaults(handler=read_commands.get_game_status)
    maps_list = commands.add_parser("maps-list")
    maps_list.add_argument("--entry-artwork-proof", action="store_true")
    maps_list.add_argument("--verify-save")
    maps_list.set_defaults(handler=read_commands.list_maps)
    commands.add_parser("maps-artwork").set_defaults(handler=read_commands.decode_map_artwork)
    map_artwork = commands.add_parser("map-artwork")
    map_artwork.add_argument("revision")
    map_artwork.add_argument("family")
    map_artwork.set_defaults(handler=read_commands.get_native_map_artwork)
    map_batch = commands.add_parser("map-artwork-batch")
    map_batch.add_argument("revision")
    map_batch.add_argument("families", nargs="+")
    map_batch.set_defaults(handler=read_commands.get_native_map_artwork_batch)
    commands.add_parser("icons-roots").set_defaults(handler=read_commands.get_icon_roots)
    commands.add_parser("baked-artwork").set_defaults(handler=read_commands.get_baked_artwork)
    cosmetics_get = commands.add_parser("cosmetics-get")
    cosmetics_get.add_argument("--native-artwork", action="store_true")
    cosmetics_get.add_argument("--warm-artwork", action="store_true")
    cosmetics_get.set_defaults(handler=read_commands.get_native_cosmetics)
    native_cosmetic = commands.add_parser("native-cosmetic-artwork")
    native_cosmetic.add_argument("fingerprint")
    native_cosmetic.add_argument("proof")
    native_cosmetic.add_argument("identity")
    native_cosmetic.set_defaults(handler=read_commands.get_native_cosmetic_artwork)

    native_batch = commands.add_parser("native-cosmetic-artwork-batch")
    native_batch.add_argument("fingerprint")
    native_batch.add_argument("members", nargs="+")
    native_batch.set_defaults(handler=read_commands.get_native_cosmetic_artwork_batch)
    commands.add_parser("cosmetics-prepare").set_defaults(
        handler=read_commands.prepare_cosmetics, streaming=True
    )
    cosmetic_artwork = commands.add_parser("cosmetic-artwork")
    cosmetic_artwork.add_argument("cosmetic_id", nargs="?")
    cosmetic_artwork.set_defaults(handler=read_commands.cosmetic_artwork)

    saves_open = commands.add_parser("saves-open")
    saves_open.add_argument("save_id", nargs="?")
    saves_open.add_argument("--native", action="store_true")
    saves_open.add_argument("--entry-revision")
    saves_open.set_defaults(handler=read_commands.open_save)

    editor_entry = commands.add_parser("editor-entry")
    editor_entry.add_argument("save_id")
    editor_entry.add_argument("fingerprint")
    editor_entry.set_defaults(handler=read_commands.prepare_editor_entry)

    saves_write = commands.add_parser("saves-write")
    saves_write.add_argument("save_id", nargs="?")
    saves_write.add_argument("fingerprint", nargs="?")
    saves_write.add_argument("payload", nargs="?")
    saves_write.add_argument("recharge_evidence", nargs="?")
    transaction = saves_write.add_mutually_exclusive_group()
    transaction.add_argument("--health-operation")
    transaction.add_argument("--health-batch-operation")
    transaction.add_argument("--refill-operation")
    transaction.add_argument("--upgrade-operation")
    transaction.add_argument("--run-operation")
    transaction.add_argument("--mixed-operation")
    saves_write.set_defaults(handler=transaction_commands.save_changes)

    production = commands.add_parser("production-health")
    production.add_argument(
        "action", choices=("state", "prepare", "write", "apply", "inspect", "acknowledge")
    )
    production.add_argument("save_id")
    production.add_argument("operation", nargs="?", default="")
    production.add_argument("fingerprint", nargs="?", default="")
    production.add_argument("payload", nargs="?", default="null")
    production.set_defaults(handler=transaction_commands.production_health)

    health_recover = commands.add_parser("health-recover")
    health_recover.add_argument("save_id", nargs="?")
    health_recover.add_argument("operation", nargs="?")
    health_recover.add_argument("--canonical", action="store_true")
    health_recover.add_argument("--acknowledge", action="store_true")
    health_recover.set_defaults(handler=transaction_commands.recover_health)

    health_prepare = commands.add_parser("health-prepare")
    health_prepare.add_argument("save_id")
    health_prepare.add_argument("fingerprint")
    health_prepare.add_argument("payload")
    health_prepare.add_argument("operation")
    health_prepare.add_argument("--intent", action="store_true")
    health_prepare.set_defaults(handler=transaction_commands.prepare_health)

    refill_prepare = commands.add_parser("refill-prepare")
    refill_prepare.add_argument("save_id")
    refill_prepare.add_argument("fingerprint")
    refill_prepare.add_argument("payload")
    refill_prepare.add_argument("operation")
    refill_prepare.set_defaults(
        handler=transaction_commands.prepare_health, refill_batch=True, intent=True
    )

    health_batch_prepare = commands.add_parser("health-batch-prepare")
    health_batch_prepare.add_argument("save_id")
    health_batch_prepare.add_argument("fingerprint")
    health_batch_prepare.add_argument("payload")
    health_batch_prepare.add_argument("operation")
    health_batch_prepare.set_defaults(
        handler=transaction_commands.prepare_health, health_batch=True, intent=True
    )

    upgrade_prepare = commands.add_parser("upgrade-prepare")
    upgrade_prepare.add_argument("save_id")
    upgrade_prepare.add_argument("fingerprint")
    upgrade_prepare.add_argument("payload")
    upgrade_prepare.add_argument("operation")
    upgrade_prepare.set_defaults(
        handler=transaction_commands.prepare_health, upgrade_batch=True, intent=True
    )

    run_prepare = commands.add_parser("run-prepare")
    run_prepare.add_argument("save_id")
    run_prepare.add_argument("fingerprint")
    run_prepare.add_argument("payload")
    run_prepare.add_argument("operation")
    run_prepare.set_defaults(
        handler=transaction_commands.prepare_health, run_batch=True, intent=True
    )

    mixed_prepare = commands.add_parser("mixed-prepare")
    mixed_prepare.add_argument("save_id")
    mixed_prepare.add_argument("fingerprint")
    mixed_prepare.add_argument("payload")
    mixed_prepare.add_argument("operation")
    mixed_prepare.set_defaults(
        handler=transaction_commands.prepare_health, mixed_batch=True, intent=True
    )

    health_status = commands.add_parser("health-state")
    health_status.add_argument("save_id")
    health_status.set_defaults(handler=transaction_commands.health_state)

    players_list = commands.add_parser("players-list")
    players_list.add_argument("save_id", nargs="?")
    players_list.set_defaults(handler=read_commands.list_players)

    players_avatar = commands.add_parser("players-avatar")
    players_avatar.add_argument("save_id", nargs="?")
    players_avatar.add_argument("player_id", nargs="?")
    players_avatar.set_defaults(handler=read_commands.player_avatar)

    upgrades = commands.add_parser("upgrades-list")
    upgrades.add_argument("--reuse-installed-metadata", action="store_true")
    upgrades.add_argument("save_id", nargs="?")
    upgrades.set_defaults(handler=read_commands.list_upgrades)

    upgrade_texture = commands.add_parser("upgrade-texture")
    upgrade_texture.add_argument("upgrade_key", nargs="?")
    upgrade_texture.set_defaults(handler=read_commands.upgrade_texture)

    native_artwork = commands.add_parser("upgrade-artwork")
    native_artwork.add_argument("save_id")
    native_artwork.add_argument("fingerprint")
    native_artwork.add_argument("upgrade_key")
    native_artwork.set_defaults(handler=read_commands.native_upgrade_artwork)

    upgrade_batch = commands.add_parser("upgrade-artwork-batch")
    upgrade_batch.add_argument("save_id")
    upgrade_batch.add_argument("fingerprint")
    upgrade_batch.add_argument("keys", nargs="+")
    upgrade_batch.set_defaults(handler=read_commands.get_native_upgrade_artwork_batch)

    item_artwork = commands.add_parser("item-artwork")
    item_artwork.add_argument("save_id")
    item_artwork.add_argument("fingerprint")
    item_artwork.add_argument("item_name")
    item_artwork.set_defaults(handler=read_commands.get_native_item_artwork)
    item_batch = commands.add_parser("item-artwork-batch")
    item_batch.add_argument("save_id")
    item_batch.add_argument("fingerprint")
    item_batch.add_argument("names", nargs="+")
    item_batch.set_defaults(handler=read_commands.get_native_item_artwork_batch)

    assets_prepare = commands.add_parser("assets-prepare")
    assets_prepare.set_defaults(handler=read_commands.prepare_assets, streaming=True)

    run = commands.add_parser("run-get")
    run.add_argument("save_id", nargs="?")
    run.set_defaults(handler=read_commands.run_state)

    advanced = commands.add_parser("advanced-get")
    advanced.add_argument("--reuse-installed-metadata", action="store_true")
    advanced.add_argument("save_id", nargs="?")
    advanced.set_defaults(handler=read_commands.advanced_save)

    cosmetics_write = commands.add_parser("cosmetics-write")
    cosmetics_write.add_argument("fingerprint", nargs="?")
    cosmetics_write.add_argument("payload", nargs="?")
    cosmetics_write.set_defaults(handler=transaction_commands.save_cosmetics)
    return parser


@bounded_save_operation
def main() -> None:
    """Execute one bounded desktop command and emit its declared JSON protocol."""
    profiling = os.environ.get("REPODITOR_PROFILE_TIMING") == "1"
    if profiling:
        print("REPODITOR_PROFILE_READY", file=sys.stderr, flush=True)
    started = perf_counter() if profiling else 0.0
    args = _parser().parse_args()
    result = args.handler(args)
    if profiling:
        print(
            f"REPODITOR_PROFILE_HANDLER_MS={(perf_counter() - started) * 1000:.2f}", file=sys.stderr
        )
    if not getattr(args, "streaming", False):
        serialize_started = perf_counter() if profiling else 0.0
        response = json.dumps(result)
        if profiling:
            print(
                f"REPODITOR_PROFILE_JSON_MS={(perf_counter() - serialize_started) * 1000:.2f}",
                file=sys.stderr,
            )
        print(response)


if __name__ == "__main__":
    main()
