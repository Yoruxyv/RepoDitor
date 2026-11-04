"""Synthetic fault-injection sidecar; never staged by the production packaging command."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

if not getattr(sys, "frozen", False):
    project = Path(__file__).resolve().parents[3]
    sys.path.insert(0, str(project / "desktop/python"))
    sys.path.insert(0, str(project / ".venv/Lib/site-packages"))

from repo_save_editor.desktop_api import __main__ as entry
from repo_save_editor.desktop_api import saves
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.storage import health_recovery as recovery


def phase(name: str) -> None:
    if os.environ.get("REPODITOR_RECOVERY_PHASE") != name:
        return
    marker = Path(os.environ["REPODITOR_RECOVERY_PHASE_FILE"])
    with marker.open("w") as stream:
        json.dump({"phase": name, "pid": os.getpid()}, stream)
        stream.flush()
        os.fsync(stream.fileno())
    while True:
        time.sleep(0.05)


def install_synthetic_status() -> None:
    status = {
        "not_running": GameProcessStatus.NOT_RUNNING,
        "unknown": GameProcessStatus.UNKNOWN,
    }.get(os.environ.get("REPODITOR_RECOVERY_SYNTHETIC_STATUS", ""))
    if status is not None:
        original_write = entry.write_health

        def isolated_write(*args, **kwargs):
            return original_write(*args, **kwargs, game_status_loader=lambda: status)

        entry.write_health = isolated_write
        original_prepare = entry.prepare_health

        def isolated_prepare(*args, **kwargs):
            return original_prepare(*args, **kwargs, game_status_loader=lambda: status)

        entry.prepare_health = isolated_prepare
        original_status = entry.get_game_status
        entry.get_game_status = lambda: original_status(lambda: status)


def response_fault() -> None:
    phase("response_construction")
    if os.environ.get("REPODITOR_RECOVERY_PHASE") == "response_error":
        raise ValueError("Synthetic response-construction failure")


def install_completion_fault() -> None:
    original = entry.write_health
    original_prepare = entry.prepare_health

    def completed(*args, **kwargs):
        result = original(*args, **kwargs)
        phase("after_completion")
        return result

    entry.write_health = completed

    def prepared(*args, **kwargs):
        result = original_prepare(*args, **kwargs)
        if result.get("transaction", {}).get("status") == "prepared":
            phase("reservation_response")
        return result

    entry.prepare_health = prepared


def io_fault(name: str) -> None:
    if os.environ.get("REPODITOR_RECOVERY_PHASE") == name:
        raise OSError("Synthetic transaction I/O failure")


def install_faults() -> None:
    original_backup = recovery.HealthTransaction.create_backup
    original_stage = recovery.HealthTransaction.stage
    original_verified = recovery.HealthTransaction.verified
    original_publish = recovery._publish
    original_replace = Path.replace
    original_unlink = Path.unlink
    original_session = saves._session
    writing = False

    def backup(transaction, source):
        nonlocal writing
        writing = True
        io_fault("backup_error")
        phase("before_transaction")
        if os.environ.get("REPODITOR_RECOVERY_PHASE") == "backup_partial":
            recovery._flush_write(transaction.backup, source[: len(source) // 2])
            phase("backup_partial")
        result = original_backup(transaction, source)
        phase("backup_complete")
        return result

    def stage(transaction, written):
        io_fault("staging_error")
        if os.environ.get("REPODITOR_RECOVERY_PHASE") == "staging_partial":
            recovery._flush_write(transaction.temporary, written[: len(written) // 2])
            phase("staging_partial")
        return original_stage(transaction, written)

    def verified(transaction, written):
        io_fault("verification_error")
        original_verified(transaction, written)
        phase("verified")

    def replace(path, target):
        is_save = str(target).endswith(".es3") and ".health-" in path.name
        if is_save:
            phase("before_replace")
        result = original_replace(path, target)
        if is_save:
            phase("after_replace")
        return result

    def publish(source, target):
        io_fault("receipt_publish_error")
        original_publish(source, target)
        if target.name.endswith(".json") and not target.name.endswith("health-pending.json"):
            phase("recovery_archive")

    def unlink(path, *args, **kwargs):
        result = original_unlink(path, *args, **kwargs)
        if path.suffix == ".tmp" and not path.name.endswith(".receipt.tmp"):
            phase("recovery_cleanup")
        return result

    def session(*args, **kwargs):
        if writing:
            response_fault()
        return original_session(*args, **kwargs)

    recovery.HealthTransaction.create_backup = backup
    recovery.HealthTransaction.stage = stage
    recovery.HealthTransaction.verified = verified
    recovery._publish = publish
    Path.replace = replace
    Path.unlink = unlink
    saves._session = session


if __name__ == "__main__":
    if os.environ.get("REPODITOR_E2E") != "1":
        raise SystemExit("Synthetic recovery harness requires isolated E2E mode")
    if len(sys.argv) > 1 and sys.argv[1] == "saves-write":
        phase("before_execution")
    install_synthetic_status()
    install_completion_fault()
    install_faults()
    entry.main()
