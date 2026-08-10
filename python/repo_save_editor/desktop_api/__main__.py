"""Desktop process interface for RepoDitor."""

from __future__ import annotations

import argparse
import json

from repo_save_editor.desktop_api.cosmetics import get_cosmetics, save_cosmetics
from repo_save_editor.desktop_api.discovery.environment import discover_environment
from repo_save_editor.desktop_api.discovery.maps import list_maps
from repo_save_editor.desktop_api.items import get_advanced_save
from repo_save_editor.desktop_api.player.overview import get_player_avatar, list_players
from repo_save_editor.desktop_api.player.upgrades import list_upgrades
from repo_save_editor.desktop_api.run import get_run_state
from repo_save_editor.desktop_api.saves import open_save, save_changes


def _invalid_request(message: str) -> dict[str, object]:
    return {"ok": False, "error": {"code": "invalid_request", "message": message}}


def main() -> None:
    """Run a RepoDitor desktop API command."""
    parser = argparse.ArgumentParser(prog="repo_save_editor.desktop_api")

    parser.add_argument(
        "command",
        choices=(
            "environment",
            "saves-open",
            "saves-write",
            "players-list",
            "players-avatar",
            "upgrades-list",
            "run-get",
            "advanced-get",
            "maps-list",
            "cosmetics-get",
            "cosmetics-write",
        ),
    )
    parser.add_argument("save_id", nargs="?")
    parser.add_argument("player_id", nargs="?")
    parser.add_argument("payload", nargs="?")

    args = parser.parse_args()
    if args.command == "environment":
        print(json.dumps(discover_environment()))
    elif args.command == "maps-list":
        print(json.dumps(list_maps()))
    elif args.command == "cosmetics-get":
        print(json.dumps(get_cosmetics()))
    elif args.command == "cosmetics-write":
        if args.save_id is None or args.player_id is None:
            print(
                json.dumps(
                    _invalid_request("The save fingerprint and pending changes are required.")
                )
            )
        else:
            try:
                cosmetic_changes = json.loads(args.player_id)
            except json.JSONDecodeError:
                print(json.dumps(_invalid_request("The pending changes payload is invalid.")))
            else:
                print(json.dumps(save_cosmetics(args.save_id, cosmetic_changes)))
    elif args.save_id is None or (args.command == "players-avatar" and args.player_id is None):
        print(json.dumps(_invalid_request("The required save or player ID is missing.")))
    elif args.command == "saves-open":
        print(json.dumps(open_save(args.save_id)))
    elif args.command == "saves-write":
        if args.player_id is None or args.payload is None:
            print(
                json.dumps(
                    _invalid_request("The save fingerprint and pending changes are required.")
                )
            )
        else:
            try:
                changes = json.loads(args.payload)
            except json.JSONDecodeError:
                print(json.dumps(_invalid_request("The pending changes payload is invalid.")))
            else:
                print(json.dumps(save_changes(args.save_id, args.player_id, changes)))
    elif args.command == "players-list":
        print(json.dumps(list_players(args.save_id)))
    elif args.command == "players-avatar":
        print(json.dumps(get_player_avatar(args.save_id, args.player_id)))
    elif args.command == "upgrades-list":
        print(json.dumps(list_upgrades(args.save_id)))
    elif args.command == "run-get":
        print(json.dumps(get_run_state(args.save_id)))
    else:
        print(json.dumps(get_advanced_save(args.save_id)))


if __name__ == "__main__":
    main()
