"""Command-line entry point for capability snapshot maintenance."""

from __future__ import annotations

import argparse
from pathlib import Path

from tools.capabilities.workflow import (
    approve_cosmetics_save,
    approve_installed_cosmetics,
    approve_installed_recharge,
    check,
    check_installed,
    report_status,
    update,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="RepoDitor capability automation")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("check", help="validate committed evidence and snapshots")

    status = subparsers.add_parser(
        "status", help="report installation and approved build per capability"
    )
    status.add_argument("--game-dir", type=Path)

    installed = subparsers.add_parser("check-installed", help="compare a local R.E.P.O. install")
    installed.add_argument("--game-dir", type=Path)

    update_parser = subparsers.add_parser("update", help="regenerate from approved evidence")
    update_parser.add_argument("--game-dir", type=Path)
    update_parser.add_argument("--recharge-oracle", type=Path)
    update_parser.add_argument("--cosmetics-oracle", type=Path)
    update_parser.add_argument("--cosmetics-contract-proof", type=Path)
    update_parser.add_argument("--cosmetics-save", type=Path)
    update_parser.add_argument("--steam-build-id")
    return parser


def main() -> int:
    arguments = _parser().parse_args()
    if arguments.command == "check":
        return check()
    if arguments.command == "status":
        return report_status(arguments.game_dir)
    if arguments.command == "check-installed":
        return check_installed(arguments.game_dir)
    if arguments.recharge_oracle is not None and any(
        value is not None
        for value in (
            arguments.cosmetics_oracle,
            arguments.cosmetics_contract_proof,
            arguments.cosmetics_save,
            arguments.steam_build_id,
        )
    ):
        raise SystemExit("Update one evidence domain at a time.")
    if arguments.recharge_oracle is not None:
        return approve_installed_recharge(arguments.game_dir, arguments.recharge_oracle)
    if arguments.cosmetics_save is not None and arguments.cosmetics_oracle is None:
        raise SystemExit("--cosmetics-save requires --cosmetics-oracle.")
    if arguments.cosmetics_save is not None:
        return approve_cosmetics_save(
            arguments.cosmetics_save,
            arguments.game_dir,
            arguments.steam_build_id,
            arguments.cosmetics_oracle,
        )
    if arguments.cosmetics_oracle is not None:
        return approve_installed_cosmetics(
            arguments.game_dir,
            arguments.cosmetics_oracle,
            arguments.cosmetics_contract_proof,
        )
    if arguments.steam_build_id is not None:
        raise SystemExit("--steam-build-id requires --cosmetics-save.")
    if arguments.cosmetics_contract_proof is not None:
        raise SystemExit("--cosmetics-contract-proof requires --cosmetics-oracle.")
    if arguments.game_dir is not None and check_installed(arguments.game_dir) != 0:
        return 1
    return update()


if __name__ == "__main__":
    raise SystemExit(main())
