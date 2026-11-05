"""Local NTFS save operations relative to retained ordinary directory handles."""

from __future__ import annotations

import ctypes
import json
import os
import stat
import struct
from collections.abc import Iterator
from contextlib import contextmanager
from hashlib import sha256
from pathlib import Path
from types import TracebackType
from typing import BinaryIO, cast

from repo_save_editor.core.save_resources import hash_encrypted, read_encrypted

if os.name == "nt":
    import msvcrt


class UnicodeString(ctypes.Structure):
    _fields_ = [
        ("length", ctypes.c_ushort),
        ("maximum", ctypes.c_ushort),
        ("buffer", ctypes.c_void_p),
    ]


class Attributes(ctypes.Structure):
    _fields_ = [
        ("length", ctypes.c_ulong),
        ("root", ctypes.c_void_p),
        ("name", ctypes.POINTER(UnicodeString)),
        ("flags", ctypes.c_ulong),
        ("security", ctypes.c_void_p),
        ("quality", ctypes.c_void_p),
    ]


class StatusUnion(ctypes.Union):
    _fields_ = (("status", ctypes.c_long), ("pointer", ctypes.c_void_p))


class IoStatus(ctypes.Structure):
    _fields_ = [("result", StatusUnion), ("information", ctypes.c_size_t)]


class FileId(ctypes.Structure):
    _fields_ = [("volume", ctypes.c_ulonglong), ("identifier", ctypes.c_ubyte * 16)]


class Tag(ctypes.Structure):
    _fields_ = [("attributes", ctypes.c_ulong), ("tag", ctypes.c_ulong)]


class RenameInfo(ctypes.Structure):
    _fields_ = [
        ("replace", ctypes.c_ubyte),
        ("root", ctypes.c_void_p),
        ("length", ctypes.c_ulong),
        ("name", ctypes.c_wchar * 1),
    ]


class SaveNamespaceError(OSError):
    """An object does not belong to the admitted ordinary save namespace."""


