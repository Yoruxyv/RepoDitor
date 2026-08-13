"""Optional local R.E.P.O. icon-cache discovery."""

from __future__ import annotations

import ctypes
import os
import sys
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

IconDomain = Literal["item", "cosmetic"]
MAX_ICON_KEY_LENGTH = 260
UNUSABLE_ITEM_ICON_KEYS = frozenset({"item walkietalkiebox.png"})


@dataclass(frozen=True, slots=True)
class IconCacheRoots:
    """Trusted local cache roots for game-generated presentation icons."""

    items: Path
    cosmetics: Path


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


def _windows_local_app_data_low() -> Path | None:
    """Resolve LocalAppDataLow through the Windows Known Folder API."""
    if sys.platform != "win32":
        return None
    if os.environ.get("REPODITOR_E2E") == "1":
        test_root = os.environ.get("REPODITOR_E2E_LOCAL_APP_DATA_LOW")
        if test_root:
            return Path(test_root)
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
            ctypes.byref(FOLDER_ID_LOCAL_APP_DATA_LOW), 0, None, ctypes.byref(output)
        )
        if result != 0 or not output.value:
            return None
        try:
            return Path(output.value)
        finally:
            ole32.CoTaskMemFree(output)
    except (AttributeError, OSError, ValueError):
        return None


def get_icon_cache_roots(
    resolver: Callable[[], Path | None] = _windows_local_app_data_low,
) -> IconCacheRoots | None:
    """Return fixed R.E.P.O. icon-cache roots, or ``None`` when unavailable."""
    local_low = resolver()
    if local_low is None:
        return None
    base = local_low / "semiwork" / "Repo" / "Cache" / "Icons"
    return IconCacheRoots(items=base / "Items", cosmetics=base / "Cosmetics")


def normalize_icon_cache_key(source: str) -> str | None:
    """Apply R.E.P.O.'s proven cache filename rule to one canonical identity."""
    if not isinstance(source, str):
        return None
    stem = source.replace("(Clone)", "").lower()
    if (
        not stem
        or len(stem) + 4 > MAX_ICON_KEY_LENGTH
        or stem in {".", ".."}
        or any(character in stem for character in ("/", "\\", "\0"))
    ):
        return None
    return f"{stem}.png"


def available_icon_keys(
    domain: IconDomain,
    keys: Iterable[str],
    roots_loader: Callable[[], IconCacheRoots | None] = get_icon_cache_roots,
) -> frozenset[str]:
    """Return trusted cache keys that currently name regular local PNG files."""
    roots = roots_loader()
    if roots is None:
        return frozenset()
    root = roots.items if domain == "item" else roots.cosmetics
    available: set[str] = set()
    for key in dict.fromkeys(keys):
        if (
            not isinstance(key, str)
            or (domain == "item" and key in UNUSABLE_ITEM_ICON_KEYS)
            or normalize_icon_cache_key(key.removesuffix(".png")) != key
        ):
            continue
        candidate = root / key
        try:
            if candidate.is_file() and not candidate.is_symlink():
                available.add(key)
        except OSError:
            continue
    return frozenset(available)


__all__ = [
    "IconCacheRoots",
    "available_icon_keys",
    "get_icon_cache_roots",
    "normalize_icon_cache_key",
]
