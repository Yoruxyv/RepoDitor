"""Cheap discovery of local R.E.P.O. save slots."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Final

SAVE_SLOT_PATTERN: Final = re.compile(
    r"^REPO_SAVE_(?P<timestamp>\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2})$"
)
SAVE_SLOT_TIMESTAMP_FORMAT: Final = "%Y_%m_%d_%H_%M_%S"


class SaveRootStatus(StrEnum):
    """Availability states for the user's normal save root."""

    AVAILABLE = "available"
    MISSING = "missing"
    UNREADABLE = "unreadable"


@dataclass(frozen=True, slots=True)
class DiscoveredSave:
    """Filesystem metadata for one structurally valid save slot."""

    identifier: str
    display_name: str
    path: Path
    modified_at: datetime
    file_size: int


@dataclass(frozen=True, slots=True)
class SaveDiscoveryResult:
    """Save-root state and any valid slots found beneath it."""

    root: Path
    status: SaveRootStatus
    saves: tuple[DiscoveredSave, ...]
    skipped_entries: tuple[Path, ...] = ()

    @property
    def root_detected(self) -> bool:
        """Return whether the expected save root exists and is readable."""
        return self.status is SaveRootStatus.AVAILABLE


def get_default_save_root(home: Path | None = None) -> Path:
    """Return the current user's normal R.E.P.O. save directory."""
    user_home = Path.home() if home is None else home
    return user_home / "AppData" / "LocalLow" / "semiwork" / "Repo" / "saves"


def _get_display_name(slot_name: str) -> str | None:
    match = SAVE_SLOT_PATTERN.fullmatch(slot_name)
    if match is None:
        return None

    try:
        timestamp = datetime.strptime(
            match.group("timestamp"),
            SAVE_SLOT_TIMESTAMP_FORMAT,
        ).replace(tzinfo=UTC)
    except ValueError:
        return None

    return timestamp.strftime("%Y-%m-%d %H:%M:%S")


def discover_saves(root: Path | None = None) -> SaveDiscoveryResult:
    """Discover valid save slots using directory and file metadata only."""
    save_root = get_default_save_root() if root is None else root

    try:
        entries = tuple(save_root.iterdir())
    except FileNotFoundError:
        return SaveDiscoveryResult(save_root, SaveRootStatus.MISSING, ())
    except OSError:
        return SaveDiscoveryResult(save_root, SaveRootStatus.UNREADABLE, ())

    saves: list[DiscoveredSave] = []
    skipped_entries: list[Path] = []

    for entry in entries:
        display_name = _get_display_name(entry.name)
        if display_name is None:
            continue

        try:
            if not entry.is_dir():
                continue
        except OSError:
            skipped_entries.append(entry)
            continue

        save_path = entry / f"{entry.name}.es3"
        try:
            if not save_path.is_file():
                continue
            metadata = save_path.stat()
        except OSError:
            skipped_entries.append(entry)
            continue

        saves.append(
            DiscoveredSave(
                identifier=entry.name,
                display_name=display_name,
                path=save_path,
                modified_at=datetime.fromtimestamp(metadata.st_mtime, tz=UTC),
                file_size=metadata.st_size,
            )
        )

    saves.sort(
        key=lambda save: (save.modified_at, save.identifier),
        reverse=True,
    )
    return SaveDiscoveryResult(
        root=save_root,
        status=SaveRootStatus.AVAILABLE,
        saves=tuple(saves),
        skipped_entries=tuple(skipped_entries),
    )
