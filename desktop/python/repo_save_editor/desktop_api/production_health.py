"""Installed-build admission for the production Run-save commands."""

from __future__ import annotations

import os
from collections.abc import Callable
from functools import partial
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
)
from repo_save_editor.services.game.processes import (
    GameProcessStatus,
    ProcessInspectionError,
    classify_game_process,
    inspect_windows_processes,
)
from repo_save_editor.services.game.write_evidence import (
    APPROVED_RUN_DOMAINS,
    APPROVED_WRITE_SOURCES,
    RECHARGE_IDENTITIES,
    SAVE_FORMAT_PINS,
    ApprovedWriteSources,
    source_digest,
    source_pins_match,
)
from repo_save_editor.services.items.models import ItemRechargeCapability
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
SAVE_FORMAT_SOURCES: Final = (
    "REPO_Data/Managed/Assembly-CSharp-firstpass.dll",
    "REPO_Data/Managed/netstandard.dll",
    "REPO_Data/Managed/mscorlib.dll",
    "REPO_Data/Managed/System.dll",
    "REPO_Data/Managed/UnityEngine.CoreModule.dll",
    "MonoBleedingEdge/EmbedRuntime/mono-2.0-bdwgc.dll",
    "MonoBleedingEdge/etc/mono/config",
    "MonoBleedingEdge/etc/mono/4.5/machine.config",
)
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


def _game() -> tuple[Path, str, frozenset[str], ApprovedWriteSources]:
    game, build = _installed_game()
    approved = _verify_public_sources(game, build)
    domains = APPROVED_RUN_DOMAINS
    if RECHARGE_IDENTITIES and source_pins_match(game.root, approved.recharge):
        if _verify_public_sources(game, build) != approved:
            raise RecoveryError("save_verification_unavailable")
        domains |= {"refillToFull"}
    return game.root / HEALTH_BUILD_SOURCES[0], build.build_id, domains, approved


def _verify_public_sources(
    game: GameInstallation, build: ValidatedInstalledBuild
) -> ApprovedWriteSources:
    try:
        installed = _source_pins(game, build, HEALTH_BUILD_SOURCES + SAVE_FORMAT_SOURCES)
        for approved in APPROVED_WRITE_SOURCES:
            if installed == approved.gameplay + SAVE_FORMAT_PINS:
                return approved
        raise RecoveryError("save_unsupported")
    except FileNotFoundError as exc:
        raise RecoveryError("save_unsupported") from exc
    except (OSError, ValueError) as exc:
        if isinstance(exc, RecoveryError):
            raise
        raise RecoveryError("save_verification_unavailable") from exc


def _source_pins(
    game: GameInstallation,
    build: ValidatedInstalledBuild,
    sources: tuple[str, ...] = HEALTH_BUILD_SOURCES,
) -> tuple[str, ...]:
    if game.steam_library_root is None:
        raise RecoveryError("save_verification_unavailable")
    manifest = source_digest(game.steam_library_root, build.manifest_path)
    pins = tuple(source_digest(game.root, game.root / name) for name in sources)
    if (
        installed_build_identity(game) != build
        or source_digest(game.steam_library_root, build.manifest_path) != manifest
    ):
        raise RecoveryError("save_verification_unavailable")
    return pins


def _verify_private_sources(
    game: GameInstallation, build: ValidatedInstalledBuild, bundle: Bundle
) -> None:
    sources = HEALTH_BUILD_SOURCES + (SAVE_FORMAT_SOURCES if bundle.save_format_pins else ())
    if (
        not bundle.accepts_build_id(build.build_id)
        or _source_pins(game, build, sources) != bundle.source_pins + bundle.save_format_pins
    ):
        raise RecoveryError("save_unsupported")


def _process_status(executable: Path) -> GameProcessStatus:
    try:
        inspection = inspect_windows_processes(executable)
    except (ProcessInspectionError, OSError):
        return GameProcessStatus.UNKNOWN
    status = classify_game_process(executable, inspection)
    if status is GameProcessStatus.NOT_RUNNING and inspection.executable_paths:
        return GameProcessStatus.UNKNOWN
    return status


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
        _verify_private_sources(game, installed, bundle)
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


