"""Desktop process interface for RepoDitor."""

from __future__ import annotations

import argparse
import json

from repo_save_editor.desktop_api.environment import discover_environment


def main() -> None:
    """Run a RepoDitor desktop API command."""
    parser = argparse.ArgumentParser(prog="repo_save_editor.desktop_api")

    parser.add_argument(
        "command",
        choices=("environment",),
    )

    if parser.parse_args().command == "environment":
        print(json.dumps(discover_environment()))


if __name__ == "__main__":
    main()
