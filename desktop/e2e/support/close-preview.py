"""Request normal close only for the test-owned preview's main window."""

import ctypes
import sys
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)
callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
pid = int(sys.argv[1])
matched = []


@callback_type
def visit(window, _):
    owner = wintypes.DWORD()
    user32.GetWindowThreadProcessId(window, ctypes.byref(owner))
    title = ctypes.create_unicode_buffer(256)
    user32.GetWindowTextW(window, title, 256)
    if owner.value == pid and title.value == "RepoDitor Preview":
        matched.append(bool(user32.PostMessageW(window, 0x0010, 0, 0)))
    return True


user32.EnumWindows(visit, 0)
if matched != [True]:
    raise RuntimeError("Expected exactly one owned preview window")
