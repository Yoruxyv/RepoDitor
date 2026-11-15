"""Repository-only Windows CLI for the native Cosmetics cache."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from itertools import islice
from pathlib import Path
from typing import Any

from repo_save_editor.services.cache_activity import CacheBusyError, offline_cache
from repo_save_editor.services.game.processes import (
    ProcessInspectionError,
    inspect_windows_processes,
)
from repo_save_editor.services.native_artwork_cache import (
    CACHE_VERSION,
    CATALOG_LIMIT,
    DIAGNOSTICS_FILE,
    DIAGNOSTICS_LIMIT,
    PNG_LIMIT,
    PNG_SLOTS,
    PUBLISH_LOCK,
    PUBLISH_TEMP,
    SEAL_OVERHEAD,
    NativeArtworkCache,
    artwork_cache_root,
    png_identity,
)
from repo_save_editor.storage.windows_save_directory import SaveDirectory

THUMBNAILS = {f"png-{slot:02d}.bin": slot for slot in range(PNG_SLOTS)}
ENTRIES = {
    "catalog.bin": ("catalog", 1, CATALOG_LIMIT + SEAL_OVERHEAD),
    **dict.fromkeys(THUMBNAILS, ("thumbnail", 5, PNG_LIMIT + SEAL_OVERHEAD + 4)),
    DIAGNOSTICS_FILE: ("diagnostics", 1, DIAGNOSTICS_LIMIT),
    PUBLISH_TEMP: ("publication", 0, max(CATALOG_LIMIT, PNG_LIMIT + 4) + SEAL_OVERHEAD),
    PUBLISH_LOCK: ("publication", 0, 0),
}
MAX_BYTES = sum(maximum for _, _, maximum in ENTRIES.values())


@contextmanager
def _existing(root: Path) -> Iterator[NativeArtworkCache | None]:
    try:
        directory = SaveDirectory(root / "catalog.bin")
    except FileNotFoundError:
        yield None
    else:
        with directory:
            yield NativeArtworkCache(directory, root)


def _activity() -> str:
    try:
        with offline_cache():
            return "idle"
    except CacheBusyError:
        return "busy"
    except OSError:
        return "unknown"


def _publication(cache: NativeArtworkCache) -> str:
    try:
        with cache.publication(create=False):
            return "idle"
    except FileNotFoundError:
        return "missing"
    except BlockingIOError:
        return "busy_or_inaccessible"
    except OSError:
        return "unsafe_or_inaccessible"


def _entry(cache: NativeArtworkCache, name: str, minimum: int, maximum: int) -> tuple[str, int]:
    try:
        with cache.directory.open(cache.root / name) as stream:
            size = os.fstat(stream.fileno()).st_size
            state = "present_unverified"
            if not minimum <= size <= maximum or (
                name in THUMBNAILS and png_identity(stream.read(4), THUMBNAILS[name]) is None
            ):
                state = "malformed"
            return state, size
    except FileNotFoundError:
        return "missing", 0
    except OSError:
        return "unsafe_or_inaccessible", 0


def _names(cache: NativeArtworkCache) -> set[str]:
    return set(islice(cache.directory.names(), 4097))


def _inventory(cache: NativeArtworkCache | None) -> dict[str, Any]:
    states = ("present_unverified", "missing", "malformed", "unsafe_or_inaccessible")
    counts = {category: dict.fromkeys(states, 0) for category, _, _ in ENTRIES.values()}
    total = 0
    for name, (category, minimum, maximum) in ENTRIES.items():
        state, size = _entry(cache, name, minimum, maximum) if cache else ("missing", 0)
        counts[category][state] += 1
        total += size
    names = _names(cache) if cache else set()
    return {
        "exists": cache is not None,
        "schemaVersion": CACHE_VERSION,
        "recognizedFileBytes": total,
        "maxPublishedBytes": MAX_BYTES,
        "entries": counts,
        "otherEntries": sum(name not in ENTRIES for name in names),
        "inventoryTruncated": len(names) > 4096,
        "activity": _activity(),
        "publicationLock": _publication(cache) if cache else "missing",
        "sourceValidation": "not_performed",
    }


def inspect_cache(root: Path, *, diagnostics: bool) -> dict[str, Any]:
    with _existing(root) as cache:
        inventory = _inventory(cache)
        if not diagnostics:
            return {"directory": str(root), **inventory}
        records = cache.observations() if cache else []
        totals: dict[str, int] = {}
        for record in records:
            for event, count in record["events"].items():
                totals[event] = totals.get(event, 0) + count
        return {
            **inventory,
            "liveCounters": "unavailable",
            "persistedObservations": "recorded" if records else "unavailable",
            "retainedEventTotals": totals,
            "records": records,
        }


def _require_closed() -> None:
    # Older builds do not participate in the gate. Fail closed on their usual image names.
    for image in ("repoditor-preview.exe", "repoditor-backend.exe", "RepoDitor.exe"):
        inspection = inspect_windows_processes(Path(image))
        if inspection.executable_paths or inspection.has_unverifiable_candidate:
            raise CacheBusyError("Close RepoDitor and its background processes before clearing.")


def clear_cache(root: Path, removed: list[str]) -> None:
    with offline_cache():
        _require_closed()
        with _existing(root) as cache:
            if cache is None:
                return
            present = _names(cache)
            if len(present) > 4096 or any(
                name not in ENTRIES and name.lower() in ENTRIES for name in present
            ):
                raise OSError("Cache names could not be safely identified.")
            with cache.publication(create=True):
                names = [
                    name
                    for name in ENTRIES
                    if name != PUBLISH_LOCK
                    and name in present
                    and cache.directory.exists(root / name)
                ]
                for name in names:
                    cache.directory.remove(root / name)
                    removed.append(name)
                if any(cache.directory.exists(root / name) for name in names):
                    raise OSError("Cache entries could not be verified as removed.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("status")
    commands.add_parser("diagnostics")
    commands.add_parser("clear", allow_abbrev=False).add_argument("--yes", action="store_true")
    args = parser.parse_args()
    root = artwork_cache_root()
    if root is None:
        parser.error("The Windows artwork cache directory is unavailable.")
    if os.environ.get("REPODITOR_E2E") == "1":
        build = Path(__file__).resolve().parents[2] / "build"
        if not root.is_relative_to(build) or root.parts[-4:-2] != ("AppData", "Local"):
            parser.error("The isolated test profile must be under desktop/build.")
    if args.command == "clear" and not args.yes:
        sys.stderr.write(f"Clear artwork entries under {root}? Type CLEAR to continue: ")
        if not sys.stdin.isatty() or sys.stdin.readline().strip() != "CLEAR":
            sys.stderr.write(
                "Cache clear canceled. Use --yes for intentional noninteractive use.\n"
            )
            return 1
    removed: list[str] = []
    try:
        if args.command == "clear":
            clear_cache(root, removed)
            result = {"result": "cleared", "count": len(removed), "removed": removed}
        else:
            result = inspect_cache(root, diagnostics=args.command == "diagnostics")
    except KeyboardInterrupt:
        sys.stderr.write(json.dumps({"result": "interrupted", "removed": removed}) + "\n")
        return 130
    except (OSError, ProcessInspectionError, UnicodeError) as error:
        reason = (
            str(error)
            if isinstance(error, CacheBusyError)
            else ("Exclusive access or an ordinary cache namespace could not be verified.")
        )
        blocked: dict[str, object] = {"result": "blocked", "reason": reason, "removed": removed}
        if isinstance(error, OSError) and getattr(error, "winerror", None):
            blocked["windowsError"] = error.winerror
        sys.stderr.write(json.dumps(blocked) + "\n")
        return 1
    sys.stdout.write(json.dumps(result, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
