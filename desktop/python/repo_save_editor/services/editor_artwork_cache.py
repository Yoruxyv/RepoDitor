"""Reuse optional editor images after fresh installed-source admission."""

from __future__ import annotations

import base64
import json
import re
import struct
import zlib
from collections.abc import Callable, Mapping
from hashlib import sha256
from pathlib import Path
from time import perf_counter
from typing import cast

from repo_save_editor.services.baked_artwork import entry_artwork_revision
from repo_save_editor.services.native_artwork_cache import (
    EditorScope,
    NativeArtworkCache,
    cacheable_png,
    native_artwork_cache,
)

Image = dict[str, str | int]
Result = Image | bool | None
MAX_IMAGE = 1024 * 1024
MAX_BASE64 = 4 * ((MAX_IMAGE + 2) // 3)
_KEY_FIELDS: dict[EditorScope, str] = {
    "upgrade": "upgradeKey",
    "item": "itemName",
    "map": "mapFamily",
}
_REVISION = re.compile("[0-9a-f]{64}")


def _valid_payload(row: object, map_revision: str | None) -> bool:
    if not isinstance(row, dict) or row.keys() != {
        "sourceIdentity",
        "width",
        "height",
        "pngBase64",
    }:
        return False
    revision, width, height, png = (
        row[k] for k in ("sourceIdentity", "width", "height", "pngBase64")
    )
    return (
        isinstance(revision, str)
        and _REVISION.fullmatch(revision) is not None
        and (map_revision is None or revision == map_revision)
        and type(width) is int
        and type(height) is int
        and 0 < width <= 2048
        and 0 < height <= 2048
        and width * height <= MAX_IMAGE
        and isinstance(png, str)
        and 76 <= len(png) <= MAX_BASE64
        and len(png) % 4 == 0
    )


def _validated_png(row: Image, scope: EditorScope) -> Image | None:
    png = base64.b64decode(cast(str, row["pngBase64"]), validate=True)
    if len(png) > MAX_IMAGE or (plain := cacheable_png(png, MAX_IMAGE)) is None:
        return None
    width, height = struct.unpack_from(">II", plain, 16)
    channels = {2: 3, 6: 4}[plain[25]]
    if (width, height) != (row["width"], row["height"]) or (scope != "item" and channels != 4):
        return None
    row_size = 1 + width * channels
    expected = row_size * height
    # The shape/CRC check above admits only IHDR, consecutive IDAT chunks and IEND.
    decoder = zlib.decompressobj()
    output = bytearray()
    offset = 33
    while offset < len(plain) - 12:
        size = int.from_bytes(plain[offset : offset + 4], "big")
        output.extend(
            decoder.decompress(plain[offset + 8 : offset + 8 + size], expected + 1 - len(output))
        )
        if len(output) > expected or decoder.unused_data:
            return None
        offset += size + 12
    if not decoder.eof or len(output) != expected or any(value > 4 for value in output[::row_size]):
        return None
    return {**row, "pngBase64": base64.b64encode(plain).decode("ascii")}


def _parse_frame(frame: bytes | None) -> dict[str, Image | None]:
    try:
        rows = json.loads(frame) if frame is not None else {}
    except (ValueError, RecursionError):
        return {}
    if not isinstance(rows, dict) or len(rows) > 64:
        return {}
    return cast(dict[str, Image | None], rows)


def _measure_revision(cache: NativeArtworkCache, expected_root: Path | None) -> str | None:
    started = perf_counter()
    revision = entry_artwork_revision(expected_root)
    cache.source_validation_seconds += perf_counter() - started
    return revision


def cached_editor_images(
    scope: EditorScope,
    keys: tuple[str, ...],
    extract: Callable[[tuple[str, ...]], Mapping[str, Result]],
    *,
    map_revision: str | None = None,
    expected_root: Path | None = None,
) -> dict[str, Result]:
    """Call only after the adapter admits the requested names against current sources."""
    with native_artwork_cache(scope) as cache:
        revision = _measure_revision(cache, expected_root) if cache is not None else None
        if cache is None or revision is None:
            if cache is not None:
                cache.note("source_unavailable")
            return dict(extract(keys))
        key_field = _KEY_FIELDS[scope]
        identities = {key: sha256(key.encode()).hexdigest() for key in keys}
        rows = _parse_frame(cache.editor_frame(scope, revision))
        hits: dict[str, Image | None] = {}
        for key, identity in identities.items():
            row = rows.get(identity)
            if row is not None and _valid_payload(row, map_revision):
                hits[key] = {key_field: key, **row}
            elif row is None and identity in rows and scope != "map":
                hits[key] = None
        missing = tuple(key for key in keys if key not in hits)
        extracted = extract(missing) if missing else {}
        prepared: dict[str, Image | None] = {}
        for key in missing:
            image = extracted.get(key)
            if image is None and key in extracted and scope != "map":
                prepared[identities[key]] = None
            if not isinstance(image, dict) or image.get(key_field) != key:
                continue
            payload = {field: value for field, value in image.items() if field != key_field}
            if not _valid_payload(payload, map_revision):
                continue
            try:
                validated = _validated_png(payload, scope)
            except (ValueError, zlib.error):
                continue
            if validated is not None:
                prepared[identities[key]] = validated
        if (hits or prepared) and _measure_revision(cache, expected_root) != revision:
            cache.note("source_changed")
            return {}
        cache.note("editor_hit", sum(image is not None for image in hits.values()))
        cache.note("editor_unavailable_hit", sum(image is None for image in hits.values()))
        cache.note("editor_miss", len(missing))
        cache.note("editor_extracted", sum(isinstance(image, dict) for image in extracted.values()))
        if prepared:
            retained = {identities[key]: rows[identities[key]] for key in hits}
            cache.publish_editor_frame(
                scope,
                revision,
                json.dumps({**retained, **prepared}, separators=(",", ":")).encode("ascii"),
            )
        return {**hits, **extracted}
