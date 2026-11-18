"""Installed-build admission for the production Run-save commands."""

from __future__ import annotations

import os
from hashlib import sha256
from pathlib import Path
from sys import platform
from typing import Final, cast

from repo_save_editor.desktop_api.health_recovery import (
    _outcome,
    health_state,
    prepare_health,
    recover_health,
    write_health,
)
from repo_save_editor.services.game.discovery import (
    GameDiscoveryStatus,
    GameInstallation,
    discover_game_installation,
)
from repo_save_editor.services.game.installed_build import (
    ValidatedInstalledBuild,
    installed_build_identity,
    owned_file,
)
from repo_save_editor.services.game.processes import (
    GameProcessStatus,
    ProcessInspectionError,
    classify_game_process,
    inspect_windows_processes,
)
from repo_save_editor.services.saves.discovery import get_default_save_root
from repo_save_editor.services.saves.private_health import (
    Approval,
    Bundle,
    private_bundle,
    read_approval,
)
from repo_save_editor.storage.health_recovery import (
    RecoveryError,
    valid_health_batch_intent,
    valid_mixed_intent,
    valid_refill_intent,
    valid_run_intent,
    valid_upgrade_intent,
)

HEALTH_BUILD_SOURCES: Final = (
    "REPO.exe",
    "UnityPlayer.dll",
    "REPO_Data/Managed/Assembly-CSharp.dll",
    "REPO_Data/globalgamemanagers",
)
# Each approved entry pins HEALTH_BUILD_SOURCES in order to reviewed Health evidence.
# Build 26407089 has disposable mutation evidence; game persistence and release approval are pending.
APPROVED_HEALTH_BUILDS: Final[dict[str, tuple[str, ...]]] = {}
# A reviewed pin set authorizes only the listed additional Run-save domains.
APPROVED_RUN_BUILDS: Final[dict[str, tuple[tuple[str, ...], frozenset[str]]]] = {}
VALIDATORS = {
    "health": valid_health_batch_intent,
    "upgrades": valid_upgrade_intent,
    "run": valid_run_intent,
    "refillToFull": valid_refill_intent,
    "mixed": valid_mixed_intent,
}


def _intent_domain(payload: object) -> tuple[str, frozenset[str]]:
    if not isinstance(payload, dict) or len(payload) != 1:
        raise RecoveryError("invalid_request")
    domain = next(iter(payload))
    if domain not in VALIDATORS or not VALIDATORS[domain](payload):
        raise RecoveryError("invalid_request")
    if domain == "mixed":
        return domain, frozenset(key for key, changes in payload[domain].items() if changes)
    return domain, frozenset({domain})


def _installed_game() -> tuple[GameInstallation, ValidatedInstalledBuild]:
    if platform != "win32" or os.environ.get("REPODITOR_E2E") == "1":
        raise RecoveryError("save_unsupported")
    result = discover_game_installation()
    game = result.installation
    if result.status != GameDiscoveryStatus.FOUND or game is None:
        raise RecoveryError("save_verification_unavailable")
    build = installed_build_identity(game)
    if build is None:
        raise RecoveryError("save_verification_unavailable")
    return game, build


def _game() -> tuple[Path, str, frozenset[str]]:
    if not APPROVED_HEALTH_BUILDS and not APPROVED_RUN_BUILDS:
        raise RecoveryError("save_unsupported")
    game, build = _installed_game()
    health_pins = APPROVED_HEALTH_BUILDS.get(build.build_id)
    run_policy = APPROVED_RUN_BUILDS.get(build.build_id)
    if health_pins is None and run_policy is None:
        raise RecoveryError("save_unsupported")
    try:
        actual = _source_pins(game, build)
        domains = {"health"} if health_pins == actual else set()
        if run_policy is not None and run_policy[0] == actual:
            domains.update(run_policy[1] & {"upgrades", "run", "refillToFull"})
        if not domains:
            raise RecoveryError("save_unsupported")
    except (OSError, ValueError) as exc:
        if isinstance(exc, RecoveryError):
            raise
        raise RecoveryError("save_verification_unavailable") from exc
    return game.root / HEALTH_BUILD_SOURCES[0], build.build_id, frozenset(domains)


def _source_pins(game: GameInstallation, build: ValidatedInstalledBuild) -> tuple[str, ...]:
    if game.steam_library_root is None:
        raise RecoveryError("save_verification_unavailable")
    manifest = _digest(game.steam_library_root, build.manifest_path)
    sources = tuple(_digest(game.root, game.root / name) for name in HEALTH_BUILD_SOURCES)
    if (
        installed_build_identity(game) != build
        or _digest(game.steam_library_root, build.manifest_path) != manifest
    ):
        raise RecoveryError("save_verification_unavailable")
    return sources


def _process_status(executable: Path) -> GameProcessStatus:
    try:
        inspection = inspect_windows_processes(executable)
    except (ProcessInspectionError, OSError):
        return GameProcessStatus.UNKNOWN
    status = classify_game_process(executable, inspection)
    if status is GameProcessStatus.NOT_RUNNING and inspection.executable_paths:
        return GameProcessStatus.UNKNOWN
    return status


