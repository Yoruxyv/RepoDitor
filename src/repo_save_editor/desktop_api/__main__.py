"""Desktop process interface for RepoDitor."""

from __future__ import annotations

import argparse
import json

from repo_save_editor.desktop_api.environment import discover_environment
from repo_save_editor.desktop_api.players import get_player_avatar, list_players
from repo_save_editor.desktop_api.saves import open_save


def main() -> None:
    """Run a RepoDitor desktop API command."""
    parser = argparse.ArgumentParser(prog="repo_save_editor.desktop_api")

    parser.add_argument(
        "command",
        choices=("environment", "saves-open", "players-list", "players-avatar"),
    )
    parser.add_argument("save_id", nargs="?")
    parser.add_argument("player_id", nargs="?")

    args = parser.parse_args()
    if args.command == "environment":
        print(json.dumps(discover_environment()))
    elif args.save_id is None or (args.command == "players-avatar" and args.player_id is None):
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": {
                        "code": "invalid_request",
                        "message": "The required save or player ID is missing.",
                    },
                }
            )
        )
    elif args.command == "saves-open":
        print(json.dumps(open_save(args.save_id)))
    elif args.command == "players-list":
        print(json.dumps(list_players(args.save_id)))
    else:
        print(json.dumps(get_player_avatar(args.save_id, args.player_id)))


if __name__ == "__main__":
    main()
