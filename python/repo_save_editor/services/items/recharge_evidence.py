"""Reusable installed-game evidence for authoritative item Recharge decisions."""

from __future__ import annotations

import os
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from repo_save_editor.services.game.discovery import discover_game_installation
from repo_save_editor.services.game.installed_build import validated_installed_build
from repo_save_editor.services.items.models import ItemRechargeCapability

RECHARGE_EVIDENCE_VERSION: Final = 1
RESOURCES_RELATIVE_PATH: Final = Path("REPO_Data/resources.assets")
GLOBAL_MANAGERS_RELATIVE_PATH: Final = Path("REPO_Data/globalgamemanagers.assets")
MAX_RECHARGE_EVIDENCE_ITEMS: Final = 512
MAX_RECHARGE_ITEM_NAME_CHARS: Final = 1_024
MAX_RECHARGE_PATH_CHARS: Final = 32_767
MAX_RECHARGE_BUILD_ID_CHARS: Final = 64


@dataclass(frozen=True, slots=True)
class InstalledFileIdentity:
    """Exact process-session identity for one validated installed source file."""

    path: str
    size: int
    mtime_ns: int
    device: int
    inode: int


@dataclass(frozen=True, slots=True)
class RechargeSourceContext:
    """Validated installed source context used by discovery and evidence verification."""

    installation_root: Path
    manifest_path: Path
    build_id: str
    resources_path: Path
    resources: InstalledFileIdentity
    global_managers_path: Path
    global_managers: InstalledFileIdentity


@dataclass(frozen=True, slots=True)
class RechargeEvidence:
    """Backend-derived Recharge capability evidence bound to installed source identity."""

    version: int
    installation_root: str
    manifest_path: str
    build_id: str
    resources: InstalledFileIdentity
    global_managers: InstalledFileIdentity
    capabilities: tuple[tuple[str, ItemRechargeCapability], ...]


def _path_key(path: str | Path) -> str:
    return os.path.normpath(os.fspath(path)).replace("\\", "/").casefold()


def _source_identity(path: Path) -> InstalledFileIdentity | None:
    try:
        if path.is_symlink() or not path.is_file():
            return None
        stat = path.stat()
    except OSError:
        return None
    return InstalledFileIdentity(
        path=str(path),
        size=stat.st_size,
        mtime_ns=stat.st_mtime_ns,
        device=stat.st_dev,
        inode=stat.st_ino,
    )


def resolve_recharge_source_context(game_dir: Path | None = None) -> RechargeSourceContext | None:
    """Resolve the currently supported installed source identity without parsing Unity metadata."""
    discovery = discover_game_installation(game_dir)
    installation = discovery.installation
    if installation is None:
        return None
    build = validated_installed_build(installation)
    if build is None:
        return None

    resources_path = installation.root / RESOURCES_RELATIVE_PATH
    global_managers_path = installation.root / GLOBAL_MANAGERS_RELATIVE_PATH
    resources = _source_identity(resources_path)
    global_managers = _source_identity(global_managers_path)
    if resources is None or global_managers is None:
        return None

    return RechargeSourceContext(
        installation_root=installation.root,
        manifest_path=build.manifest_path,
        build_id=build.build_id,
        resources_path=resources_path,
        resources=resources,
        global_managers_path=global_managers_path,
        global_managers=global_managers,
    )


def build_recharge_evidence(
    context: RechargeSourceContext,
    capabilities: Mapping[str, ItemRechargeCapability],
) -> RechargeEvidence:
    """Bind backend-derived capabilities to the exact installed source context."""
    return RechargeEvidence(
        version=RECHARGE_EVIDENCE_VERSION,
        installation_root=str(context.installation_root),
        manifest_path=str(context.manifest_path),
        build_id=context.build_id,
        resources=context.resources,
        global_managers=context.global_managers,
        capabilities=tuple(capabilities.items()),
    )


def _source_payload(identity: InstalledFileIdentity) -> dict[str, str]:
    return {
        "path": identity.path,
        "size": str(identity.size),
        "mtimeNs": str(identity.mtime_ns),
        "device": str(identity.device),
        "inode": str(identity.inode),
    }


def serialize_recharge_evidence(evidence: RechargeEvidence) -> dict[str, object]:
    """Serialize evidence without lossy JavaScript integer conversion."""
    return {
        "version": evidence.version,
        "installationRoot": evidence.installation_root,
        "manifestPath": evidence.manifest_path,
        "buildId": evidence.build_id,
        "resources": _source_payload(evidence.resources),
        "globalManagers": _source_payload(evidence.global_managers),
        "capabilities": [
            {"itemName": item_name, "capability": capability.value}
            for item_name, capability in evidence.capabilities
        ],
    }


def _read_text(value: object, maximum: int) -> str | None:
    if not isinstance(value, str) or not value or len(value) > maximum or "\0" in value:
        return None
    return value


def _read_nonnegative_decimal(value: object) -> int | None:
    if not isinstance(value, str) or not value.isascii() or not value.isdigit():
        return None
    parsed = int(value)
    return parsed if parsed >= 0 else None


