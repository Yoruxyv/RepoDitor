"""Trusted R.E.P.O. LocalAppDataLow root derivation."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from repo_save_editor.services.environment.windows_paths import (
    resolve_windows_local_app_data_low,
)


@dataclass(frozen=True, slots=True)
class RepoLocalDataRoots:
    """Known product-owned paths beneath the authoritative LocalAppDataLow base."""

    root: Path
    saves: Path
    cache: Path
    icon_cache: Path
    meta_save: Path


LocalAppDataLowResolver = Callable[[], Path | None]


def get_repo_local_data_roots(
    resolver: LocalAppDataLowResolver = resolve_windows_local_app_data_low,
) -> RepoLocalDataRoots | None:
    """Return fixed R.E.P.O. local-data suffixes beneath LocalAppDataLow."""
    local_low = resolver()
    if local_low is None:
        return None
    root = local_low / "semiwork" / "Repo"
    cache = root / "Cache"
    return RepoLocalDataRoots(
        root=root,
        saves=root / "saves",
        cache=cache,
        icon_cache=cache / "Icons",
        meta_save=root / "MetaSave.es3",
    )


__all__ = ["RepoLocalDataRoots", "get_repo_local_data_roots"]
