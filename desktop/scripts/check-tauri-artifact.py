"""Inspect compiled host authority and the frozen entry point without executing them."""

import ctypes
import hashlib
import json
import os
import sys
from pathlib import Path

from PyInstaller.archive.readers import CArchiveReader


def host_authority(path: Path) -> bytes:
    if os.name != "nt":
        raise OSError("Tauri artifact verification requires Windows.")
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LoadLibraryExW.argtypes = [ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_ulong]
    kernel.LoadLibraryExW.restype = ctypes.c_void_p
    kernel.FindResourceW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_void_p]
    kernel.FindResourceW.restype = ctypes.c_void_p
    kernel.SizeofResource.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    kernel.SizeofResource.restype = ctypes.c_ulong
    kernel.LoadResource.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    kernel.LoadResource.restype = ctypes.c_void_p
    kernel.LockResource.argtypes = [ctypes.c_void_p]
    kernel.LockResource.restype = ctypes.c_void_p
    kernel.FreeLibrary.argtypes = [ctypes.c_void_p]
    kernel.FreeLibrary.restype = ctypes.c_int
    # Data-only mapping, with exclusive data-file sharing; no host code or DLL imports run.
    module = kernel.LoadLibraryExW(str(path.resolve()), None, 0x40 | 0x20)
    if not module:
        raise OSError("Unable to inspect the Tauri host.")
    try:
        resource = kernel.FindResourceW(module, "REPODITOR_AUTHORITY", ctypes.c_void_p(10))
        if not resource:
            raise ValueError("Missing Tauri authority resource; rebuild the host.")
        size = kernel.SizeofResource(module, resource)
        if not 0 < size <= 128:
            raise ValueError("Invalid Tauri authority resource.")
        data = kernel.LockResource(kernel.LoadResource(module, resource))
        if not data:
            raise OSError("Unable to read the Tauri authority resource.")
        return ctypes.string_at(data, size).rstrip(b"\0")
    finally:
        kernel.FreeLibrary(module)


def check_backend(path: Path) -> None:
    archive = CArchiveReader(str(path))
    scripts = {name for name, item in archive.toc.items() if item[-1] == "s"}
    expected = {
        "pyiboot01_bootstrap",
        "pyi_rth_inspect",
        "pyi_rth_pkgutil",
        "pyi_rth_multiprocessing",
        "pyi_rth_setuptools",
        "pyi_rth_cryptography_openssl",
        "__main__",
    }
    if scripts != expected:
        raise ValueError("Unexpected frozen startup scripts; synthetic backends cannot be staged.")


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


if __name__ == "__main__":
    host, backend = (Path(value) for value in sys.argv[1:])
    if host_authority(host) != b"repoditor-tauri-authority-v2:read-only":
        raise ValueError("Synthetic or development host authority cannot be staged for production.")
    check_backend(backend)
    sys.stdout.write(
        json.dumps(
            {"authority": "read-only", "hostSha256": digest(host), "backendSha256": digest(backend)}
        )
    )