def _parse_source(value: object) -> InstalledFileIdentity | None:
    if not isinstance(value, dict) or set(value) != {"path", "size", "mtimeNs", "device", "inode"}:
        return None
    path = _read_text(value["path"], MAX_RECHARGE_PATH_CHARS)
    size = _read_nonnegative_decimal(value["size"])
    mtime_ns = _read_nonnegative_decimal(value["mtimeNs"])
    device = _read_nonnegative_decimal(value["device"])
    inode = _read_nonnegative_decimal(value["inode"])
    if path is None or size is None or mtime_ns is None or device is None or inode is None:
        return None
    return InstalledFileIdentity(
        path=path,
        size=size,
        mtime_ns=mtime_ns,
        device=device,
        inode=inode,
    )


def _parse_evidence(value: object) -> RechargeEvidence | None:
    if not isinstance(value, dict) or set(value) != {
        "version",
        "installationRoot",
        "manifestPath",
        "buildId",
        "resources",
        "globalManagers",
        "capabilities",
    }:
        return None
    version = value["version"]
    if isinstance(version, bool) or version != RECHARGE_EVIDENCE_VERSION:
        return None
    installation_root = _read_text(value["installationRoot"], MAX_RECHARGE_PATH_CHARS)
    manifest_path = _read_text(value["manifestPath"], MAX_RECHARGE_PATH_CHARS)
    build_id = _read_text(value["buildId"], MAX_RECHARGE_BUILD_ID_CHARS)
    resources = _parse_source(value["resources"])
    global_managers = _parse_source(value["globalManagers"])
    raw_capabilities = value["capabilities"]
    if (
        installation_root is None
        or manifest_path is None
        or build_id is None
        or resources is None
        or global_managers is None
        or not isinstance(raw_capabilities, list)
        or len(raw_capabilities) > MAX_RECHARGE_EVIDENCE_ITEMS
    ):
        return None

    capabilities: list[tuple[str, ItemRechargeCapability]] = []
    exact_names: set[str] = set()
    folded_names: set[str] = set()
    for raw in raw_capabilities:
        if not isinstance(raw, dict) or set(raw) != {"itemName", "capability"}:
            return None
        item_name = _read_text(raw["itemName"], MAX_RECHARGE_ITEM_NAME_CHARS)
        capability_value = raw["capability"]
        if item_name is None or not isinstance(capability_value, str):
            return None
        try:
            capability = ItemRechargeCapability(capability_value)
        except ValueError:
            return None
        folded = item_name.casefold()
        if item_name in exact_names or folded in folded_names:
            return None
        exact_names.add(item_name)
        folded_names.add(folded)
        capabilities.append((item_name, capability))

    return RechargeEvidence(
        version=RECHARGE_EVIDENCE_VERSION,
        installation_root=installation_root,
        manifest_path=manifest_path,
        build_id=build_id,
        resources=resources,
        global_managers=global_managers,
        capabilities=tuple(capabilities),
    )


def _same_source(left: InstalledFileIdentity, right: InstalledFileIdentity) -> bool:
    return (
        _path_key(left.path) == _path_key(right.path)
        and left.size == right.size
        and left.mtime_ns == right.mtime_ns
        and left.device == right.device
        and left.inode == right.inode
    )


def verify_recharge_evidence(
    value: object,
    requested_item_names: Iterable[str],
    game_dir: Path | None = None,
) -> dict[str, ItemRechargeCapability] | None:
    """Return exact requested capabilities only when cached evidence is still authoritative.

    Any malformed, incomplete, stale, differently installed, or version-incompatible
    evidence returns ``None`` so callers can fall back to full installed metadata discovery.
    """
    evidence = _parse_evidence(value)
    if evidence is None:
        return None

    names: list[str] = []
    exact_names: set[str] = set()
    folded_names: set[str] = set()
    for raw_name in requested_item_names:
        if (
            not isinstance(raw_name, str)
            or not raw_name
            or len(raw_name) > MAX_RECHARGE_ITEM_NAME_CHARS
        ):
            return None
        folded = raw_name.casefold()
        if raw_name in exact_names or folded in folded_names:
            return None
        exact_names.add(raw_name)
        folded_names.add(folded)
        names.append(raw_name)
    if not names or len(names) > MAX_RECHARGE_EVIDENCE_ITEMS:
        return None

    capabilities = dict(evidence.capabilities)
    if set(capabilities) != set(names):
        return None

    context = resolve_recharge_source_context(game_dir)
    if context is None:
        return None
    if (
        evidence.build_id != context.build_id
        or _path_key(evidence.installation_root) != _path_key(context.installation_root)
        or _path_key(evidence.manifest_path) != _path_key(context.manifest_path)
        or not _same_source(evidence.resources, context.resources)
        or not _same_source(evidence.global_managers, context.global_managers)
    ):
        return None

    return {name: capabilities[name] for name in names}


__all__ = [
    "RechargeEvidence",
    "RechargeSourceContext",
    "build_recharge_evidence",
    "resolve_recharge_source_context",
    "serialize_recharge_evidence",
    "verify_recharge_evidence",
]
