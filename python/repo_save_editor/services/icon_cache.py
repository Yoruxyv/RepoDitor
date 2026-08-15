"""Optional local R.E.P.O. icon-cache discovery."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from repo_save_editor.services.game.local_data import (
    RepoLocalDataRoots,
    get_repo_local_data_roots,
)

IconDomain = Literal["item", "cosmetic"]
MAX_ICON_KEY_LENGTH = 260
UNUSABLE_ITEM_ICON_KEYS = frozenset({"item walkietalkiebox.png"})


@dataclass(frozen=True, slots=True)
class IconCacheRoots:
    """Trusted local cache roots for game-generated presentation icons."""

    items: Path
    cosmetics: Path


def get_icon_cache_roots(
    roots_loader: Callable[[], RepoLocalDataRoots | None] = get_repo_local_data_roots,
) -> IconCacheRoots | None:
    """Return fixed R.E.P.O. icon-cache roots, or ``None`` when unavailable."""
    roots = roots_loader()
    if roots is None:
        return None
    base = roots.icon_cache
    return IconCacheRoots(items=base / "Items", cosmetics=base / "Cosmetics")


def normalize_icon_cache_key(source: str) -> str | None:
    """Apply R.E.P.O.'s proven cache filename rule to one canonical identity."""
    if not isinstance(source, str):
        return None
    stem = source.replace("(Clone)", "").lower()
    if (
        not stem
        or len(stem) + 4 > MAX_ICON_KEY_LENGTH
        or stem in {".", ".."}
        or any(character in stem for character in ("/", "\\", "\0"))
    ):
        return None
    return f"{stem}.png"


def available_icon_keys(
    domain: IconDomain,
    keys: Iterable[str],
    roots_loader: Callable[[], IconCacheRoots | None] = get_icon_cache_roots,
) -> frozenset[str]:
    """Return trusted cache keys that currently name regular local PNG files."""
    roots = roots_loader()
    if roots is None:
        return frozenset()
    root = roots.items if domain == "item" else roots.cosmetics
    available: set[str] = set()
    for key in dict.fromkeys(keys):
        if (
            not isinstance(key, str)
            or (domain == "item" and key in UNUSABLE_ITEM_ICON_KEYS)
            or normalize_icon_cache_key(key.removesuffix(".png")) != key
        ):
            continue
        candidate = root / key
        try:
            if candidate.is_file() and not candidate.is_symlink():
                available.add(key)
        except OSError:
            continue
    return frozenset(available)


__all__ = [
    "IconCacheRoots",
    "available_icon_keys",
    "get_icon_cache_roots",
    "normalize_icon_cache_key",
]
