"""Desktop process interface for RepoDitor."""

from __future__ import annotations

import argparse
import json

from repo_save_editor.desktop_api.environment import discover_environment
from repo_save_editor.desktop_api.saves import open_save


def main() -> None:
    """Run a RepoDitor desktop API command."""
    parser = argparse.ArgumentParser(prog="repo_save_editor.desktop_api")

    parser.add_argument(
        "command",
        choices=("environment", "saves-open"),
    )
    parser.add_argument("save_id", nargs="?")

    args = parser.parse_args()
    if args.command == "environment":
        print(json.dumps(discover_environment()))
    elif args.save_id is None:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": {
                        "code": "invalid_request",
                        "message": "A save ID is required.",
                    },
                }
            )
        )
    else:
        print(json.dumps(open_save(args.save_id)))


if __name__ == "__main__":
    main()
