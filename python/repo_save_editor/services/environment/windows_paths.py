"""Authoritative Windows Known Folder path resolution."""

from __future__ import annotations

import ctypes
import os
import sys
from collections.abc import Mapping
from pathlib import Path


class _Guid(ctypes.Structure):
    _fields_ = [
        ("data1", ctypes.c_uint32),
        ("data2", ctypes.c_uint16),
        ("data3", ctypes.c_uint16),
        ("data4", ctypes.c_ubyte * 8),
    ]


FOLDER_ID_LOCAL_APP_DATA_LOW = _Guid(
    0xA520A1A4,
    0x1780,
    0x4FF6,
    (ctypes.c_ubyte * 8)(0xBD, 0x18, 0x16, 0x73, 0x43, 0xC5, 0xAF, 0x16),
)


def resolve_windows_local_app_data_low(
    environment: Mapping[str, str] | None = None,
) -> Path | None:
    """Resolve ``FOLDERID_LocalAppDataLow`` without guessing a profile path.

    Packaged E2E keeps its existing explicit LocalAppDataLow override. Outside
    that narrow test mode, failure to resolve the Windows Known Folder returns
    ``None``; callers must fail soft rather than synthesize ``AppData/LocalLow``.
    """
    process_environment = os.environ if environment is None else environment
    if process_environment.get("REPODITOR_E2E") == "1":
        test_root = process_environment.get("REPODITOR_E2E_LOCAL_APP_DATA_LOW")
        if test_root:
            return Path(test_root)

    if sys.platform != "win32":
        return None

    try:
        shell32 = ctypes.WinDLL("shell32", use_last_error=True)
        ole32 = ctypes.WinDLL("ole32")
        output = ctypes.c_wchar_p()
        shell32.SHGetKnownFolderPath.argtypes = [
            ctypes.POINTER(_Guid),
            ctypes.c_uint32,
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_wchar_p),
        ]
        shell32.SHGetKnownFolderPath.restype = ctypes.c_long
        ole32.CoTaskMemFree.argtypes = [ctypes.c_void_p]
        result = shell32.SHGetKnownFolderPath(
            ctypes.byref(FOLDER_ID_LOCAL_APP_DATA_LOW),
            0,
            None,
            ctypes.byref(output),
        )
        if result != 0 or not output.value:
            return None
        try:
            return Path(output.value)
        finally:
            ole32.CoTaskMemFree(output)
    except (AttributeError, OSError, ValueError):
        return None


__all__ = ["resolve_windows_local_app_data_low"]
