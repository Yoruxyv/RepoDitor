from __future__ import annotations

import base64
import os
from pathlib import Path

import pytest

from desktop.scripts.tauri import artwork_cache as cli
from repo_save_editor.services.artwork import editor_artwork_cache
from repo_save_editor.services.artwork.cache_activity import CacheBusyError, cache_activity
from repo_save_editor.services.artwork.native_artwork_cache import (
    artwork_cache_root,
    native_artwork_cache,
)
from repo_save_editor.services.texture_codec import encode_rgba_png
from repo_save_editor.storage.windows_save_directory import SaveDirectory

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows DPAPI and cache namespace")


@pytest.fixture
def profile(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("REPODITOR_E2E", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setenv("REPODITOR_CACHE_DIAGNOSTICS", "1")
    monkeypatch.setattr(cli, "_require_closed", lambda: None)
    (tmp_path / "RepoDitorPreview").mkdir()
    return tmp_path


def test_editor_images_rebind_after_restart_and_retry_unproven_absence(profile, monkeypatch):
    source = profile / "fixture.asset"
    source.write_bytes(b"initial")
    monkeypatch.setattr(
        editor_artwork_cache, "entry_artwork_revision", lambda _: source.read_text()
    )
    calls = []

    def extract(keys):
        calls.append(keys)
        pixel = b"\0\0\xff\xff" if source.read_bytes() == b"initial" else b"\xff\0\0\xff"
        png = base64.b64encode(encode_rgba_png(pixel, 1, 1)).decode()
        results = {}
        if "ready" in keys:
            results["ready"] = {
                "itemName": "ready",
                "sourceIdentity": "a" * 64,
                "width": 1,
                "height": 1,
                "pngBase64": png,
            }
        if "known absent" in keys:
            results["known absent"] = None
        return results

    keys = ("ready", "known absent", "transient")
    cold = editor_artwork_cache.cached_editor_images("item", keys, extract)
    assert len(cold) == 2
    assert editor_artwork_cache.cached_editor_images("item", keys, extract) == cold
    assert calls == [keys, ("transient",)]
    source.write_bytes(b"changed")
    rebuilt = editor_artwork_cache.cached_editor_images("item", keys, extract)
    assert calls[-1] == keys
    assert rebuilt["ready"]["pngBase64"] != cold["ready"]["pngBase64"]

    root = artwork_cache_root(editor=True)
    assert root is not None
    entry = root / "item.bin"
    entry.write_bytes(b"corrupt")
    assert editor_artwork_cache.cached_editor_images("item", keys, extract) == rebuilt
    with native_artwork_cache("item") as cache:
        assert cache is not None
        cache.publish_editor_frame("item", "changed", b'{"malformed": NaN}')
    assert editor_artwork_cache.cached_editor_images("item", keys, extract) == rebuilt
    entry.unlink()
    assert editor_artwork_cache.cached_editor_images("item", keys, extract) == rebuilt

    info = cli.inspect_cache(root, diagnostics=True, editor=True)
    assert info["retainedEventTotals"]["editor_hit"] == 1
    assert info["retainedEventTotals"]["editor_unavailable_hit"] == 1
    assert info["entries"]["item"]["present_unverified"] == 1
    assert info["recognizedFileBytes"] <= info["maxPublishedBytes"]
    assert "directory" not in info


@pytest.mark.usefixtures("profile")
def test_editor_cache_source_change_during_read_discards_hits(monkeypatch):
    revision = "first"
    monkeypatch.setattr(editor_artwork_cache, "entry_artwork_revision", lambda _: revision)
    keys = ("absent",)
    assert editor_artwork_cache.cached_editor_images("upgrade", keys, dict.fromkeys) == {
        "absent": None
    }
    checks = iter(("first", "changed"))
    monkeypatch.setattr(editor_artwork_cache, "entry_artwork_revision", lambda _: next(checks))
    assert editor_artwork_cache.cached_editor_images("upgrade", keys, lambda _: {}) == {}


@pytest.mark.usefixtures("profile")
def test_offline_clear_coordinates_both_namespaces_and_preserves_unknown_files():
    cosmetics = artwork_cache_root()
    editor = artwork_cache_root(editor=True)
    assert cosmetics is not None
    assert editor is not None
    with native_artwork_cache() as cache:
        assert cache is not None
        cache.publish_catalog("key", b"catalog")
    with native_artwork_cache("map") as cache:
        assert cache is not None
        cache.publish_editor_frame("map", "key", b"{}")
    (editor / "other.bin").write_bytes(b"keep")
    with cache_activity(), pytest.raises(CacheBusyError, match="Close RepoDitor"):
        cli.clear_cache(cosmetics, [], editor)
    assert (editor / "map.bin").is_file()
    removed = []
    cli.clear_cache(cosmetics, removed, editor)
    assert {"catalog.bin", "editor-artwork-v1/map.bin"}.issubset(removed)
    assert (editor / "other.bin").read_bytes() == b"keep"
    assert not (editor / "map.bin").exists()


@pytest.mark.usefixtures("profile")
def test_interrupted_editor_publication_preserves_previous_frame(monkeypatch):
    with native_artwork_cache("map") as cache:
        assert cache is not None
        cache.publish_editor_frame("map", "revision", b"old validated frame")

        def interrupted(*_args, **_kwargs):
            raise OSError("interrupted before atomic replacement")

        with monkeypatch.context() as changes:
            changes.setattr(SaveDirectory, "replace", interrupted)
            cache.publish_editor_frame("map", "revision", b"uncommitted frame")
        assert cache.editor_frame("map", "revision") == b"old validated frame"
        cache.publish_editor_frame("map", "revision", b"new validated frame")
        assert cache.editor_frame("map", "revision") == b"new validated frame"
