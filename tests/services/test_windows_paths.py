from __future__ import annotations

from pathlib import Path

import pytest

from repo_save_editor.services.environment import windows_paths
from repo_save_editor.services.environment.windows_paths import (
    resolve_windows_local_app_data_low,
)


def test_known_folder_api_can_return_nonstandard_profile_drive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected = Path(r"E:\Whatever\LocalLow")

    class FakeFunction:
        def __init__(self, callback):
            self.callback = callback
            self.argtypes = None
            self.restype = None

        def __call__(self, *args):
            return self.callback(*args)

    output_buffer = windows_paths.ctypes.create_unicode_buffer(str(expected))

    def known_folder(_guid, _flags, _token, output_pointer):
        pointer = windows_paths.ctypes.cast(
            output_pointer,
            windows_paths.ctypes.POINTER(windows_paths.ctypes.c_void_p),
        )
        pointer[0] = windows_paths.ctypes.cast(output_buffer, windows_paths.ctypes.c_void_p)
        return 0

    shell32 = type("Shell32", (), {})()
    shell32.SHGetKnownFolderPath = FakeFunction(known_folder)
    ole32 = type("Ole32", (), {})()
    ole32.CoTaskMemFree = FakeFunction(lambda _pointer: None)

    monkeypatch.setattr(windows_paths.sys, "platform", "win32")
    monkeypatch.setattr(
        windows_paths.ctypes,
        "WinDLL",
        lambda name, **_kwargs: shell32 if name == "shell32" else ole32,
        raising=False,
    )

    assert resolve_windows_local_app_data_low({}) == expected


def test_e2e_override_preserves_arbitrary_local_app_data_low_root() -> None:
    root = r"D:\Profiles\Alice\LocalLow"

    assert resolve_windows_local_app_data_low(
        {
            "REPODITOR_E2E": "1",
            "REPODITOR_E2E_LOCAL_APP_DATA_LOW": root,
        }
    ) == Path(root)


def test_known_folder_failure_does_not_fall_back_to_home(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(windows_paths.sys, "platform", "linux")

    def unexpected_home() -> Path:
        raise AssertionError("Path.home() must not be used for LocalAppDataLow discovery")

    monkeypatch.setattr(Path, "home", unexpected_home)

    assert resolve_windows_local_app_data_low({}) is None
