"""Bounded, Windows-user-protected presentation cache for native Cosmetics."""

from __future__ import annotations

import ctypes
import os
import struct
import zlib
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from pathlib import Path
from typing import Final

from repo_save_editor.storage.windows_save_directory import SaveDirectory

if os.name == "nt":
    import msvcrt

CATALOG_LIMIT: Final = 256 * 1024
PNG_LIMIT: Final = 256 * 1024
PNG_SLOTS: Final = 32
SEAL_OVERHEAD: Final = 4096


def cacheable_png(source: bytes) -> bytes | None:
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
            if len(output) + end - offset > PNG_LIMIT:
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

    def _read(self, name: str, limit: int) -> bytes | None:
        try:
            with self.directory.open(self.root / name) as handle:
                if os.fstat(handle.fileno()).st_size > limit:
                    return None
                data = handle.read(limit + 1)
            return data if len(data) <= limit else None
        except OSError:
            return None

    def _write(self, name: str, data: bytes) -> None:
        # Only one publisher can own the fixed staging file, even across sidecars.
        try:
            with self.directory.open(self.root / "publish.lock", "a+b") as lock:
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                staged = self.root / "publish.tmp"
                with suppress(FileNotFoundError):
                    self.directory.remove(staged)
                with self.directory.open(staged, "xb", rename=True) as handle:
                    handle.write(data)
                    handle.flush()
                    self.directory.replace(handle, self.root / name)
        except OSError:
            pass  # Optional work, including lock contention or interrupted publication.

    def catalog(self, revision: str) -> bytes | None:
        frame = self._read("catalog.bin", CATALOG_LIMIT + SEAL_OVERHEAD)
        if frame is not None:
            with suppress(OSError, ValueError):
                return _protect(frame, f"catalog/{revision}", CATALOG_LIMIT, seal=False)
        return None

    def publish_catalog(self, revision: str, data: bytes) -> None:
        if len(data) <= CATALOG_LIMIT:
            with suppress(OSError, ValueError):
                sealed = _protect(
                    data, f"catalog/{revision}", CATALOG_LIMIT + SEAL_OVERHEAD, seal=True
                )
                self._write("catalog.bin", sealed)

    def png(self, slot: int) -> tuple[str, bytes] | None:
        frame = self._read(f"png-{slot:02d}.bin", PNG_LIMIT + SEAL_OVERHEAD + 4)
        if frame is not None and len(frame) > 4 and frame[:4].isdigit():
            identity = int(frame[:4])
            if identity % PNG_SLOTS == slot and identity < 2000:
                return str(identity), frame[4:]
        return None

    def open_png(self, identity: str, binding: str) -> bytes | None:
        entry = self.png(int(identity) % PNG_SLOTS)
        if entry is not None and entry[0] == identity:
            return self.unseal_png(identity, binding, entry[1])
        return None

    @staticmethod
    def unseal_png(identity: str, binding: str, frame: bytes) -> bytes | None:
        with suppress(OSError, ValueError):
            return _protect(frame, f"png/{identity}/{binding}", PNG_LIMIT, seal=False)
        return None

    def publish_png(self, identity: str, binding: str, data: bytes) -> None:
        if len(data) <= PNG_LIMIT:
            with suppress(OSError, ValueError):
                sealed = _protect(
                    data, f"png/{identity}/{binding}", PNG_LIMIT + SEAL_OVERHEAD, seal=True
                )
                self._write(
                    f"png-{int(identity) % PNG_SLOTS:02d}.bin",
                    identity.zfill(4).encode("ascii") + sealed,
                )


@contextmanager
def native_artwork_cache() -> Iterator[NativeArtworkCache | None]:
    local = os.environ.get("LOCALAPPDATA")
    if os.name == "nt" and local and Path(local).is_absolute():
        profile = (
            "RepoDitorPreview"
            if os.environ.get("REPODITOR_E2E") == "1"
            else ("io.github.yoruxyv.repoditor.preview")
        )
        root = Path(local) / profile / "artwork-v1"
        # The native window owns and creates the app profile before this sidecar runs.
        try:
            with SaveDirectory(root):
                root.mkdir(exist_ok=True)
            directory = SaveDirectory(root / "catalog.bin")
        except OSError:
            pass
        else:
            try:
                yield NativeArtworkCache(directory, root)
            finally:
                with suppress(OSError):
                    directory.close()
            return
    yield None
