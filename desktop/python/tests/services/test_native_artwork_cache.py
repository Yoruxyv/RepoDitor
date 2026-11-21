from __future__ import annotations

import os
import struct
import zlib
from pathlib import Path

import pytest

from repo_save_editor.services.native_artwork_cache import (
    PNG_LIMIT,
    PNG_SLOTS,
    cacheable_png,
    native_artwork_cache,
)
from repo_save_editor.services.texture_codec import encode_rgba_png

if os.name == "nt":
    import msvcrt

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Native artwork cache uses Windows DPAPI")


def test_cache_strips_png_text_and_rejects_corrupt_chunks() -> None:
    png = encode_rgba_png(bytes((1, 2, 3, 255)), 1, 1)
    text = b"tEXtTitle\x00discarded metadata"
    chunk = struct.pack(">I", len(text) - 4) + text + struct.pack(">I", zlib.crc32(text))
    decorated = png[:33] + chunk + png[33:]
    assert cacheable_png(decorated) == png
    damaged = bytearray(decorated)
    damaged[33 + 8] ^= 1
    assert cacheable_png(bytes(damaged)) is None


def test_publisher_lock_interruption_and_bounded_slots(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("REPODITOR_E2E", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    profile = tmp_path / "RepoDitorPreview"
    profile.mkdir()
    with native_artwork_cache() as cache:
        assert cache is not None
        cache.publish_catalog("old", b"catalog")
        unfinished = cache.root / "publish.tmp"
        unfinished.write_bytes(b"incomplete")
        with (cache.root / "publish.lock").open("r+b") as stream, native_artwork_cache() as other:
            assert other is not None
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            other.publish_catalog("new", b"new catalog")
            assert other.catalog("old") == b"catalog"
            assert other.catalog("new") is None
            assert unfinished.read_bytes() == b"incomplete"
        cache.publish_catalog("new", b"new catalog")
        assert not unfinished.exists()
        assert cache.catalog("old") is None
        assert cache.catalog("new") == b"new catalog"
        for identity in range(PNG_SLOTS + 1):
            cache.publish_png(str(identity), "source", bytes([identity]))
        assert len(list(cache.root.glob("png-*.bin"))) == PNG_SLOTS
        assert cache.open_png("0", "source") is None
        assert cache.open_png(str(PNG_SLOTS), "source") == bytes([PNG_SLOTS])
        assert cache.open_png(str(PNG_SLOTS), "updated") is None
        cache.publish_png(str(PNG_SLOTS), "source", b"x" * (PNG_LIMIT + 1))
        assert cache.open_png(str(PNG_SLOTS), "source") == bytes([PNG_SLOTS])
