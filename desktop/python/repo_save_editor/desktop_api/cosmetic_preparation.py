"""One-source-index streaming preparation of installed cosmetic artwork.

Artwork transport only; no save writes, cache access or mutation authorization.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import BinaryIO, Final

from repo_save_editor.desktop_api.cosmetic_artwork import serialize_cosmetic_artwork
from repo_save_editor.services.cosmetics.installed_artwork import (
    CosmeticArtworkError,
    DecodedCosmeticArtwork,
    prepare_installed_cosmetic_artwork,
)

MAX_REQUEST_BYTES: Final = 16 * 1024
MAX_COSMETIC_IDS: Final = 2_000
Emit = Callable[[dict[str, object]], None]


def parse_cosmetic_ids(stream: BinaryIO) -> tuple[int, ...]:
    """Read one bounded canonical, unique cosmetic-ID array from trusted stdin."""
    raw = stream.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        raise ValueError("Cosmetic batch request is oversized.")
    try:
        value = json.loads(raw.decode("utf-8", errors="strict"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Cosmetic batch request is malformed.") from error
    if not isinstance(value, list) or not 0 < len(value) <= MAX_COSMETIC_IDS:
        raise ValueError("Cosmetic batch request has an unsupported count.")
    result: list[int] = []
    for raw_id in value:
        if (
            not isinstance(raw_id, str)
            or not raw_id.isascii()
            or not raw_id.isdecimal()
            or len(raw_id) > 4
            or str(int(raw_id)) != raw_id
        ):
            raise ValueError("Cosmetic batch contains a noncanonical ID.")
        cosmetic_id = int(raw_id)
        if cosmetic_id >= MAX_COSMETIC_IDS:
            raise ValueError("Cosmetic ID is outside the supported bound.")
        result.append(cosmetic_id)
    if len(set(result)) != len(result):
        raise ValueError("Cosmetic batch contains duplicate IDs.")
    return tuple(result)


def stream_cosmetic_artwork(ids: tuple[int, ...], emit: Emit) -> None:
    """Decode an installed batch once and emit one validated image record per ID."""
    requested = len(ids)
    try:
        completed = 0

        def on_decoded(artwork: DecodedCosmeticArtwork) -> None:
            nonlocal completed
            completed += 1
            emit({
                "type": "texture",
                "cosmeticId": artwork.cosmetic_id,
                "artwork": serialize_cosmetic_artwork(artwork),
                "completed": completed,
                "total": requested,
            })

        prepared = prepare_installed_cosmetic_artwork(ids, on_decoded=on_decoded)
        if (
            completed != requested or len(prepared) != requested
            or set(v.cosmetic_id for v in prepared) != set(ids)
        ):
            raise CosmeticArtworkError("Decoder returned incomplete cosmetic artwork.")
        emit({"type": "final", "ok": True, "completed": completed, "total": requested})
    except (CosmeticArtworkError, ImportError, OSError, ValueError, RuntimeError):
        emit({"type": "final", "ok": False, "completed": 0, "total": requested})


__all__ = ["parse_cosmetic_ids", "stream_cosmetic_artwork"]
