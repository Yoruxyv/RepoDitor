"""Keep a checkout lock until the runner and its Windows process tree exit."""

import _winapi
import ctypes
import subprocess
import time
from ctypes import wintypes
from pathlib import PureWindowsPath
from threading import Lock


class Accounting(ctypes.Structure):
    _fields_ = [
        ("times", ctypes.c_int64 * 4),
        ("page_faults", wintypes.DWORD),
        ("total", wintypes.DWORD),
        ("active", wintypes.DWORD),
        ("terminated", wintypes.DWORD),
    ]


class Limits(ctypes.Structure):
    _fields_ = [
        ("times", ctypes.c_int64 * 2),
        ("flags", wintypes.DWORD),
        ("minimum_working_set", ctypes.c_size_t),
        ("maximum_working_set", ctypes.c_size_t),
        ("active_limit", wintypes.DWORD),
        ("affinity", ctypes.c_size_t),
        ("priority", wintypes.DWORD),
        ("scheduling", wintypes.DWORD),
        ("io_counters", ctypes.c_uint64 * 6),
        ("memory_limits", ctypes.c_size_t * 4),
    ]


class TestJob:
    __test__ = False

    def __init__(self, name):
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p]
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel.ResumeThread.argtypes = [wintypes.HANDLE]
        kernel.ResumeThread.restype = wintypes.DWORD
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.IsProcessInJob.argtypes = [wintypes.HANDLE, wintypes.HANDLE, ctypes.c_void_p]
        kernel.QueryFullProcessImageNameW.argtypes = [
            wintypes.HANDLE,
            wintypes.DWORD,
            wintypes.LPWSTR,
            ctypes.POINTER(wintypes.DWORD),
        ]
        kernel.SetInformationJobObject.argtypes = [
            wintypes.HANDLE,
            ctypes.c_int,
            ctypes.c_void_p,
            wintypes.DWORD,
        ]
        kernel.QueryInformationJobObject.argtypes = [
            wintypes.HANDLE,
            ctypes.c_int,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.c_void_p,
        ]
        self.kernel = kernel
        self._launch_lock = Lock()
        self._launch_closed = False
        ctypes.set_last_error(0)
        self.handle = kernel.CreateJobObjectW(None, name)
        error = ctypes.get_last_error()
        if self.handle is None:
            raise ctypes.WinError(error)
        try:
            if error == 183:  # The job name also excludes concurrent runners across sessions.
                raise OSError("Another native safety run owns this checkout")
            limits = Limits(flags=0x2000)  # KILL_ON_JOB_CLOSE, with no breakaway.
            if not kernel.SetInformationJobObject(
                self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)
            ):
                raise ctypes.WinError(ctypes.get_last_error())
        except BaseException:
            _winapi.CloseHandle(self.handle)
            raise

    def __enter__(self):
        return self

    def __exit__(self, *_):
        _winapi.CloseHandle(self.handle)

    def run(self, command, env):
        with self._launch_lock:
            if self._launch_closed:
                raise OSError("The native job is closed to new launches")
            self._launch_closed = True
            process = self._start_runner(command, env)
        try:
            # These are waits on the owned process, with opportunities to handle Ctrl+C.
            while _winapi.WaitForSingleObject(process, 250) == _winapi.WAIT_TIMEOUT:
                pass
            return _winapi.GetExitCodeProcess(process)
        finally:
            _winapi.CloseHandle(process)

    def _start_runner(self, command, env):
        process, thread, _, _ = _winapi.CreateProcess(
            command[0],
            subprocess.list2cmdline(command),
            None,
            None,
            False,
            0x4,
            env,
            None,
            subprocess.STARTUPINFO(),  # CREATE_SUSPENDED
        )
        try:
            if not self.kernel.AssignProcessToJobObject(self.handle, process) or not self.contains(
                process
            ):
                raise OSError("Cannot establish native test runner ownership")
            if self.kernel.ResumeThread(thread) != 1:
                raise OSError("Cannot resume native test runner")
        except BaseException:
            try:
                _winapi.TerminateProcess(process, 1)
            finally:
                _winapi.CloseHandle(process)
            raise
        finally:
            _winapi.CloseHandle(thread)
        return process

    def active_processes(self):
        accounting = Accounting()
        if not self.kernel.QueryInformationJobObject(
            self.handle, 1, ctypes.byref(accounting), ctypes.sizeof(accounting), None
        ):
            raise OSError(
                f"Cannot query native job accounting: {ctypes.WinError(ctypes.get_last_error())}"
            )
        if accounting.active > accounting.total:
            raise OSError(
                "Native job accounting reports more active processes than total processes"
            )
        return accounting.active

    def contains(self, process):
        belongs = wintypes.BOOL()
        if not self.kernel.IsProcessInJob(process, self.handle, ctypes.byref(belongs)):
            raise OSError(
                f"Cannot verify native job membership: {ctypes.WinError(ctypes.get_last_error())}"
            )
        return bool(belongs.value)

    def members(self):
        buffer = ctypes.create_string_buffer(8 + 512 * ctypes.sizeof(ctypes.c_size_t))
        if not self.kernel.QueryInformationJobObject(
            self.handle, 3, buffer, ctypes.sizeof(buffer), None
        ):
            raise OSError(
                f"Cannot enumerate native job processes: {ctypes.WinError(ctypes.get_last_error())}"
            )
        counts = (wintypes.DWORD * 2).from_buffer(buffer)
        if counts[0] != counts[1] or counts[1] > 512:
            raise OSError("Incomplete native job process list")
        pids = (ctypes.c_size_t * counts[1]).from_buffer(buffer, ctypes.sizeof(counts))
        return list(pids)

    def wait_until_idle(self, timeout=5, *, build_uploaders=()):
        with self._launch_lock:
            self._launch_closed = True
        deadline = time.monotonic() + timeout
        while self.active_processes():
            pids = self.members()
            if not pids:
                if self.active_processes():
                    raise OSError("Native job accounting is nonzero with an empty process list")
                return
            for pid in pids:
                access = 0x101001 if build_uploaders else 0x101000
                handle = self.kernel.OpenProcess(access, False, pid)
                if not handle:
                    error = ctypes.get_last_error()
                    if error == 87:  # The PID may have exited after the snapshot.
                        break
                    raise OSError(f"Cannot open native job PID {pid}: {ctypes.WinError(error)}")
                try:
                    if not self.contains(handle) or self.exited(handle):
                        break  # Re-query accounting before trusting a new PID snapshot.
                    if build_uploaders:
                        try:
                            image = self.image(handle, pid)
                        except OSError:
                            if self.exited(handle):
                                break
                            raise
                        if PureWindowsPath(image) in build_uploaders:
                            # Stop only the installed MSVC uploader on the verified job handle.
                            _winapi.TerminateProcess(handle, 0)
                    if (
                        _winapi.WaitForSingleObject(
                            handle, max(0, int((deadline - time.monotonic()) * 1000))
                        )
                        == _winapi.WAIT_TIMEOUT
                    ):
                        raise OSError(f"Native job PID {pid} is still active after runner exit")
                finally:
                    _winapi.CloseHandle(handle)
            if time.monotonic() >= deadline and self.active_processes():
                raise OSError("Native job still has active processes after runner exit")

    def exited(self, handle):
        return _winapi.WaitForSingleObject(handle, 0) == _winapi.WAIT_OBJECT_0

    def image(self, handle, pid):
        name = ctypes.create_unicode_buffer(32768)
        length = wintypes.DWORD(len(name))
        if self.kernel.QueryFullProcessImageNameW(handle, 0, name, ctypes.byref(length)):
            return name.value
        raise OSError(
            f"Cannot identify native job PID {pid}: {ctypes.WinError(ctypes.get_last_error())}"
        )

    def remaining_images(self):
        images = []
        for pid in self.members():
            handle = self.kernel.OpenProcess(0x1000, False, pid)
            if not handle:
                raise OSError(
                    f"Cannot open diagnostic PID {pid}: {ctypes.WinError(ctypes.get_last_error())}"
                )
            try:
                if not self.contains(handle):
                    raise OSError(f"Diagnostic PID {pid} changed job membership")
                images.append({"pid": pid, "image": PureWindowsPath(self.image(handle, pid)).name})
            finally:
                _winapi.CloseHandle(handle)
        return images