class SaveDirectory:
    """Keep ordinary ancestry pinned and perform single-leaf operations relative to it."""

    def __init__(self, save: Path) -> None:
        if os.name != "nt":
            raise OSError("Windows save namespace is unavailable")
        if not save.is_absolute() or len(save.drive) != 2 or save.drive[1] != ":":
            raise OSError("Unsupported save namespace")
        self.path = save
        self.handles: list[int] = []
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.native = ctypes.WinDLL("ntdll")
        self.kernel.CreateFileW.argtypes = [
            ctypes.c_wchar_p,
            ctypes.c_ulong,
            ctypes.c_ulong,
            ctypes.c_void_p,
            ctypes.c_ulong,
            ctypes.c_ulong,
            ctypes.c_void_p,
        ]
        self.kernel.CreateFileW.restype = ctypes.c_void_p
        self.kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        self.kernel.FlushFileBuffers.argtypes = [ctypes.c_void_p]
        self.kernel.GetVolumeInformationByHandleW.argtypes = [
            ctypes.c_void_p,
            ctypes.c_wchar_p,
            ctypes.c_ulong,
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_wchar_p,
            ctypes.c_ulong,
        ]
        self.kernel.GetFileInformationByHandleEx.argtypes = [
            ctypes.c_void_p,
            ctypes.c_int,
            ctypes.c_void_p,
            ctypes.c_ulong,
        ]
        self.native.NtCreateFile.argtypes = [
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.c_ulong,
            ctypes.POINTER(Attributes),
            ctypes.POINTER(IoStatus),
            ctypes.c_void_p,
            ctypes.c_ulong,
            ctypes.c_ulong,
            ctypes.c_ulong,
            ctypes.c_ulong,
            ctypes.c_void_p,
            ctypes.c_ulong,
        ]
        self.native.NtCreateFile.restype = ctypes.c_long
        self.native.NtSetInformationFile.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(IoStatus),
            ctypes.c_void_p,
            ctypes.c_ulong,
            ctypes.c_int,
        ]
        self.native.NtSetInformationFile.restype = ctypes.c_long
        self.native.NtQueryVolumeInformationFile.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(IoStatus),
            ctypes.c_void_p,
            ctypes.c_ulong,
            ctypes.c_int,
        ]
        self.native.NtQueryVolumeInformationFile.restype = ctypes.c_long
        self.native.RtlNtStatusToDosError.argtypes = [ctypes.c_long]
        self.native.RtlNtStatusToDosError.restype = ctypes.c_ulong
        identities = []
        try:
            # Share writes for legitimate replacement, but deny ancestry deletion/renaming.
            handle = self.kernel.CreateFileW(save.anchor, 0xA1, 3, None, 3, 0x02200000, None)
            if handle == ctypes.c_void_p(-1).value:
                raise ctypes.WinError(ctypes.get_last_error())
            self.handles.append(handle)
            self._require_local_ntfs(handle)
            identities.append(self._directory_identity(handle))
            for name in save.parent.relative_to(save.anchor).parts:
                handle = self._open(handle, name, 0x1000A1, 1, 1 | 0x20 | 0x200000, 3)
                self.handles.append(handle)
                identities.append(self._directory_identity(handle))
            self.identity = sha256(
                json.dumps([str(save.parent).casefold(), identities]).encode()
            ).hexdigest()
        except BaseException:
            self.close()
            raise

    def __enter__(self) -> SaveDirectory:
        return self

    def __exit__(
        self,
        _kind: type[BaseException] | None,
        _error: BaseException | None,
        _traceback: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        failure = None
        while self.handles:
            if not self.kernel.CloseHandle(self.handles.pop()):
                failure = ctypes.WinError(ctypes.get_last_error())
        if failure is not None:
            raise failure

    def _check(self, status: int) -> None:
        if status < 0:
            raise ctypes.WinError(self.native.RtlNtStatusToDosError(status))

    def _require_local_ntfs(self, handle: int) -> None:
        device, status = (ctypes.c_ulong * 2)(), IoStatus()
        # FileFsDeviceInformation: actual disk device, without FILE_REMOTE_DEVICE.
        self._check(
            self.native.NtQueryVolumeInformationFile(
                handle, ctypes.byref(status), device, ctypes.sizeof(device), 4
            )
        )
        if status.information != ctypes.sizeof(device) or device[0] != 7 or device[1] & 0x10:
            raise SaveNamespaceError("Unsupported save device")
        filesystem = ctypes.create_unicode_buffer(32)
        if not self.kernel.GetVolumeInformationByHandleW(
            handle, None, 0, None, None, None, filesystem, len(filesystem)
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        if filesystem.value != "NTFS":
            raise SaveNamespaceError("Unsupported save filesystem")

    def _directory_identity(self, handle: int) -> tuple[int, str]:
        tag, identity = Tag(), FileId()
        if not self.kernel.GetFileInformationByHandleEx(
            handle, 9, ctypes.byref(tag), ctypes.sizeof(tag)
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        if not tag.attributes & 0x10 or tag.attributes & 0x400:
            raise SaveNamespaceError("Nonordinary save namespace")
        if not self.kernel.GetFileInformationByHandleEx(
            handle, 18, ctypes.byref(identity), ctypes.sizeof(identity)
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        return identity.volume, bytes(identity.identifier).hex()

    def _open(
        self, root: int, name: str, access: int, disposition: int, flags: int, share: int
    ) -> int:
        buffer = ctypes.create_unicode_buffer(name)
        length = len(name.encode("utf-16-le"))
        string = UnicodeString(length, length + 2, ctypes.cast(buffer, ctypes.c_void_p))
        attributes = Attributes(
            # OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE: fail closed on reparse traversal.
            ctypes.sizeof(Attributes),
            root,
            ctypes.pointer(string),
            0x1040,
            None,
            None,
        )
        handle, status = ctypes.c_void_p(), IoStatus()
        self._check(
            self.native.NtCreateFile(
                ctypes.byref(handle),
                access,
                ctypes.byref(attributes),
                ctypes.byref(status),
                None,
                0x80,
                share,
                disposition,
                flags,
                None,
                0,
            )
        )
        return cast(int, handle.value)

    def _leaf(self, path: Path) -> str:
        if (
            path.parent != self.path.parent
            or not path.name
            or any(c in path.name for c in "\\/:\0")
            or path.name in {".", ".."}
        ):
            raise SaveNamespaceError("Invalid save-owned leaf")
        return path.name

    @contextmanager
    def open(self, path: Path, mode: str = "rb", *, rename: bool = False) -> Iterator[BinaryIO]:
        access = 0x80000000 if mode == "rb" else 0xC0000000
        access |= 0x100000 | (0x40010000 if rename else 0)
        disposition = {"rb": 1, "xb": 2, "a+b": 3}[mode]
        # Retain the verified rename source without admitting new writers or deletion.
        share = 1 if rename else 7 if mode == "rb" else 3
        handle = self._open(
            self.handles[-1],
            self._leaf(path),
            access,
            disposition,
            0x200060 | (2 if mode != "rb" or rename else 0),
            share,
        )
        try:
            descriptor = msvcrt.open_osfhandle(
                handle, os.O_BINARY | (os.O_RDONLY if mode == "rb" else os.O_RDWR)
            )
        except BaseException:
            self.kernel.CloseHandle(handle)
            raise
        try:
            stream = cast(BinaryIO, os.fdopen(descriptor, mode))
        except BaseException:
            os.close(descriptor)
            raise
        with stream:
            info = os.fstat(stream.fileno())
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_nlink != 1
                or info.st_file_attributes & 0x400
            ):
                raise SaveNamespaceError("Nonordinary save-owned file")
            yield stream

    def read(self, path: Path) -> bytes:
        with self.open(path) as stream:
            return read_encrypted(stream)

    def regular(self, path: Path, *, missing: bool = False) -> None:
        try:
            with self.open(path):
                pass
        except FileNotFoundError:
            if not missing:
                raise

    def stat(self, path: Path) -> os.stat_result:
        with self.open(path) as stream:
            return os.fstat(stream.fileno())

    def exists(self, path: Path) -> bool:
        try:
            with self.open(path):
                return True
        except FileNotFoundError:
            return False

    @staticmethod
    def file_identity(stream: BinaryIO) -> list[int]:
        info = os.fstat(stream.fileno())
        return [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns]

    def snapshot(self, path: Path) -> tuple[str, list[int]]:
        with self.open(path) as stream:
            identity = self.file_identity(stream)
            digest = hash_encrypted(stream)
            if self.file_identity(stream) != identity:
                raise SaveNamespaceError("Save object changed during inspection")
            return digest, identity

    def replace(self, source: BinaryIO, target: Path) -> None:
        name = self._leaf(target)
        encoded = name.encode("utf-16-le")
        # The documented buffer includes sizeof(FILE_RENAME_INFORMATION) plus name bytes.
        buffer = ctypes.create_string_buffer(ctypes.sizeof(RenameInfo) + len(encoded))
        info = RenameInfo.from_buffer(buffer)
        info.replace, info.root, info.length = 1, self.handles[-1], len(encoded)
        ctypes.memmove(ctypes.addressof(buffer) + RenameInfo.name.offset, encoded, len(encoded))
        # Native FileRenameInformation (10), not Win32 FileRenameInfo (3).
        status = IoStatus()
        self._check(
            self.native.NtSetInformationFile(
                msvcrt.get_osfhandle(source.fileno()),
                ctypes.byref(status),
                buffer,
                ctypes.sizeof(buffer),
                10,
            )
        )
        if not self.kernel.FlushFileBuffers(msvcrt.get_osfhandle(source.fileno())):
            raise ctypes.WinError(ctypes.get_last_error())

    def remove(self, path: Path) -> None:
        with self.open(path, rename=True) as stream:
            deleted, status = ctypes.c_ubyte(1), IoStatus()
            self._check(
                self.native.NtSetInformationFile(
                    msvcrt.get_osfhandle(stream.fileno()),
                    ctypes.byref(status),
                    ctypes.byref(deleted),
                    ctypes.sizeof(deleted),
                    13,
                )
            )

    def names(self) -> Iterator[str]:
        kind = 15
        while True:
            buffer = ctypes.create_string_buffer(65536)
            if not self.kernel.GetFileInformationByHandleEx(
                self.handles[-1], kind, buffer, len(buffer)
            ):
                error = ctypes.get_last_error()
                if error == 18:
                    return
                raise ctypes.WinError(error)
            kind = 14
            offset = 0
            while True:
                following = struct.unpack_from("<L", buffer, offset)[0]
                length = struct.unpack_from("<L", buffer, offset + 60)[0]
                if length % 2 or length > len(buffer) - offset - 68:
                    raise OSError("Invalid directory enumeration")
                name = buffer.raw[offset + 68 : offset + 68 + length].decode("utf-16-le")
                if name not in {".", ".."}:
                    yield name
                if not following:
                    break
                if following < 68 or following > len(buffer) - offset - 68:
                    raise OSError("Invalid directory record boundary")
                offset += following
