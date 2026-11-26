"""Installed-build admission for the production Run-save commands."""

from __future__ import annotations

import os
from collections.abc import Callable
from functools import partial
from pathlib import Path
from sys import platform
from typing import Final, NamedTuple, cast

from repo_save_editor.core.types import SaveData
from repo_save_editor.desktop_api.transactions.health_recovery import (
    _outcome,
    health_state,
    prepare_health,
    recover_health,
    validate_runtime_write,
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
from repo_save_editor.services.game.installed_maps import SOURCE_NAMES, verify_resume_levels
from repo_save_editor.services.game.launcher import matches_reviewed_launcher
from repo_save_editor.services.game.processes import (
    GameProcessStatus,
    ProcessInspectionError,
    classify_game_process,
    inspect_windows_processes,
)
from repo_save_editor.services.game.save_settings import (
    MANAGERS,
    RESOURCES,
    SCRIPTS,
    SUNSTONE_BUILD_SETTINGS,
    SUNSTONE_ES3_DEFAULTS,
    inspect_save_settings,
)
from repo_save_editor.services.game.write_evidence import (
    APPROVED_RUN_DOMAINS,
    APPROVED_WRITE_SOURCES,
    RECHARGE_IDENTITIES,
    RECHARGE_UNITY,
    SAVE_FORMAT_PINS,
    ApprovedWriteSources,
    source_digest,
    source_pins_match,
)
from repo_save_editor.services.items.models import ItemRechargeCapability
from repo_save_editor.services.items.runtime_metadata import discover_installed_item_metadata
from repo_save_editor.services.saves.discovery import get_default_save_root
from repo_save_editor.services.saves.private_health import (
    Approval,
    Bundle,
    private_bundle,
    read_approval,
)
from repo_save_editor.services.unity_serialized import UnityMetadataError
from repo_save_editor.storage.health_recovery import RecoveryError
from repo_save_editor.storage.receipt_intents import (
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
_OPERATIONS = ("health", "upgrades", "run", "resume", "refillToFull")


class RuntimeSaveSources(NamedTuple):
    reviewed: ApprovedWriteSources
    pins: tuple[tuple[str, str], ...]
    resume: bool
    resume_pins: tuple[tuple[str, str], ...] = ()


SharedSources = ApprovedWriteSources | RuntimeSaveSources


class DynamicRechargeSources(NamedTuple):
    shared: SharedSources
    assets: tuple[tuple[str, str], ...]
    identities: tuple[str, ...]


RunSources = SharedSources | DynamicRechargeSources | None


class UnsupportedSaveSettingsError(RecoveryError):
    """The installed ES3 configuration differs from the supported fallback contract."""


def _disabled_compatibility(error: RecoveryError) -> dict[str, object]:
    status = "incompatible" if isinstance(error, UnsupportedSaveSettingsError) else "unverified"
    return {"ok": True, "state": "disabled", "compatibility": dict.fromkeys(_OPERATIONS, status)}


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


def _game() -> tuple[Path, str, frozenset[str], SharedSources | DynamicRechargeSources]:
    game, build = _installed_game()
    shared = verify_shared_sources(game, build)
    approved = shared.reviewed if isinstance(shared, RuntimeSaveSources) else shared
    domains = APPROVED_RUN_DOMAINS
    if RECHARGE_IDENTITIES and source_pins_match(game.root, approved.recharge):
        recheck_shared_sources(game, build, shared)
        domains |= {"refillToFull"}
    elif RECHARGE_IDENTITIES and {name for name, _ in approved.recharge} == {RESOURCES, SCRIPTS}:
        dynamic = None
        try:
            paths = tuple(name for name, _ in approved.recharge)
            pins = _source_pins(game, build, paths)
            metadata = discover_installed_item_metadata(
                game.root / RESOURCES,
                game.root / SCRIPTS,
                RECHARGE_IDENTITIES,
                unity_version=RECHARGE_UNITY,
            )
            identities = tuple(
                name
                for name in RECHARGE_IDENTITIES
                if name in metadata
                and metadata[name].canonical_name == name
                and metadata[name].recharge_capability is ItemRechargeCapability.RECHARGEABLE
            )
            if identities and pins == _source_pins(game, build, paths):
                dynamic = DynamicRechargeSources(
                    shared, tuple(zip(paths, pins, strict=True)), identities
                )
        except (OSError, ValueError):
            # A failed optional Item proof must not revoke the independent domains.
            pass
        recheck_shared_sources(game, build, shared)
        if dynamic is not None:
            return (
                game.root / HEALTH_BUILD_SOURCES[0],
                build.build_id,
                domains | {"refillToFull"},
                dynamic,
            )
    return game.root / HEALTH_BUILD_SOURCES[0], build.build_id, domains, shared


def verify_shared_sources(game: GameInstallation, build: ValidatedInstalledBuild) -> SharedSources:
    code_paths = HEALTH_BUILD_SOURCES[:-1] + SAVE_FORMAT_SOURCES
    shared_paths = (*code_paths, MANAGERS)
    try:
        installed = _source_pins(game, build, shared_paths)
        reviewed = tuple(
            row
            for row in APPROVED_WRITE_SOURCES
            if installed[1 : len(code_paths)] == row.gameplay[1:-1] + SAVE_FORMAT_PINS
        )
        if not reviewed:
            raise RecoveryError("save_unsupported")
        exact_launcher = any(installed[0] == row.gameplay[0] for row in reviewed)
        if not exact_launcher and not matches_reviewed_launcher(game.root, installed[0]):
            raise RecoveryError("save_unsupported")
        exact = next((row for row in reviewed if installed[-1] == row.gameplay[-1]), None)
        settings_paths = (RESOURCES, SCRIPTS)
        # These source files can contain the live serializer defaults even on an
        # otherwise exact match. Re-resolve the typed object if they changed.
        exact_settings = exact is not None and (
            not exact.recharge or source_pins_match(game.root, exact.recharge)
        )
        settings_evidence = exact.recharge if exact_settings and exact else ()
        scenes = None
        if not exact_settings:
            settings_evidence = tuple(
                zip(settings_paths, _source_pins(game, build, settings_paths), strict=True)
            )
            defaults, scenes = inspect_save_settings(game.root)
            if defaults != SUNSTONE_ES3_DEFAULTS:
                raise UnsupportedSaveSettingsError("save_unsupported")
        # Resume additionally relies on scene selection and authored Level references.
        level_paths = ("REPO_Data/level0", "REPO_Data/sharedassets0.assets")
        level_pins: tuple[tuple[str, str], ...] = ()
        source = exact if exact is not None else reviewed[0]
        reviewed_levels = tuple(dict(source.cosmetics).get(path) for path in level_paths)
        level_evidence = tuple(pair for pair in source.cosmetics if pair[0] in level_paths)
        if (
            exact_settings
            and len(level_evidence) == len(level_paths)
            and source_pins_match(game.root, level_evidence)
        ):
            level_pins = level_evidence
        # Older fixture records lack separate Level evidence. An exact-reviewed
        # production record always carries both paths.
        resume = bool(level_pins) or (exact is not None and None in reviewed_levels)
        if exact is not None and exact_launcher and exact_settings and resume:
            return exact
        if not resume and (exact_settings or scenes == SUNSTONE_BUILD_SETTINGS):
            level_pins = _runtime_resume_sources(game, build)
            resume = bool(level_pins)
        pins = tuple(zip(shared_paths, installed, strict=True)) + settings_evidence
        runtime = RuntimeSaveSources(source, pins, resume, level_pins)
        recheck_shared_sources(game, build, runtime)
        return runtime
    except (FileNotFoundError, UnityMetadataError) as exc:
        raise RecoveryError("save_unsupported") from exc
    except (OSError, ValueError, KeyError) as exc:
        if isinstance(exc, RecoveryError):
            raise
        raise RecoveryError("save_verification_unavailable") from exc


def _runtime_resume_sources(
    game: GameInstallation, build: ValidatedInstalledBuild
) -> tuple[tuple[str, str], ...]:
    paths = tuple(f"REPO_Data/{name}" for name in SOURCE_NAMES)
    try:
        before = _source_pins(game, build, paths)
        verify_resume_levels(game.root)
        if _source_pins(game, build, paths) == before:
            return tuple(zip(paths, before, strict=True))
    except (OSError, ValueError, KeyError):
        # Resume availability must not affect independent Run values or other domains.
        pass
    return ()


def recheck_shared_sources(
    game: GameInstallation, build: ValidatedInstalledBuild, sources: SharedSources
) -> None:
    """Confirm the exact bytes consumed by the earlier compatibility checks."""
    if isinstance(sources, RuntimeSaveSources):
        paths, digests = zip(*sources.pins, strict=True)
        try:
            if _source_pins(game, build, paths) == digests:
                return
        except (OSError, ValueError):
            pass
    elif verify_shared_sources(game, build) == sources:
        return
    raise RecoveryError("save_verification_unavailable")


def _source_pins(
    game: GameInstallation,
    build: ValidatedInstalledBuild,
    sources: tuple[str, ...] = HEALTH_BUILD_SOURCES,
) -> tuple[str, ...]:
    if game.steam_library_root is None:
        raise RecoveryError("save_verification_unavailable")
    manifest = source_digest(game.steam_library_root, build.manifest_path)
    pins = tuple(
        source_digest(game.root, game.root / name, max_bytes=512 * 1024 * 1024) for name in sources
    )
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
) -> tuple[Path, str, frozenset[str], RunSources]:
    if bundle is None:
        return _game()
    if not bundle.session:
        return (*_qualification_game(bundle, approval, save), None)
    game, installed = verified_private_game(bundle)
    domains = {"health", "upgrades", "run"}
    if bundle.recharge_identities and source_pins_match(game.root, bundle.item_sources):
        domains.add("refillToFull")
    return game.root / HEALTH_BUILD_SOURCES[0], installed.build_id, frozenset(domains), None


def _reviewed_recharge(
    names: tuple[str, ...], allowed: tuple[str, ...] = RECHARGE_IDENTITIES
) -> dict[str, ItemRechargeCapability]:
    return {name: ItemRechargeCapability.RECHARGEABLE for name in names if name in allowed}


def _compatibility_state(
    state: dict[str, object],
    domains: frozenset[str],
    sources: RuntimeSaveSources | None,
) -> dict[str, object]:
    canonical = state.get("canonical")
    resume_field = (
        canonical.pop("resumeFieldSupported", True) if isinstance(canonical, dict) else True
    )
    resume = "run" in domains and (sources is None or (sources.resume and resume_field is True))
    available = domains | {"resume"} if resume else domains
    state["domains"] = sorted(domains)
    state["compatibility"] = {
        name: "verified" if name in available else "unverified" for name in _OPERATIONS
    }
    if sources is not None:
        state["resumeAllowed"] = resume
    return state


def _compatible_request(
    payload: object,
    action: str,
    fingerprint: str,
    domains: frozenset[str],
    approval: Approval | None,
    sources: RuntimeSaveSources | None,
) -> tuple[str, object, Callable[[SaveData], None] | None]:
    domain = _admit_request(payload, fingerprint, domains, approval)
    intent = cast(dict[str, object], payload)
    if sources is None:
        return domain, intent[domain], None
    if action != "apply":
        raise RecoveryError("save_unsupported")
    return domain, intent[domain], partial(validate_runtime_write, intent, sources.resume)


def _recheck_runtime_write(
    executable: Path,
    build_id: str,
    runtime: RuntimeSaveSources,
    recharge: DynamicRechargeSources | None,
    resume: bool,
) -> None:
    game, build = _installed_game()
    if (game.root / HEALTH_BUILD_SOURCES[0], build.build_id) != (executable, build_id):
        raise RecoveryError("save_verification_unavailable")
    recheck_shared_sources(game, build, runtime)
    if resume and not source_pins_match(game.root, runtime.resume_pins):
        raise RecoveryError("save_verification_unavailable")
    if recharge is not None and not source_pins_match(game.root, recharge.assets):
        raise RecoveryError("save_verification_unavailable")


def _changes_resume(payload: object) -> bool:
    if not isinstance(payload, dict):
        return False
    groups = payload.get("mixed", payload)
    edits = groups.get("run") if isinstance(groups, dict) else None
    return isinstance(edits, list) and any(
        isinstance(edit, dict) and edit.get("field") == "resumeLocation" for edit in edits
    )


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

    def authorize() -> tuple[Path, str, frozenset[str], RunSources]:
        return _authorize_build(bundle, approval, save)

    try:
        authorization = authorize()
        executable, _, domains, sources = authorization
        root = _authorized_root(save, approval)
    except RecoveryError as exc:
        if action == "state":
            return _disabled_compatibility(exc)
        return _outcome(operation, "rejected", exc.code)

    def verify_exact_build() -> None:
        if authorize() != authorization:
            raise RecoveryError("save_verification_unavailable")

    recharge_sources = sources if isinstance(sources, DynamicRechargeSources) else None
    shared = recharge_sources.shared if recharge_sources is not None else sources
    runtime = shared if isinstance(shared, RuntimeSaveSources) else None
    verify_build = (
        partial(
            _recheck_runtime_write,
            executable,
            authorization[1],
            runtime,
            recharge_sources,
            _changes_resume(payload),
        )
        if runtime is not None
        else verify_exact_build
    )

    def status_with_build_check() -> GameProcessStatus:
        verify_build()
        return _process_status(executable)

    game_status = (
        partial(_process_status, executable) if action == "apply" else status_with_build_check
    )
    intent_allowed = partial(_recovery_intent_allowed, domains=domains, approval=approval)
    dynamic_recharge = (
        partial(_reviewed_recharge, allowed=recharge_sources.identities)
        if recharge_sources
        else None
    )
    canonical_recharge = (
        bundle.reviewed_recharge
        if bundle is not None and bundle.session and "refillToFull" in domains
        else dynamic_recharge
    )

    if action == "state":
        state = health_state(
            save,
            root,
            intent_allowed=intent_allowed,
            approval=approval,
            recharge_capability_loader=canonical_recharge,
            game_root=executable.parent if canonical_recharge is not None else None,
            check_runtime_resume=runtime is not None,
        )
        return _compatibility_state(state, domains, runtime)
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
            recharge_capability_loader=canonical_recharge,
        )
    if action not in {"prepare", "write", "apply"} or (
        action == "apply" and publication_allowed is None
    ):
        return _outcome(operation, "rejected", "invalid_request")
    try:
        domain, changes, verify_target = _compatible_request(
            payload, action, fingerprint, domains, approval, runtime
        )
    except RecoveryError as exc:
        return _outcome(operation, "rejected", exc.code)
    allow_missing_health = bundle is not None and bundle.session
    recharge_loader = bundle.reviewed_recharge if bundle is not None else _reviewed_recharge
    if dynamic_recharge is not None:
        recharge_loader = dynamic_recharge

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
            verify_target=verify_target,
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
        verify_target=verify_target,
    )
