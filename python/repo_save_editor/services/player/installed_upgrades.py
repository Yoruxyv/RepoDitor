"""Optional installed-game presentation enrichment for player upgrades."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping

from repo_save_editor.services.icon_cache import IconDomain, available_icon_keys
from repo_save_editor.services.items.models import InstalledItemMetadata
from repo_save_editor.services.items.recharge_capability import discover_installed_item_metadata
from repo_save_editor.services.player.upgrades import (
    UpgradePresentation,
    UpgradePresentationSource,
    get_fallback_presentation,
)

_INSTALLED_NAME_ALIASES = {
    "Stamina": "Energy",
    "Launch": "Tumble Launch",
    "Speed": "Sprint Speed",
    "Strength": "Grab Strength",
    "Range": "Grab Range",
    "Throw": "Grab Throw",
}

MetadataLoader = Callable[[Iterable[str]], Mapping[str, InstalledItemMetadata]]
IconLoader = Callable[[IconDomain, Iterable[str]], frozenset[str]]


def upgrade_item_candidates(key: str) -> tuple[str, str]:
    """Return installed prefab names that may present one dynamic save upgrade.

    Candidate generation is presentation matching only. The save-key prefix
    remains the source of upgrade membership and edit authority.
    """

    raw = get_fallback_presentation(key).label
    installed_name = _INSTALLED_NAME_ALIASES.get(raw, raw)
    return (f"Item Upgrade Player {installed_name}", f"Item Upgrade {installed_name}")


def match_upgrade_items(
    keys: Iterable[str],
    item_names: Iterable[str],
) -> dict[str, str]:
    """Map uniquely matched installed Item prefab names to dynamic save upgrade keys."""
    owners: dict[str, str] = {}
    ambiguous: set[str] = set()
    for key in dict.fromkeys(keys):
        for candidate in upgrade_item_candidates(key):
            identity = candidate.casefold()
            owner = owners.get(identity)
            if owner is None:
                owners[identity] = key
            elif owner != key:
                ambiguous.add(identity)
    return {
        name: owners[identity]
        for name in dict.fromkeys(item_names)
        for identity in [name.casefold()]
        if identity in owners and identity not in ambiguous
    }


def discover_installed_upgrade_presentations(
    keys: Iterable[str],
    *,
    metadata_loader: MetadataLoader = discover_installed_item_metadata,
    icon_loader: IconLoader = available_icon_keys,
) -> dict[str, UpgradePresentation]:
    """Enrich upgrade labels, guidance, and cache icons without authorizing edits."""
    upgrade_keys = tuple(dict.fromkeys(keys))
    candidates_by_key = {key: upgrade_item_candidates(key) for key in upgrade_keys}
    metadata = metadata_loader(
        candidate for candidates in candidates_by_key.values() for candidate in candidates
    )
    matches: dict[str, InstalledItemMetadata] = {}
    for key, candidates in candidates_by_key.items():
        found = [
            metadata[name]
            for name in candidates
            if metadata.get(name, None) is not None and metadata[name].canonical_name is not None
        ]
        if len(found) == 1:
            matches[key] = found[0]
    available = icon_loader(
        "item",
        (match.icon_cache_key for match in matches.values() if match.icon_cache_key is not None),
    )
    result: dict[str, UpgradePresentation] = {}
    for key in upgrade_keys:
        fallback = get_fallback_presentation(key)
        match = matches.get(key)
        if match is None:
            result[key] = fallback
            continue
        label = (
            match.display_name.removesuffix(" Upgrade")
            if match.display_name and match.display_name.endswith(" Upgrade")
            else match.display_name
        )
        result[key] = UpgradePresentation(
            label or fallback.label,
            UpgradePresentationSource.INSTALLED if label else fallback.source,
            match.canonical_name,
            match.icon_cache_key if match.icon_cache_key in available else None,
            match.gameplay_cap,
        )
    return result


__all__ = [
    "discover_installed_upgrade_presentations",
    "match_upgrade_items",
    "upgrade_item_candidates",
]
