"""Command-line protocol adapter for the bundled RepoDitor desktop sidecar."""

from __future__ import annotations

import argparse
import json

from repo_save_editor.desktop_api.cosmetics import get_cosmetics, save_cosmetics
from repo_save_editor.desktop_api.discovery.environment import discover_environment
from repo_save_editor.desktop_api.discovery.maps import list_maps
from repo_save_editor.desktop_api.game_status import get_game_status
from repo_save_editor.desktop_api.icons import get_icon_roots
from repo_save_editor.desktop_api.items import get_advanced_save
from repo_save_editor.desktop_api.player.players import get_player_avatar, list_players
from repo_save_editor.desktop_api.player.upgrades import list_upgrades
from repo_save_editor.desktop_api.run import get_run_state
from repo_save_editor.desktop_api.saves import open_save, save_changes

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


def _run_state(args: argparse.Namespace) -> dict[str, object]:
    return _missing_save() if args.save_id is None else get_run_state(args.save_id)


def _advanced_save(args: argparse.Namespace) -> dict[str, object]:
    return _missing_save() if args.save_id is None else get_advanced_save(args.save_id)


def _parse_changes(payload: str) -> object:
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return _INVALID_JSON


def _save_changes(args: argparse.Namespace) -> dict[str, object]:
    if args.save_id is None or args.fingerprint is None or args.payload is None:
        return _invalid_request("The save fingerprint and pending changes are required.")
    changes = _parse_changes(args.payload)
    if changes is _INVALID_JSON:
        return _invalid_request("The pending changes payload is invalid.")
    return save_changes(args.save_id, args.fingerprint, changes)


def _save_cosmetics(args: argparse.Namespace) -> dict[str, object]:
    if args.fingerprint is None or args.payload is None:
        return _invalid_request("The save fingerprint and pending changes are required.")
    changes = _parse_changes(args.payload)
    if changes is _INVALID_JSON:
        return _invalid_request("The pending changes payload is invalid.")
    return save_cosmetics(args.fingerprint, changes)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="repo_save_editor.desktop_api")
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("environment").set_defaults(handler=lambda _args: discover_environment())
    commands.add_parser("game-status").set_defaults(handler=lambda _args: get_game_status())
    commands.add_parser("maps-list").set_defaults(handler=lambda _args: list_maps())
    commands.add_parser("icons-roots").set_defaults(handler=lambda _args: get_icon_roots())
    commands.add_parser("cosmetics-get").set_defaults(handler=lambda _args: get_cosmetics())

    saves_open = commands.add_parser("saves-open")
    saves_open.add_argument("save_id", nargs="?")
    saves_open.set_defaults(handler=_open_save)

    saves_write = commands.add_parser("saves-write")
    saves_write.add_argument("save_id", nargs="?")
    saves_write.add_argument("fingerprint", nargs="?")
    saves_write.add_argument("payload", nargs="?")
    saves_write.set_defaults(handler=_save_changes)

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


def main() -> None:
    """Parse one command, execute its handler, and emit exactly one JSON result."""
    args = _parser().parse_args()
    print(json.dumps(args.handler(args)))


if __name__ == "__main__":
    main()
