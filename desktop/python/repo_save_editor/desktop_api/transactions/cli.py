"""CLI request decoding and handshake for production and isolated save transactions."""

# Route imports keep command-specific dependencies out of unrelated processes.
# ruff: noqa: PLC0415

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from repo_save_editor.desktop_api.protocol import invalid_request

_INVALID_JSON = object()


def _parse_changes(payload: str) -> object:
    try:
        parsed: object = json.loads(payload)
    except json.JSONDecodeError:
        return _INVALID_JSON
    return parsed


def save_changes(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.saves.saves import save_changes
    from repo_save_editor.desktop_api.transactions.health_recovery import write_health

    if args.save_id is None or args.fingerprint is None or args.payload is None:
        return invalid_request("The save fingerprint and pending changes are required.")
    changes = _parse_changes(args.payload)
    if changes is _INVALID_JSON:
        return invalid_request("The pending changes payload is invalid.")
    mixed_operation = getattr(args, "mixed_operation", None)
    if (
        args.health_operation is not None
        or args.refill_operation is not None
        or args.health_batch_operation is not None
        or args.upgrade_operation is not None
        or args.run_operation is not None
        or mixed_operation is not None
    ):
        root = _recovery_test_root(mixed=mixed_operation is not None)
        if root is None:
            return invalid_request("Experimental recovery requires an isolated test root.")
        return write_health(
            args.save_id,
            args.fingerprint,
            changes,
            args.refill_operation
            or args.health_batch_operation
            or args.run_operation
            or args.upgrade_operation
            or mixed_operation
            or args.health_operation,
            root,
            reserved=True,
            refill_batch=args.refill_operation is not None,
            health_batch=args.health_batch_operation is not None,
            upgrade_batch=args.upgrade_operation is not None,
            run_batch=args.run_operation is not None,
            mixed_batch=mixed_operation is not None,
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


def _recovery_test_root(*, mixed: bool = False) -> Path | None:
    low = os.environ.get("REPODITOR_E2E_LOCAL_APP_DATA_LOW", "")
    if os.environ.get("REPODITOR_E2E") != "1" or not low or not Path(low).is_absolute():
        return None
    profile = Path(low)
    if mixed:
        try:
            resolved = profile.resolve(strict=True)
        except (OSError, ValueError):
            return None
        if profile != resolved or not any(
            tuple(part.casefold() for part in parent.parts[-3:])
            == ("desktop", "build", "recovery-checkpoint")
            for parent in resolved.parents
        ):
            return None
    return profile / "semiwork" / "Repo" / "saves"


def production_health(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.transactions.production_health import production_health

    def publication_allowed() -> bool:
        sys.stdout.buffer.write(b"REPODITOR_READY_TO_PUBLISH\n")
        sys.stdout.buffer.flush()
        return sys.stdin.buffer.read(1) == b"\x01"

    return production_health(
        args.action,
        args.save_id,
        args.operation,
        args.fingerprint,
        _parse_changes(args.payload),
        publication_allowed=publication_allowed if args.action == "apply" else None,
    )


def recover_health(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.transactions.health_recovery import recover_health

    root = _recovery_test_root()
    if root is None or args.save_id is None or args.operation is None:
        return invalid_request("Experimental recovery requires an isolated test request.")
    return recover_health(
        args.save_id,
        args.operation,
        root,
        canonical=args.canonical,
        acknowledge=not args.canonical or args.acknowledge,
    )


def health_state(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.transactions.health_recovery import health_state

    root = _recovery_test_root()
    if root is None:
        return invalid_request("Experimental recovery requires an isolated test request.")
    return health_state(args.save_id, root)


def prepare_health(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.transactions.health_recovery import prepare_health

    mixed = getattr(args, "mixed_batch", False)
    root = _recovery_test_root(mixed=mixed)
    changes = _parse_changes(args.payload)
    if root is None or changes is _INVALID_JSON:
        return invalid_request("Experimental recovery requires an isolated test request.")
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
        mixed_batch=mixed,
    )


def save_cosmetics(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.cosmetics.cosmetics import save_cosmetics

    if args.fingerprint is None or args.payload is None:
        return invalid_request("The save fingerprint and pending changes are required.")
    changes = _parse_changes(args.payload)
    if changes is _INVALID_JSON:
        return invalid_request("The pending changes payload is invalid.")
    return save_cosmetics(args.fingerprint, changes)


def meta_transaction(args: argparse.Namespace) -> dict[str, object]:
    from repo_save_editor.desktop_api.transactions.meta_transactions import (
        meta_recover,
        meta_state,
        meta_write,
    )
    from repo_save_editor.desktop_api.transactions.production_meta import production_meta

    if args.command.startswith("production-meta-"):
        return production_meta(
            args.command.removeprefix("production-meta-"),
            args.operation,
            proof=getattr(args, "proof", ""),
            fingerprint=getattr(args, "fingerprint", ""),
            intent=_parse_changes(args.payload) if hasattr(args, "payload") else None,
            namespace=getattr(args, "namespace", ""),
        )
    root = _recovery_test_root()
    if root is None:
        return invalid_request("Synthetic MetaSave requires an isolated test root.")
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