def _digest(root: Path, path: Path) -> str:
    source = owned_file(root, path)
    with source.open("rb") as stream:
        before = os.fstat(stream.fileno())
        if before.st_size > 256 * 1024 * 1024:
            raise ValueError("Installed game source exceeds its hash budget.")
        hashed = sha256()
        remaining = before.st_size
        while remaining:
            chunk = stream.read(min(65536, remaining))
            if not chunk:
                raise ValueError("Installed game source was truncated.")
            hashed.update(chunk)
            remaining -= len(chunk)
        if stream.read(1):
            raise ValueError("Installed game source grew.")
        after = owned_file(root, path).stat()
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
        ):
            raise ValueError("Installed game source changed.")
    return hashed.hexdigest()


def _qualification_game(
    bundle: Bundle, approval: Approval | None, save: str
) -> tuple[Path, str, frozenset[str]]:
    if approval is None or approval.save != save or read_approval(bundle) != approval:
        raise RecoveryError("save_unsupported")
    game, installed = verified_private_game(bundle)
    return game.root / HEALTH_BUILD_SOURCES[0], installed.build_id, frozenset({"health"})


def verified_private_game(bundle: Bundle) -> tuple[GameInstallation, ValidatedInstalledBuild]:
    try:
        game, installed = _installed_game()
        if (
            installed.build_id != bundle.build
            or _source_pins(game, installed) != bundle.source_pins
        ):
            raise RecoveryError("save_unsupported")
    except (OSError, ValueError) as exc:
        if isinstance(exc, RecoveryError):
            raise
        raise RecoveryError("save_verification_unavailable") from exc
    return game, installed


def _admit_request(
    payload: object, fingerprint: str, domains: frozenset[str], approval: Approval | None
) -> str:
    domain, required = _intent_domain(payload)
    if approval is not None and (fingerprint != approval.fingerprint or payload != approval.intent):
        raise RecoveryError("save_unsupported")
    if not required <= domains:
        raise RecoveryError("save_unsupported")
    return domain


def _authorized_root(save: str, approval: Approval | None) -> Path:
    root = get_default_save_root()
    if root is None:
        raise RecoveryError("save_verification_unavailable")
    if (
        approval
        and approval.existing_path
        and approval.existing_path != root / save / f"{save}.es3"
    ):
        raise RecoveryError("save_unsupported")
    return root


def _authorize_build(
    bundle: Bundle | None, approval: Approval | None, save: str
) -> tuple[Path, str, frozenset[str]]:
    if bundle is None:
        return _game()
    if not bundle.session:
        return _qualification_game(bundle, approval, save)
    game, installed = verified_private_game(bundle)
    return (
        game.root / HEALTH_BUILD_SOURCES[0],
        installed.build_id,
        frozenset({"health", "upgrades", "run", "refillToFull"}),
    )


def production_health(
    action: str, save: str, operation: str = "", fingerprint: str = "", payload: object = None
) -> dict[str, object]:
    bundle = private_bundle()
    approval = read_approval(bundle) if bundle and not bundle.session else None

    def authorize() -> tuple[Path, str, frozenset[str]]:
        return _authorize_build(bundle, approval, save)

    try:
        executable, build, domains = authorize()
        root = _authorized_root(save, approval)
    except RecoveryError as exc:
        if action == "state":
            return {"ok": True, "state": "disabled"}
        return _outcome(operation, "rejected", exc.code)

    def game_status() -> GameProcessStatus:
        if authorize() != (executable, build, domains):
            raise RecoveryError("save_verification_unavailable")
        return _process_status(executable)

    def intent_allowed(intent: object) -> bool:
        if approval is not None:
            return intent == approval.intent
        try:
            return _intent_domain(intent)[1] <= domains
        except RecoveryError:
            return False

    if action == "state":
        return {
            **health_state(save, root, intent_allowed=intent_allowed, approval=approval),
            "domains": sorted(domains),
        }
    if action in {"inspect", "acknowledge"}:
        return recover_health(
            save,
            operation,
            root,
            canonical=True,
            acknowledge=action == "acknowledge",
            intent_allowed=intent_allowed,
            approval=approval,
        )
    if action not in {"prepare", "write"}:
        return _outcome(operation, "rejected", "invalid_request")
    try:
        domain = _admit_request(payload, fingerprint, domains, approval)
    except RecoveryError as exc:
        return _outcome(operation, "rejected", exc.code)
    changes = cast(dict[str, object], payload)[domain]

    if action == "prepare":
        return prepare_health(
            save,
            fingerprint,
            changes,
            operation,
            root,
            game_status_loader=game_status,
            verify_source_identity=True,
            approval=approval,
            health_batch=domain == "health",
            upgrade_batch=domain == "upgrades",
            run_batch=domain == "run",
            refill_batch=domain == "refillToFull",
            mixed_batch=domain == "mixed",
        )
    return write_health(
        save,
        fingerprint,
        changes,
        operation,
        root,
        game_status_loader=game_status,
        verify_source_identity=True,
        approval=approval,
        reserved=True,
        health_batch=domain == "health",
        upgrade_batch=domain == "upgrades",
        run_batch=domain == "run",
        refill_batch=domain == "refillToFull",
        mixed_batch=domain == "mixed",
    )
