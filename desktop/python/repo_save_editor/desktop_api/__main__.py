"""Command-line protocol adapter for the bundled RepoDitor desktop sidecar."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from repo_save_editor.core.save_resources import bounded_save_operation
from repo_save_editor.desktop_api.cosmetic_artwork import get_cosmetic_artwork
from repo_save_editor.desktop_api.cosmetic_preparation import (
    parse_cosmetic_ids,
    stream_cosmetic_artwork,
)
from repo_save_editor.desktop_api.cosmetics import get_cosmetics, save_cosmetics
from repo_save_editor.desktop_api.discovery.environment import discover_environment
from repo_save_editor.desktop_api.discovery.maps import get_native_map_artwork, list_maps
from repo_save_editor.desktop_api.game_assets import (
    prepare_game_assets,
    read_upgrade_keys_stdin,
)
from repo_save_editor.desktop_api.game_status import get_game_status
from repo_save_editor.desktop_api.health_recovery import (
    health_state,
    prepare_health,
    recover_health,
    write_health,
)
from repo_save_editor.desktop_api.icons import (
    get_baked_artwork,
    get_icon_roots,
    get_native_item_artwork,
    get_native_upgrade_artwork,
    get_upgrade_texture,
)
from repo_save_editor.desktop_api.items import get_advanced_save
from repo_save_editor.desktop_api.meta_transactions import meta_recover, meta_state, meta_write
from repo_save_editor.desktop_api.player.players import get_player_avatar, list_players
from repo_save_editor.desktop_api.player.upgrades import list_upgrades
from repo_save_editor.desktop_api.run import get_run_state
from repo_save_editor.desktop_api.saves import open_save, save_changes
from repo_save_editor.services.game.map_artwork import decode_map_artwork

_INVALID_JSON = object()


def _invalid_request(message: str) -> dict[str, object]:
    return {"ok": False, "error": {"code": "invalid_request", "message": message}}


def _missing_save() -> dict[str, object]:
    return _invalid_request("The required save or player ID is missing.")


def _open_save(args: argparse.Namespace) -> dict[str, object]:
    return _missing_save() if args.save_id is None else open_save(args.save_id)


def _list_players(args: argparse.Namespace) -> dict[str, object]:
    return _missing_save() if args.save_id is None else list_players(args.save_id)


def _player_avatar(args: argparse.Namespace) -> dict[str, object]:
    if args.save_id is None or args.player_id is None:
        return _missing_save()
    return get_player_avatar(args.save_id, args.player_id)


def _list_upgrades(args: argparse.Namespace) -> dict[str, object]:
    return _missing_save() if args.save_id is None else list_upgrades(args.save_id)


def _upgrade_texture(args: argparse.Namespace) -> dict[str, object]:
    if args.upgrade_key is None:
        return _invalid_request("The required upgrade identity is missing.")
    return get_upgrade_texture(args.upgrade_key)


def _native_upgrade_artwork(args: argparse.Namespace) -> dict[str, object]:
    return get_native_upgrade_artwork(args.save_id, args.fingerprint, args.upgrade_key)


def _cosmetic_artwork(args: argparse.Namespace) -> dict[str, object]:
    if args.cosmetic_id is None:
        return _invalid_request("A canonical cosmetic ID is required.")
    return get_cosmetic_artwork(args.cosmetic_id)


def _prepare_cosmetics(_args: argparse.Namespace) -> None:
    def emit(record: dict[str, object]) -> None:
        print(json.dumps(record, separators=(",", ":")), flush=True)

    try:
        ids = parse_cosmetic_ids(sys.stdin.buffer)
    except ValueError:
        emit({"type": "final", "ok": False, "completed": 0, "total": 0})
        return
    stream_cosmetic_artwork(ids, emit)


def _prepare_assets(_args: argparse.Namespace) -> None:
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


def _run_state(args: argparse.Namespace) -> dict[str, object]:
    return _missing_save() if args.save_id is None else get_run_state(args.save_id)


def _advanced_save(args: argparse.Namespace) -> dict[str, object]:
    return _missing_save() if args.save_id is None else get_advanced_save(args.save_id)


def _parse_changes(payload: str) -> object:
    try:
        parsed: object = json.loads(payload)
    except json.JSONDecodeError:
        return _INVALID_JSON
    return parsed


def _save_changes(args: argparse.Namespace) -> dict[str, object]:
    if args.save_id is None or args.fingerprint is None or args.payload is None:
        return _invalid_request("The save fingerprint and pending changes are required.")
    changes = _parse_changes(args.payload)
    if changes is _INVALID_JSON:
        return _invalid_request("The pending changes payload is invalid.")
    if (
        args.health_operation is not None
        or args.refill_operation is not None
        or args.health_batch_operation is not None
        or args.upgrade_operation is not None
        or args.run_operation is not None
    ):
        root = _recovery_test_root()
        if root is None:
            return _invalid_request("Experimental recovery requires an isolated test root.")
        return write_health(
            args.save_id,
            args.fingerprint,
            changes,
            args.refill_operation
            or args.health_batch_operation
            or args.run_operation
            or args.upgrade_operation
            or args.health_operation,
            root,
            reserved=True,
            refill_batch=args.refill_operation is not None,
            health_batch=args.health_batch_operation is not None,
            upgrade_batch=args.upgrade_operation is not None,
            run_batch=args.run_operation is not None,
        )
    if args.recharge_evidence is None:
        return save_changes(args.save_id, args.fingerprint, changes)
    parsed_evidence = _parse_changes(args.recharge_evidence)
    if parsed_evidence is _INVALID_JSON:
        return save_changes(args.save_id, args.fingerprint, changes)
    return save_changes(
        args.save_id,
        args.fingerprint,
        changes,
        recharge_evidence=parsed_evidence,
    )


def _recovery_test_root() -> Path | None:
    low = os.environ.get("REPODITOR_E2E_LOCAL_APP_DATA_LOW", "")
    if os.environ.get("REPODITOR_E2E") != "1" or not low or not Path(low).is_absolute():
        return None
    return Path(low) / "semiwork" / "Repo" / "saves"


def _recover_health(args: argparse.Namespace) -> dict[str, object]:
    root = _recovery_test_root()
    if root is None or args.save_id is None or args.operation is None:
        return _invalid_request("Experimental recovery requires an isolated test request.")
    return recover_health(
        args.save_id,
        args.operation,
        root,
        canonical=args.canonical,
        acknowledge=not args.canonical or args.acknowledge,
    )


def _health_state(args: argparse.Namespace) -> dict[str, object]:
    root = _recovery_test_root()
    if root is None:
        return _invalid_request("Experimental recovery requires an isolated test request.")
    return health_state(args.save_id, root)


def _prepare_health(args: argparse.Namespace) -> dict[str, object]:
    root = _recovery_test_root()
    changes = _parse_changes(args.payload)
    if root is None or changes is _INVALID_JSON:
        return _invalid_request("Experimental recovery requires an isolated test request.")
    return prepare_health(
        args.save_id,
        args.fingerprint,
        changes,
        args.operation,
        root,
        remember_intent=args.intent,
        refill_batch=getattr(args, "refill_batch", False),
        health_batch=getattr(args, "health_batch", False),
        upgrade_batch=getattr(args, "upgrade_batch", False),
        run_batch=getattr(args, "run_batch", False),
    )


def _save_cosmetics(args: argparse.Namespace) -> dict[str, object]:
    if args.fingerprint is None or args.payload is None:
        return _invalid_request("The save fingerprint and pending changes are required.")
    changes = _parse_changes(args.payload)
    if changes is _INVALID_JSON:
        return _invalid_request("The pending changes payload is invalid.")
    return save_cosmetics(args.fingerprint, changes)


def _meta_transaction(args: argparse.Namespace) -> dict[str, object]:
    root = _recovery_test_root()
    if root is None:
        return _invalid_request("Synthetic MetaSave requires an isolated test root.")
    if args.command == "meta-state":
        return meta_state(root, args.operation)
    if args.command == "meta-recover":
        return meta_recover(root, args.operation, args.proof)
    intent = _parse_changes(args.payload)
    return meta_write(
        root,
        args.operation,
        args.fingerprint,
        intent,
        namespace=args.namespace,
        prepare=args.command == "meta-prepare",
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="repo_save_editor.desktop_api")
    commands = parser.add_subparsers(dest="command", required=True)

    meta_status = commands.add_parser("meta-state")
    meta_status.add_argument("operation", nargs="?")
    meta_status.set_defaults(handler=_meta_transaction)
    for name in ("meta-prepare", "meta-write"):
        meta = commands.add_parser(name)
        meta.add_argument("operation")
        meta.add_argument("fingerprint")
        meta.add_argument("payload")
        meta.add_argument("namespace")
        meta.set_defaults(handler=_meta_transaction)
    meta_recovery = commands.add_parser("meta-recover")
    meta_recovery.add_argument("operation")
    meta_recovery.add_argument("proof")
    meta_recovery.set_defaults(handler=_meta_transaction)

    commands.add_parser("environment").set_defaults(handler=lambda _args: discover_environment())
    commands.add_parser("game-status").set_defaults(handler=lambda _args: get_game_status())
    commands.add_parser("maps-list").set_defaults(handler=lambda _args: list_maps())
    commands.add_parser("maps-artwork").set_defaults(
        handler=lambda _args: {"ok": True, "artworks": decode_map_artwork()}
    )
    map_artwork = commands.add_parser("map-artwork")
    map_artwork.add_argument("revision")
    map_artwork.add_argument("family")
    map_artwork.set_defaults(
        handler=lambda args: get_native_map_artwork(args.revision, args.family)
    )
    commands.add_parser("icons-roots").set_defaults(handler=lambda _args: get_icon_roots())
    commands.add_parser("baked-artwork").set_defaults(handler=lambda _args: get_baked_artwork())
    commands.add_parser("cosmetics-get").set_defaults(handler=lambda _args: get_cosmetics())
    commands.add_parser("cosmetics-prepare").set_defaults(
        handler=_prepare_cosmetics, streaming=True
    )
    cosmetic_artwork = commands.add_parser("cosmetic-artwork")
    cosmetic_artwork.add_argument("cosmetic_id", nargs="?")
    cosmetic_artwork.set_defaults(handler=_cosmetic_artwork)

    saves_open = commands.add_parser("saves-open")
    saves_open.add_argument("save_id", nargs="?")
    saves_open.set_defaults(handler=_open_save)

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
    saves_write.set_defaults(handler=_save_changes)

    health_recover = commands.add_parser("health-recover")
    health_recover.add_argument("save_id", nargs="?")
    health_recover.add_argument("operation", nargs="?")
    health_recover.add_argument("--canonical", action="store_true")
    health_recover.add_argument("--acknowledge", action="store_true")
    health_recover.set_defaults(handler=_recover_health)

    health_prepare = commands.add_parser("health-prepare")
    health_prepare.add_argument("save_id")
    health_prepare.add_argument("fingerprint")
    health_prepare.add_argument("payload")
    health_prepare.add_argument("operation")
    health_prepare.add_argument("--intent", action="store_true")
    health_prepare.set_defaults(handler=_prepare_health)

    refill_prepare = commands.add_parser("refill-prepare")
    refill_prepare.add_argument("save_id")
    refill_prepare.add_argument("fingerprint")
    refill_prepare.add_argument("payload")
    refill_prepare.add_argument("operation")
    refill_prepare.set_defaults(handler=_prepare_health, refill_batch=True, intent=True)

    health_batch_prepare = commands.add_parser("health-batch-prepare")
    health_batch_prepare.add_argument("save_id")
    health_batch_prepare.add_argument("fingerprint")
    health_batch_prepare.add_argument("payload")
    health_batch_prepare.add_argument("operation")
    health_batch_prepare.set_defaults(handler=_prepare_health, health_batch=True, intent=True)

    upgrade_prepare = commands.add_parser("upgrade-prepare")
    upgrade_prepare.add_argument("save_id")
    upgrade_prepare.add_argument("fingerprint")
    upgrade_prepare.add_argument("payload")
    upgrade_prepare.add_argument("operation")
    upgrade_prepare.set_defaults(handler=_prepare_health, upgrade_batch=True, intent=True)

    run_prepare = commands.add_parser("run-prepare")
    run_prepare.add_argument("save_id")
    run_prepare.add_argument("fingerprint")
    run_prepare.add_argument("payload")
    run_prepare.add_argument("operation")
    run_prepare.set_defaults(handler=_prepare_health, run_batch=True, intent=True)

    health_status = commands.add_parser("health-state")
    health_status.add_argument("save_id")
    health_status.set_defaults(handler=_health_state)

    players_list = commands.add_parser("players-list")
    players_list.add_argument("save_id", nargs="?")
    players_list.set_defaults(handler=_list_players)

    players_avatar = commands.add_parser("players-avatar")
    players_avatar.add_argument("save_id", nargs="?")
    players_avatar.add_argument("player_id", nargs="?")
    players_avatar.set_defaults(handler=_player_avatar)

    upgrades = commands.add_parser("upgrades-list")
    upgrades.add_argument("save_id", nargs="?")
    upgrades.set_defaults(handler=_list_upgrades)

    upgrade_texture = commands.add_parser("upgrade-texture")
    upgrade_texture.add_argument("upgrade_key", nargs="?")
    upgrade_texture.set_defaults(handler=_upgrade_texture)

    native_artwork = commands.add_parser("upgrade-artwork")
    native_artwork.add_argument("save_id")
    native_artwork.add_argument("fingerprint")
    native_artwork.add_argument("upgrade_key")
    native_artwork.set_defaults(handler=_native_upgrade_artwork)

    item_artwork = commands.add_parser("item-artwork")
    item_artwork.add_argument("save_id")
    item_artwork.add_argument("fingerprint")
    item_artwork.add_argument("item_name")
    item_artwork.set_defaults(
        handler=lambda args: get_native_item_artwork(args.save_id, args.fingerprint, args.item_name)
    )

    assets_prepare = commands.add_parser("assets-prepare")
    assets_prepare.set_defaults(handler=_prepare_assets, streaming=True)

    run = commands.add_parser("run-get")
    run.add_argument("save_id", nargs="?")
    run.set_defaults(handler=_run_state)

    advanced = commands.add_parser("advanced-get")
    advanced.add_argument("save_id", nargs="?")
    advanced.set_defaults(handler=_advanced_save)

    cosmetics_write = commands.add_parser("cosmetics-write")
    cosmetics_write.add_argument("fingerprint", nargs="?")
    cosmetics_write.add_argument("payload", nargs="?")
    cosmetics_write.set_defaults(handler=_save_cosmetics)
    return parser


@bounded_save_operation
def main() -> None:
    """Execute one bounded desktop command and emit its declared JSON protocol."""
    args = _parser().parse_args()
    result = args.handler(args)
    if not getattr(args, "streaming", False):
        print(json.dumps(result))


if __name__ == "__main__":
    main()
