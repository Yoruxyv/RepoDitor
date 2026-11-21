from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from desktop.scripts.tauri import artwork_cache as cli
from repo_save_editor.services.cache_activity import CacheBusyError, cache_activity, offline_cache
from repo_save_editor.services.native_artwork_cache import (
    DIAGNOSTICS_FILE,
    DIAGNOSTICS_RECORDS,
    PNG_SLOTS,
    artwork_cache_root,
    native_artwork_cache,
)
from repo_save_editor.storage.windows_save_directory import SaveDirectory

if os.name == "nt":
    import _winapi

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows cache namespace and locks")


@pytest.fixture
def root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("REPODITOR_E2E", "1")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.delenv("REPODITOR_CACHE_DIAGNOSTICS", raising=False)
    monkeypatch.setattr(cli, "_require_closed", lambda: None)
    (tmp_path / "RepoDitorPreview").mkdir()
    resolved = artwork_cache_root()
    assert resolved is not None
    return resolved


def test_inventory_empty_then_populated_and_clear_rebuild_preserving_other_files(
    root: Path,
) -> None:
    before = cli.inspect_cache(root, diagnostics=False)
    assert before["directory"] == str(root)
    assert not before["exists"]
    assert before["entries"]["thumbnail"]["missing"] == PNG_SLOTS
    assert not root.exists()
    cli.clear_cache(root, [])
    assert not root.exists()

    with native_artwork_cache() as cache:
        assert cache is not None
        cache.publish_catalog("revision", b"catalog")
        for slot in range(PNG_SLOTS):
            cache.publish_png(str(slot), "revision", b"image")
    (root / "png-01.bin").write_bytes(b"wrong-header")
    (root / "unrelated.dat").write_bytes(b"preserve")
    (root.parent / "settings").write_bytes(b"untouched")
    before = cli.inspect_cache(root, diagnostics=False)
    assert before["entries"]["catalog"]["present_unverified"] == 1
    assert before["entries"]["thumbnail"]["malformed"] == 1
    assert before["otherEntries"] == 1
    assert 0 < before["recognizedFileBytes"] <= before["maxPublishedBytes"]
    assert before["sourceValidation"] == "not_performed"
    assert before["publicationLock"] == "idle"

    removed: list[str] = []
    cli.clear_cache(root, removed)
    assert len(removed) == PNG_SLOTS + 1
    assert (root / "unrelated.dat").read_bytes() == b"preserve"
    assert (root.parent / "settings").read_bytes() == b"untouched"
    repeated: list[str] = []
    cli.clear_cache(root, repeated)
    assert repeated == []
    with native_artwork_cache() as cache:
        assert cache is not None
        assert cache.catalog("revision") is None
        cache.publish_catalog("revision", b"rebuilt")
        assert cache.catalog("revision") == b"rebuilt"


def test_activity_lifetime_and_publication_contention_block_clear(root: Path) -> None:
    with cache_activity(), native_artwork_cache() as cache:
        assert cache is not None
        cache.publish_catalog("revision", b"catalog")
        with pytest.raises(CacheBusyError, match="Close RepoDitor"):
            cli.clear_cache(root, [])
        snapshot = cli.inspect_cache(root, diagnostics=False)
        assert snapshot["activity"] == "busy"
        assert cache.catalog("revision") == b"catalog"
    with SaveDirectory(root / "catalog.bin") as directory:
        cache = cli.NativeArtworkCache(directory, root)
        with cache.publication(create=True):
            snapshot = cli.inspect_cache(root, diagnostics=False)
            assert snapshot["publicationLock"] == "busy_or_inaccessible"
            with pytest.raises(BlockingIOError, match="publication lock"):
                cli.clear_cache(root, [])
        assert cache.catalog("revision") == b"catalog"
    with offline_cache(), ThreadPoolExecutor(max_workers=1) as pool:
        assert pool.submit(cli._activity).result(timeout=5) == "busy"


@pytest.mark.parametrize("kind", ["junction", "symlink", "hardlink"])
def test_clear_rejects_reparse_points_and_hardlinks(root: Path, kind: str) -> None:
    outside = root.parent / "other"
    outside.mkdir()
    sentinel = outside / "catalog.bin"
    sentinel.write_bytes(b"outside")
    if kind == "junction":
        _winapi.CreateJunction(str(outside), str(root))
    else:
        root.mkdir()
        thumbnail = root / "png-00.bin"
        if kind == "symlink":
            try:
                thumbnail.symlink_to(sentinel)
            except OSError as error:
                if error.winerror != 1314:
                    raise
                pytest.skip("Windows symlink creation privilege is unavailable")
        else:
            thumbnail.hardlink_to(sentinel)
        (root / "catalog.bin").write_bytes(b"safe")
    with pytest.raises(OSError, match=r"WinError|Nonordinary"):
        cli.clear_cache(root, [])
    assert sentinel.read_bytes() == b"outside"
    if kind != "junction":
        assert (root / "catalog.bin").read_bytes() == b"safe"


def test_interruption_reports_partial_clear_and_can_retry(
    root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with native_artwork_cache() as cache:
        assert cache is not None
        cache.publish_catalog("revision", b"catalog")
        cache.publish_png("0", "revision", b"image")
    real_remove = SaveDirectory.remove

    def interrupt(directory: SaveDirectory, path: Path) -> None:
        if path.name == "png-00.bin":
            raise OSError("interrupted")
        real_remove(directory, path)

    removed: list[str] = []
    with monkeypatch.context() as changes:
        changes.setattr(SaveDirectory, "remove", interrupt)
        with pytest.raises(OSError, match="interrupted"):
            cli.clear_cache(root, removed)
    assert removed == ["catalog.bin"]
    assert (root / "png-00.bin").is_file()
    cli.clear_cache(root, removed)
    assert removed == ["catalog.bin", "png-00.bin"]


def test_diagnostics_are_opt_in_bounded_and_sanitized(
    root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with native_artwork_cache("catalog") as cache:
        assert cache is not None
        cache.note("catalog_scan")
    assert not (root / DIAGNOSTICS_FILE).exists()
    assert cli.inspect_cache(root, diagnostics=True)["persistedObservations"] == "unavailable"

    monkeypatch.setenv("REPODITOR_CACHE_DIAGNOSTICS", "1")
    path = root / DIAGNOSTICS_FILE
    path.write_text(json.dumps([{"operation": "private path", "durationMs": 1, "events": {}}]))
    for _ in range(DIAGNOSTICS_RECORDS + 1):
        with native_artwork_cache("catalog") as cache:
            assert cache is not None
            assert cache.catalog("absent") is None
            cache.note("catalog_scan")
            cache.note("arbitrary sensitive text")
    result = cli.inspect_cache(root, diagnostics=True)
    assert "directory" not in result
    assert len(result["records"]) == DIAGNOSTICS_RECORDS
    assert result["retainedEventTotals"] == {
        "catalog_scan": DIAGNOSTICS_RECORDS,
        "entry_missing": DIAGNOSTICS_RECORDS,
    }
    assert result["persistedObservations"] == "recorded"
