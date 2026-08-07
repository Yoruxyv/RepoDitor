"""Desktop process interface for RepoDitor."""

from __future__ import annotations

import argparse
import json


def ping() -> dict[str, object]:
    """Return a minimal health response for the desktop application."""
    return {
        "ok": True,
        "message": "pong",
        "source": "python",
    }


def main() -> None:
    """Run a RepoDitor desktop API command."""
    parser = argparse.ArgumentParser(prog="repo_save_editor.desktop_api")

    parser.add_argument(
        "command",
        choices=("ping",),
    )

    args = parser.parse_args()

    if args.command == "ping":
        print(json.dumps(ping()))


if __name__ == "__main__":
    main()
