"""Installed-game recharge-capability discovery for item types."""

from __future__ import annotations

import json
from collections.abc import Iterable
from contextlib import nullcontext
from dataclasses import asdict
from functools import lru_cache
from hashlib import sha256
from pathlib import Path

from repo_save_editor.services.baked_artwork import installed_source_stamp
from repo_save_editor.services.items.installed_metadata import (
    discover_installed_item_metadata as discover_installed_item_metadata_from_assets,
)
from repo_save_editor.services.items.models import InstalledItemMetadata, ItemRechargeCapability
from repo_save_editor.services.items.recharge_evidence import (
    RechargeEvidence,
    RechargeSourceContext,
    build_recharge_evidence,
    resolve_recharge_source_context,
)
from repo_save_editor.services.native_artwork_cache import native_artwork_cache
from repo_save_editor.services.saves.private_health import private_bundle

_METADATA_VERSION = 1
_MAX_PROJECTIONS = 8


def _cache_key(value: object) -> str:
    return sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def _metadata_revision(context: RechargeSourceContext) -> str | None:
    try:
        resources = installed_source_stamp(context.resources_path, context.resources_path.stat())
        managers = installed_source_stamp(
            context.global_managers_path, context.global_managers_path.stat()
        )
        manifest = installed_source_stamp(context.manifest_path, context.manifest_path.stat())
    except (OSError, ValueError):
        return None
    for stamp, source in ((resources, context.resources), (managers, context.global_managers)):
        if stamp[:4] != (source.device, source.inode, source.size, source.mtime_ns):
            return None
    return _cache_key((_METADATA_VERSION, asdict(context), resources, managers, manifest))


def _decode_metadata(
    frame: object, names: tuple[str, ...]
) -> dict[str, InstalledItemMetadata] | None:
    if not isinstance(frame, list) or len(frame) != len(names):
        return None
    result = {}
    for name, row in zip(names, frame, strict=True):
        if row is None:
            continue
        if not isinstance(row, dict) or row.keys() != {
            "recharge_capability",
            "icon_cache_key",
            "canonical_name",
            "display_name",
            "gameplay_cap",
        }:
            return None
        capability, icon, canonical, display, cap = (
            row[field]
            for field in (
                "recharge_capability",
                "icon_cache_key",
                "canonical_name",
                "display_name",
                "gameplay_cap",
            )
        )
        if (
            capability not in tuple(ItemRechargeCapability)
            or any(
                value is not None and not isinstance(value, str)
                for value in (icon, canonical, display)
            )
            or (cap is not None and (type(cap) is not int or not 0 <= cap <= 9_007_199_254_740_991))
        ):
            return None
        result[name] = InstalledItemMetadata(
            ItemRechargeCapability(capability), icon, canonical, display, cap
        )
    return result


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
    *,
    reuse_native_metadata: bool = False,
) -> tuple[dict[str, InstalledItemMetadata], RechargeEvidence | None]:
    """Return installed metadata plus reusable backend-authoritative Recharge evidence."""
    names = tuple(dict.fromkeys(name for name in item_names if isinstance(name, str) and name))
    unknown = {name: InstalledItemMetadata(ItemRechargeCapability.UNKNOWN, None) for name in names}
    if not names:
        return {}, None

    context = resolve_recharge_source_context(game_dir)
    if context is None:
        return unknown, None

    # Only the native read commands opt in. Transaction admission always uses fresh
    # authoritative extraction, independently of the optional presentation storage.
    bundle = private_bundle() if reuse_native_metadata else None
    storage = (
        native_artwork_cache("metadata", isolated=bundle is not None and not bundle.live)
        if reuse_native_metadata
        else nullcontext()
    )
    with storage as cache:
        revision = _metadata_revision(context) if cache is not None else None
        discovered = None
        frames: dict[str, object] = {}
        if cache is not None and revision is not None:
            ordered = tuple(sorted(names))
            request = _cache_key(ordered)
            try:
                frame = json.loads(cache.editor_frame("metadata", revision) or b"{}")
                if isinstance(frame, dict) and len(frame) <= _MAX_PROJECTIONS:
                    frames = frame
            except (ValueError, RecursionError):
                pass
            discovered = _decode_metadata(frames.get(request), ordered)
        hit = discovered is not None
        if discovered is None:
            discovered = dict(_cached_item_metadata(context, names, revision))
        if (cache is not None or context.unity_version is not None) and (
            resolve_recharge_source_context(game_dir) != context
            or (revision is not None and _metadata_revision(context) != revision)
        ):
            if cache is not None:
                cache.note("source_changed")
            return unknown, None
        if cache is not None and revision is not None:
            cache.note("editor_hit" if hit else "editor_miss")
            # A parser-wide failure also returns all unknown. Let a later read retry it.
            if not hit and any(value.canonical_name is not None for value in discovered.values()):
                frames.pop(request, None)
                frames[request] = [
                    asdict(value) if (value := discovered.get(name)) is not None else None
                    for name in ordered
                ]
                payload = dict(list(frames.items())[-_MAX_PROJECTIONS:])
                cache.publish_editor_frame("metadata", revision, json.dumps(payload).encode())
    metadata = {name: discovered.get(name, unknown[name]) for name in names}
    evidence = build_recharge_evidence(
        context,
        {name: value.recharge_capability for name, value in metadata.items()},
    )
    return metadata, evidence


def discover_installed_item_metadata(
    item_names: Iterable[str],
    game_dir: Path | None = None,
    *,
    reuse_native_metadata: bool = False,
) -> dict[str, InstalledItemMetadata]:
    """Return conservative installed icon and recharge metadata for item types."""
    metadata, _evidence = discover_installed_item_metadata_with_evidence(
        item_names, game_dir, reuse_native_metadata=reuse_native_metadata
    )
    return metadata


@lru_cache(maxsize=16)
def _cached_item_metadata(
    context: RechargeSourceContext,
    names: tuple[str, ...],
    _revision: str | None,
) -> tuple[tuple[str, InstalledItemMetadata], ...]:
    """Cache derived metadata by requested identities and installed file identity."""
    return tuple(
        discover_installed_item_metadata_from_assets(
            context.resources_path,
            context.global_managers_path,
            names,
            unity_version=context.unity_version,
        ).items()
    )


__all__ = [
    "discover_installed_item_metadata",
    "discover_installed_item_metadata_with_evidence",
    "discover_installed_recharge_capabilities",
]
