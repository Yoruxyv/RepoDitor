"""Bounded, Windows-user-protected native presentation storage."""

from __future__ import annotations

import ctypes
import json
import os
import struct
import zlib
from collections import Counter
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager, suppress
from pathlib import Path
from time import perf_counter
from typing import Final, Literal, NotRequired, TypedDict

from repo_save_editor.services.artwork.cache_activity import cache_activity
from repo_save_editor.services.environment.windows_paths import resolve_windows_local_app_data
from repo_save_editor.storage.windows_save_directory import SaveDirectory

if os.name == "nt":
    import msvcrt

CATALOG_LIMIT: Final = 256 * 1024
PNG_LIMIT: Final = 256 * 1024
PNG_SLOTS: Final = 32
SEAL_OVERHEAD: Final = 4096
CACHE_VERSION: Final = 1
DIAGNOSTICS_FILE: Final = "diagnostics.json"
DIAGNOSTICS_LIMIT: Final = 24 * 1024
DIAGNOSTICS_RECORDS: Final = 48
PUBLISH_LOCK: Final = "publish.lock"
PUBLISH_TEMP: Final = "publish.tmp"
EditorScope = Literal["upgrade", "item", "map"]
EditorFrame = Literal["upgrade", "item", "map", "metadata", "cosmetic-metadata"]
EDITOR_CACHE_LIMITS: Final[dict[EditorFrame, int]] = {
    "upgrade": 4 * 1024 * 1024,
    "item": 8 * 1024 * 1024,
    "map": 8 * 1024 * 1024,
    "metadata": 256 * 1024,
    "cosmetic-metadata": CATALOG_LIMIT,
}
Operation = Literal[
    "initial_catalog",
    "catalog",
    "thumbnail",
    "upgrade",
    "item",
    "map",
    "metadata",
    "cosmetic-metadata",
]
EVENTS: Final = frozenset(
    {
        "entry_missing",
        "entry_inaccessible",
        "entry_malformed",
        "entry_oversized",
        "entry_protection_rejected",
        "catalog_metadata_invalid",
        "catalog_hit",
        "catalog_scan",
        "thumbnail_hit",
        "thumbnail_slot_reused",
        "thumbnail_read",
        "source_changed",
        "source_unavailable",
        "publication_busy",
        "publication_failed",
        "published",
        "editor_hit",
        "editor_unavailable_hit",
        "editor_miss",
        "editor_extracted",
    }
)


class Observation(TypedDict):
    operation: Operation
    durationMs: int
    events: dict[str, int]
    sourceValidationMs: NotRequired[int]


def png_identity(header: bytes, slot: int) -> str | None:
    if len(header) == 4 and header.isdigit():
        identity = int(header)
        if identity % PNG_SLOTS == slot and identity < 2000:
            return str(identity)
    return None


def cacheable_png(source: bytes, limit: int = PNG_LIMIT) -> bytes | None:
    """Keep the bounded truecolor PNG stream without persisting ancillary metadata."""
    signature = b"\x89PNG\r\n\x1a\n"
    if len(source) < 57 or not source.startswith(signature + b"\0\0\0\rIHDR"):
        return None
    width, height = struct.unpack_from(">II", source, 16)
    if (
        not 0 < width <= 2048
        or not 0 < height <= 2048
        or width * height > 1024 * 1024
        or source[24:29] not in (b"\x08\x02\0\0\0", b"\x08\x06\0\0\0")
    ):
        return None
    data = memoryview(source)
    output = bytearray(signature)
    offset = len(signature)
    idat = False
    after_idat = False
    for _ in range(4096):
        if len(data) - offset < 12:
            return None
        size, kind = struct.unpack_from(">I4s", data, offset)
        end = offset + size + 12
        if (
            end > len(data)
            or zlib.crc32(data[offset + 4 : end - 4]) != struct.unpack_from(">I", data, end - 4)[0]
        ):
            return None
        if (kind == b"IHDR" and offset != len(signature)) or (kind == b"IDAT" and after_idat):
            return None
        if kind in (b"IHDR", b"IDAT", b"IEND"):
            if len(output) + end - offset > limit:
                return None
            output.extend(data[offset:end])
        elif kind in (b"acTL", b"fcTL", b"fdAT") or (not kind[0] & 0x20 and kind != b"PLTE"):
            return None
        if kind == b"IEND":
            return bytes(output) if size == 0 and end == len(data) and idat else None
        after_idat = after_idat or (idat and kind != b"IDAT")
        idat = idat or kind == b"IDAT"
        offset = end
    return None


class _Blob(ctypes.Structure):
    _fields_ = [("size", ctypes.c_ulong), ("data", ctypes.c_void_p)]


