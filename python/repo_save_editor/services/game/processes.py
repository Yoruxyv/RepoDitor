"""Trust-first detection of a running R.E.P.O. process on Windows."""

from __future__ import annotations

import ctypes
import ntpath
import sys
from collections.abc import Callable
from ctypes import wintypes
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any, Final

from repo_save_editor.services.game.discovery import (
    GameDiscoveryResult,
    discover_game_installation,
)

REPO_EXECUTABLE_NAME: Final = "REPO.exe"
TH32CS_SNAPPROCESS: Final = 0x00000002
PROCESS_QUERY_LIMITED_INFORMATION: Final = 0x1000
ERROR_NO_MORE_FILES: Final = 18
MAX_EXECUTABLE_PATH_CHARS: Final = 32768
INVALID_HANDLE_VALUE: Final = ctypes.c_void_p(-1).value


class GameProcessStatus(StrEnum):
    """Whether the validated R.E.P.O. executable is currently running."""

    RUNNING = "running"
    NOT_RUNNING = "not_running"
    UNKNOWN = "unknown"


class ProcessInspectionError(RuntimeError):
    """Raised when Windows process state cannot be inspected reliably."""


@dataclass(frozen=True, slots=True)
class ProcessInspection:
    """Verified paths for matching process names plus any unverifiable candidate."""

    executable_paths: tuple[Path, ...]
    has_unverifiable_candidate: bool = False


class _ProcessEntry32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", wintypes.LONG),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", wintypes.WCHAR * 260),
    ]


def _normalize_windows_path(path: Path) -> str:
    """Normalize a path with Windows semantics even when tests run elsewhere."""
    return ntpath.normcase(ntpath.normpath(str(path)))


def _is_same_executable(expected: Path, observed: Path) -> bool:
    """Return whether two paths identify the same executable file."""
    if _normalize_windows_path(expected) == _normalize_windows_path(observed):
        return True

    try:
        return expected.samefile(observed)
    except OSError:
        return False


def classify_game_process(
    expected_executable: Path,
    inspection: ProcessInspection,
) -> GameProcessStatus:
    """Classify process observations against one validated executable path."""
    if any(_is_same_executable(expected_executable, path) for path in inspection.executable_paths):
        return GameProcessStatus.RUNNING
    if inspection.has_unverifiable_candidate:
        return GameProcessStatus.UNKNOWN
    return GameProcessStatus.NOT_RUNNING


def is_expected_process_name(name: str, expected_executable: Path) -> bool:
    """Return whether a snapshot filename can belong to the expected executable."""
    return name.casefold() == ntpath.basename(str(expected_executable)).casefold()


def _kernel32() -> Any:
    if sys.platform != "win32" or not hasattr(ctypes, "WinDLL"):
        raise ProcessInspectionError("Windows process inspection is unavailable.")

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(_ProcessEntry32W)]
    kernel32.Process32FirstW.restype = wintypes.BOOL
    kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(_ProcessEntry32W)]
    kernel32.Process32NextW.restype = wintypes.BOOL
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD),
    ]
    kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    return kernel32


def _query_process_path(kernel32: Any, process_id: int) -> Path | None:
    process = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, process_id)
    if not process:
        return None
    try:
        buffer = ctypes.create_unicode_buffer(MAX_EXECUTABLE_PATH_CHARS)
        length = wintypes.DWORD(len(buffer))
        if not kernel32.QueryFullProcessImageNameW(process, 0, buffer, ctypes.byref(length)):
            return None
        return Path(buffer.value[: length.value])
    finally:
        kernel32.CloseHandle(process)


def inspect_windows_processes(expected_executable: Path) -> ProcessInspection:
    """Inspect candidates for one executable identity supplied by validated discovery."""
    kernel32 = _kernel32()
    snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    snapshot_value = ctypes.cast(snapshot, ctypes.c_void_p).value
    if snapshot_value == INVALID_HANDLE_VALUE:
        raise ProcessInspectionError("The process snapshot could not be created.")

    paths: list[Path] = []
    unverifiable = False
    entry = _ProcessEntry32W()
    entry.dwSize = ctypes.sizeof(_ProcessEntry32W)
    try:
        if not kernel32.Process32FirstW(snapshot, ctypes.byref(entry)):
            if ctypes.get_last_error() == ERROR_NO_MORE_FILES:
                return ProcessInspection(())
            raise ProcessInspectionError("The process snapshot could not be read.")

        while True:
            if is_expected_process_name(entry.szExeFile, expected_executable):
                path = _query_process_path(kernel32, entry.th32ProcessID)
                if path is None:
                    unverifiable = True
                else:
                    paths.append(path)

            if kernel32.Process32NextW(snapshot, ctypes.byref(entry)):
                continue
            if ctypes.get_last_error() != ERROR_NO_MORE_FILES:
                raise ProcessInspectionError("The process snapshot ended unexpectedly.")
            break
    finally:
        kernel32.CloseHandle(snapshot)

    return ProcessInspection(tuple(paths), unverifiable)


def get_game_process_status(
    game_dir: Path | None = None,
    *,
    discover: Callable[[Path | None], GameDiscoveryResult] = discover_game_installation,
    inspect: Callable[[Path], ProcessInspection] = inspect_windows_processes,
) -> GameProcessStatus:
    """Verify whether the validated local R.E.P.O. executable is running.

    Args:
        game_dir: Optional explicit installation root.
        discover: Injectable trusted-installation discovery function.
        inspect: Injectable Windows process inspector.

    Returns:
        ``UNKNOWN`` when installation or process identity cannot be verified,
        allowing callers to fail closed before editing or writing saves.
    """
    discovery = discover(game_dir)
    if discovery.installation is None:
        return GameProcessStatus.UNKNOWN

    expected_executable = discovery.installation.root / REPO_EXECUTABLE_NAME
    try:
        inspection = inspect(expected_executable)
    except (OSError, ProcessInspectionError):
        return GameProcessStatus.UNKNOWN

    return classify_game_process(expected_executable, inspection)
