"""Windows lifetime coordination shared by the Tauri host, sidecar and offline CLI."""

from __future__ import annotations

import ctypes
import os
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from functools import lru_cache


class CacheBusyError(OSError):
    """An active user or another offline operation owns the cache."""


@lru_cache(maxsize=1)
def _kernel() -> ctypes.WinDLL:
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p]
    kernel.CreateMutexW.restype = ctypes.c_void_p
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    kernel.WaitForSingleObject.restype = ctypes.c_ulong
    kernel.ReleaseMutex.argtypes = [ctypes.c_void_p]
    kernel.GetCurrentProcess.restype = ctypes.c_void_p
    return kernel


@lru_cache(maxsize=1)
def _account_sid() -> str:
    kernel = _kernel()
    security = ctypes.WinDLL("advapi32", use_last_error=True)
    handle_type = ctypes.c_void_p
    size_type = ctypes.c_ulong
    security.OpenProcessToken.argtypes = [handle_type, size_type, ctypes.POINTER(handle_type)]
    security.GetTokenInformation.argtypes = [
        handle_type,
        ctypes.c_int,
        handle_type,
        size_type,
        ctypes.POINTER(size_type),
    ]
    security.GetLengthSid.argtypes = [handle_type]
    security.GetLengthSid.restype = size_type
    token = handle_type()
    if not security.OpenProcessToken(kernel.GetCurrentProcess(), 0x0008, ctypes.byref(token)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        # TOKEN_USER starts with the SID pointer. The buffer accommodates a maximal Windows SID.
        buffer = (handle_type * 32)()
        size = size_type()
        if not security.GetTokenInformation(
            token, 1, buffer, ctypes.sizeof(buffer), ctypes.byref(size)
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        sid = buffer[0]
        if sid is None:
            raise OSError("Missing Windows cache account identity.")
        length = security.GetLengthSid(sid)
        if not 8 <= length <= 68:
            raise OSError("Invalid Windows cache account identity.")
        return ctypes.string_at(sid, length).hex()
    finally:
        kernel.CloseHandle(token)


@contextmanager
def _mutex(label: str) -> Iterator[tuple[int, bool]]:
    kernel = _kernel()
    # Match the host's names. Installed and synthetic profiles have distinct guards.
    scope = "FixtureArtworkV1" if os.environ.get("REPODITOR_E2E") == "1" else "ArtworkV1"
    name = f"Global\\RepoDitorPreview.{scope}.{_account_sid()}.{label}"
    ctypes.set_last_error(0)
    handle = kernel.CreateMutexW(None, False, name)
    error = ctypes.get_last_error()
    if not handle:
        raise ctypes.WinError(error)
    try:
        yield handle, error == 183  # ERROR_ALREADY_EXISTS
    finally:
        kernel.CloseHandle(handle)


@contextmanager
def _gate(timeout_ms: int) -> Iterator[None]:
    kernel = _kernel()
    with _mutex("Gate") as (handle, _):
        result = kernel.WaitForSingleObject(handle, timeout_ms)
        if result == 258:  # WAIT_TIMEOUT
            raise CacheBusyError("Cache admission gate is busy.")
        if result not in (0, 128):  # WAIT_OBJECT_0, WAIT_ABANDONED
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            yield
        finally:
            if not kernel.ReleaseMutex(handle):
                raise ctypes.WinError(ctypes.get_last_error())


@contextmanager
def cache_activity() -> Iterator[None]:
    # Retain a marker handle without acquiring its mutex. Multiple readers may coexist.
    with ExitStack() as lifetime:
        with _gate(2_000):
            lifetime.enter_context(_mutex("Active"))
        yield


@contextmanager
def offline_cache() -> Iterator[None]:
    """Exclude new users and refuse an already active host or cache operation."""
    with _gate(0), _mutex("Active") as (_, exists):
        if exists:
            raise CacheBusyError("Close RepoDitor and wait for its cache operations to finish.")
        yield