def _protect(data: bytes, key: str, limit: int, *, seal: bool) -> bytes:
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    change = crypt.CryptProtectData if seal else crypt.CryptUnprotectData
    pointer = ctypes.POINTER(_Blob)
    change.argtypes = [
        pointer,
        ctypes.c_void_p,
        pointer,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_ulong,
        pointer,
    ]
    change.restype = ctypes.c_int
    incoming = ctypes.create_string_buffer(data)
    context = ctypes.create_string_buffer(f"RepoDitor/native-artwork-v1/{key}".encode())
    blob = _Blob(len(data), ctypes.addressof(incoming))
    entropy = _Blob(len(context) - 1, ctypes.addressof(context))
    result = _Blob()
    if not change(
        ctypes.byref(blob), None, ctypes.byref(entropy), None, None, 1, ctypes.byref(result)
    ):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        if result.size > limit:
            raise ValueError("Oversized native artwork cache entry")
        return ctypes.string_at(result.data, result.size)
    finally:
        free = ctypes.WinDLL("kernel32").LocalFree
        free.argtypes = [ctypes.c_void_p]
        free.restype = ctypes.c_void_p
        free(result.data)


class NativeArtworkCache:
    def __init__(self, directory: SaveDirectory, root: Path) -> None:
        self.directory = directory
        self.root = root
        self.events: Counter[str] | None = None
        self.source_validation_seconds = 0.0

    def note(self, event: str, count: int = 1) -> None:
        if self.events is not None and count > 0 and event in EVENTS:
            self.events[event] += count

    def _read(self, name: str, limit: int, *, observe: bool = True) -> bytes | None:
        try:
            with self.directory.open(self.root / name) as handle:
                data = (
                    handle.read(limit + 1) if os.fstat(handle.fileno()).st_size <= limit else None
                )
            if data is not None and 0 < len(data) <= limit:
                return data
            if observe:
                self.note("entry_malformed" if data == b"" else "entry_oversized")
        except FileNotFoundError:
            if observe:
                self.note("entry_missing")
        except OSError:
            if observe:
                self.note("entry_inaccessible")
        return None

    @contextmanager
    def publication(self, *, create: bool) -> Iterator[None]:
        with self.directory.open(self.root / PUBLISH_LOCK, "a+b" if create else "rb") as lock:
            lock.seek(0)
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise BlockingIOError("Cache publication lock is unavailable.") from error
            yield

    def _replace(self, name: str, data: bytes) -> None:
        staged = self.root / PUBLISH_TEMP
        with suppress(FileNotFoundError):
            self.directory.remove(staged)
        with self.directory.open(staged, "xb", rename=True) as handle:
            handle.write(data)
            handle.flush()
            self.directory.replace(handle, self.root / name)

    def _write(self, name: str, data: bytes) -> None:
        try:
            with self.publication(create=True):
                self._replace(name, data)
        except BlockingIOError:
            self.note("publication_busy")
        except OSError:
            self.note("publication_failed")
        else:
            self.note("published")

    def catalog(self, revision: str) -> bytes | None:
        frame = self._read("catalog.bin", CATALOG_LIMIT + SEAL_OVERHEAD)
        if frame is not None:
            try:
                return _protect(frame, f"catalog/{revision}", CATALOG_LIMIT, seal=False)
            except (OSError, ValueError):
                self.note("entry_protection_rejected")
        return None

    def publish_catalog(self, revision: str, data: bytes) -> None:
        if len(data) <= CATALOG_LIMIT:
            try:
                sealed = _protect(
                    data, f"catalog/{revision}", CATALOG_LIMIT + SEAL_OVERHEAD, seal=True
                )
                self._write("catalog.bin", sealed)
            except (OSError, ValueError):
                self.note("publication_failed")

    def png(self, slot: int) -> tuple[str, bytes] | None:
        frame = self._read(f"png-{slot:02d}.bin", PNG_LIMIT + SEAL_OVERHEAD + 4)
        if frame is not None:
            identity = png_identity(frame[:4], slot)
            if identity is not None and len(frame) > 4:
                return identity, frame[4:]
            self.note("entry_malformed")
        return None

    def open_png(self, identity: str, binding: str) -> bytes | None:
        entry = self.png(int(identity) % PNG_SLOTS)
        if entry is not None and entry[0] == identity:
            return self.unseal_png(identity, binding, entry[1])
        if entry is not None:
            self.note("thumbnail_slot_reused")
        return None

    def unseal_png(self, identity: str, binding: str, frame: bytes) -> bytes | None:
        try:
            return _protect(frame, f"png/{identity}/{binding}", PNG_LIMIT, seal=False)
        except (OSError, ValueError):
            self.note("entry_protection_rejected")
            return None

    def publish_png(self, identity: str, binding: str, data: bytes) -> None:
        if len(data) <= PNG_LIMIT:
            try:
                sealed = _protect(
                    data, f"png/{identity}/{binding}", PNG_LIMIT + SEAL_OVERHEAD, seal=True
                )
                self._write(
                    f"png-{int(identity) % PNG_SLOTS:02d}.bin",
                    identity.zfill(4).encode("ascii") + sealed,
                )
            except (OSError, ValueError):
                self.note("publication_failed")

    def editor_frame(self, scope: EditorFrame, revision: str) -> bytes | None:
        limit = EDITOR_CACHE_LIMITS[scope]
        frame = self._read(f"{scope}.bin", limit + SEAL_OVERHEAD)
        if frame is not None:
            try:
                return _protect(frame, f"editor/{scope}/{revision}", limit, seal=False)
            except (OSError, ValueError):
                self.note("entry_protection_rejected")
        return None

    def publish_editor_frame(self, scope: EditorFrame, revision: str, data: bytes) -> None:
        limit = EDITOR_CACHE_LIMITS[scope]
        if len(data) <= limit:
            try:
                sealed = _protect(
                    data, f"editor/{scope}/{revision}", limit + SEAL_OVERHEAD, seal=True
                )
                self._write(f"{scope}.bin", sealed)
            except (OSError, ValueError):
                self.note("publication_failed")
        else:
            self.note("entry_oversized")

    def observations(self) -> list[Observation]:
        frame = self._read(DIAGNOSTICS_FILE, DIAGNOSTICS_LIMIT, observe=False)
        try:
            rows = json.loads(frame) if frame is not None else []
        except (ValueError, RecursionError):
            return []
        if not isinstance(rows, list) or len(rows) > DIAGNOSTICS_RECORDS:
            return []
        return [record for row in rows if (record := _observation(row)) is not None]

    def record(self, operation: Operation, started: float) -> None:
        if self.events is None:
            return
        observation: Observation = {
            "operation": operation,
            "durationMs": min(120_000, round((perf_counter() - started) * 1_000)),
            "events": dict(self.events),
        }
        if operation in EDITOR_CACHE_LIMITS:
            observation["sourceValidationMs"] = min(
                120_000, round(1_000 * self.source_validation_seconds)
            )
        with suppress(OSError), self.publication(create=True):
            rows = [*self.observations(), observation][-DIAGNOSTICS_RECORDS:]
            data = json.dumps(rows, separators=(",", ":")).encode("ascii")
            if len(data) <= DIAGNOSTICS_LIMIT:
                self._replace(DIAGNOSTICS_FILE, data)


