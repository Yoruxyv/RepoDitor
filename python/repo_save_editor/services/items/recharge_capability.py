"""Installed-game recharge-capability discovery for item types."""

from __future__ import annotations

from collections.abc import Iterable
from functools import lru_cache
from pathlib import Path

from repo_save_editor.services.items.installed_metadata import (
    discover_installed_item_metadata as discover_installed_item_metadata_from_assets,
)
from repo_save_editor.services.items.models import InstalledItemMetadata, ItemRechargeCapability
from repo_save_editor.services.items.recharge_evidence import (
    RechargeEvidence,
    build_recharge_evidence,
    resolve_recharge_source_context,
)


def discover_installed_recharge_capabilities(
    item_names: Iterable[str],
    game_dir: Path | None = None,
) -> dict[str, ItemRechargeCapability]:
    """Return conservative installed-game recharge capability for requested item types.

    Only the validated installed-game build is supported. Missing
    discovery, a different Steam build, missing assets, or any parser/layout
    mismatch returns ``unknown`` rather than affecting save reads.
    """
    return {
        name: metadata.recharge_capability
        for name, metadata in discover_installed_item_metadata(item_names, game_dir).items()
    }


def discover_installed_item_metadata_with_evidence(
    item_names: Iterable[str],
    game_dir: Path | None = None,
) -> tuple[dict[str, InstalledItemMetadata], RechargeEvidence | None]:
    """Return installed metadata plus reusable backend-authoritative Recharge evidence."""
    names = tuple(dict.fromkeys(name for name in item_names if isinstance(name, str) and name))
    unknown = {name: InstalledItemMetadata(ItemRechargeCapability.UNKNOWN, None) for name in names}
    if not names:
        return {}, None

    context = resolve_recharge_source_context(game_dir)
    if context is None:
        return unknown, None

    discovered = dict(
        _cached_item_metadata(
            context.resources_path,
            context.resources.size,
            context.resources.mtime_ns,
            context.resources.device,
            context.resources.inode,
            context.global_managers_path,
            context.global_managers.size,
            context.global_managers.mtime_ns,
            context.global_managers.device,
            context.global_managers.inode,
            names,
        )
    )
    metadata = {name: discovered.get(name, unknown[name]) for name in names}
    evidence = build_recharge_evidence(
        context,
        {name: value.recharge_capability for name, value in metadata.items()},
    )
    return metadata, evidence


def discover_installed_item_metadata(
    item_names: Iterable[str],
    game_dir: Path | None = None,
) -> dict[str, InstalledItemMetadata]:
    """Return conservative installed icon and recharge metadata for item types."""
    metadata, _evidence = discover_installed_item_metadata_with_evidence(item_names, game_dir)
    return metadata


@lru_cache(maxsize=16)
def _cached_item_metadata(
    resources_path: Path,
    _resources_size: int,
    _resources_mtime_ns: int,
    _resources_device: int,
    _resources_inode: int,
    global_managers_path: Path,
    _globals_size: int,
    _globals_mtime_ns: int,
    _globals_device: int,
    _globals_inode: int,
    names: tuple[str, ...],
) -> tuple[tuple[str, InstalledItemMetadata], ...]:
    """Cache derived metadata by requested identities and installed file identity."""
    return tuple(
        discover_installed_item_metadata_from_assets(
            resources_path, global_managers_path, names
        ).items()
    )


__all__ = [
    "discover_installed_item_metadata",
    "discover_installed_item_metadata_with_evidence",
    "discover_installed_recharge_capabilities",
]