def _recovery_intent_allowed(
    intent: object, *, domains: frozenset[str], approval: Approval | None
) -> bool:
    if approval is not None:
        return intent == approval.intent
    try:
        return _intent_domain(intent)[1] <= domains
    except RecoveryError:
        return False


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
) -> tuple[Path, str, frozenset[str], ApprovedWriteSources | None]:
    if bundle is None:
        return _game()
    if not bundle.session:
        return (*_qualification_game(bundle, approval, save), None)
    game, installed = verified_private_game(bundle)
    domains = {"health", "upgrades", "run"}
    if bundle.recharge_identities and source_pins_match(game.root, bundle.item_sources):
        domains.add("refillToFull")
    return game.root / HEALTH_BUILD_SOURCES[0], installed.build_id, frozenset(domains), None


def _reviewed_recharge(names: tuple[str, ...]) -> dict[str, ItemRechargeCapability]:
    return {
        name: ItemRechargeCapability.RECHARGEABLE for name in names if name in RECHARGE_IDENTITIES
    }


def production_health(
    action: str,
    save: str,
    operation: str = "",
    fingerprint: str = "",
    payload: object = None,
    *,
    publication_allowed: Callable[[], bool] | None = None,
) -> dict[str, object]:
    bundle = private_bundle()
    approval = read_approval(bundle) if bundle and not bundle.session else None

    def authorize() -> tuple[Path, str, frozenset[str], ApprovedWriteSources | None]:
        return _authorize_build(bundle, approval, save)

    try:
        authorization = authorize()
        executable, _, domains, _ = authorization
        root = _authorized_root(save, approval)
    except RecoveryError as exc:
        if action == "state":
            return {"ok": True, "state": "disabled"}
        return _outcome(operation, "rejected", exc.code)

    def verify_build() -> None:
        if authorize() != authorization:
            raise RecoveryError("save_verification_unavailable")

    def status_with_build_check() -> GameProcessStatus:
        verify_build()
        return _process_status(executable)

    game_status = (
        partial(_process_status, executable) if action == "apply" else status_with_build_check
    )
    intent_allowed = partial(_recovery_intent_allowed, domains=domains, approval=approval)

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
            game_root=executable.parent,
            acknowledge=action == "acknowledge",
            intent_allowed=intent_allowed,
            approval=approval,
        )
    if action not in {"prepare", "write", "apply"} or (
        action == "apply" and publication_allowed is None
    ):
        return _outcome(operation, "rejected", "invalid_request")
    try:
        domain = _admit_request(payload, fingerprint, domains, approval)
    except RecoveryError as exc:
        return _outcome(operation, "rejected", exc.code)
    changes = cast(dict[str, object], payload)[domain]
    allow_missing_health = bundle is not None and bundle.session
    recharge_loader = bundle.reviewed_recharge if bundle is not None else _reviewed_recharge

    if action in {"prepare", "apply"}:
        prepared = prepare_health(
            save,
            fingerprint,
            changes,
            operation,
            root,
            game_status_loader=game_status,
            verify_source_identity=True,
            allow_missing_health=allow_missing_health,
            recharge_capability_loader=recharge_loader,
            approval=approval,
            health_batch=domain == "health",
            upgrade_batch=domain == "upgrades",
            run_batch=domain == "run",
            refill_batch=domain == "refillToFull",
            mixed_batch=domain == "mixed",
        )
        transaction = cast(dict[str, object], prepared["transaction"])
        if action == "prepare" or transaction["status"] != "prepared":
            return prepared
        # Rust rechecks the editor generation after reservation. EOF never grants publication.
        if publication_allowed is None or not publication_allowed():
            return _outcome(operation, "uncertain", "write_recovery_required")
    return write_health(
        save,
        fingerprint,
        changes,
        operation,
        root,
        game_status_loader=game_status,
        verify_source_identity=True,
        allow_missing_health=allow_missing_health,
        recharge_capability_loader=recharge_loader,
        verify_build=verify_build if action == "apply" else None,
        approval=approval,
        reserved=True,
        own_reservation=action == "apply",
        health_batch=domain == "health",
        upgrade_batch=domain == "upgrades",
        run_batch=domain == "run",
        refill_batch=domain == "refillToFull",
        mixed_batch=domain == "mixed",
    )