def _observation(row: object) -> Observation | None:
    if not isinstance(row, dict):
        return None
    operation, duration, events = row.get("operation"), row.get("durationMs"), row.get("events")
    if (
        operation not in ("initial_catalog", "catalog", "thumbnail", *EDITOR_CACHE_LIMITS)
        or type(duration) is not int
        or not 0 <= duration <= 120_000
        or not isinstance(events, dict)
        or any(
            key not in EVENTS or type(value) is not int or not 1 <= value <= 2000
            for key, value in events.items()
        )
    ):
        return None
    result: Observation = {"operation": operation, "durationMs": duration, "events": dict(events)}
    if "sourceValidationMs" in row:
        validation = row["sourceValidationMs"]
        if type(validation) is not int or not 0 <= validation <= 120_000:
            return None
        result["sourceValidationMs"] = validation
    return result


def artwork_cache_root(*, editor: bool = False, isolated: bool = False) -> Path | None:
    if os.name != "nt":
        return None
    local: Path | None
    if isolated or os.environ.get("REPODITOR_E2E") == "1":
        local = Path(os.environ.get("LOCALAPPDATA", ""))
        profile = "RepoDitorPreview"
    else:
        local = resolve_windows_local_app_data()
        profile = "io.github.yoruxyv.repoditor.preview"
    if local is not None and local.is_absolute() and ".." not in local.parts:
        namespace = "editor-artwork" if editor else "artwork"
        return local / profile / f"{namespace}-v{CACHE_VERSION}"
    return None


def _close_cache(directory: SaveDirectory) -> None:
    with suppress(OSError):
        directory.close()


@contextmanager
def native_artwork_cache(
    operation: Operation | None = None, *, isolated: bool = False
) -> Iterator[NativeArtworkCache | None]:
    root = artwork_cache_root(editor=operation in EDITOR_CACHE_LIMITS, isolated=isolated)
    with ExitStack() as lifetime:
        cache = None
        # The native window owns and creates the app profile before this sidecar runs.
        try:
            if root is not None:
                lifetime.enter_context(cache_activity())
                with SaveDirectory(root):
                    root.mkdir(exist_ok=True)
                directory = SaveDirectory(root / "catalog.bin")
                lifetime.callback(_close_cache, directory)
                cache = NativeArtworkCache(directory, root)
        except OSError:
            pass
        if cache is not None and operation and os.environ.get("REPODITOR_CACHE_DIAGNOSTICS") == "1":
            cache.events = Counter()
        started = perf_counter()
        try:
            yield cache
        finally:
            if cache is not None and operation:
                cache.record(operation, started)
