"""Disposable Windows regression tests for native test executable retention."""

import _winapi
import ctypes
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from native_artifacts import RunArtifacts, encode
from windows_test_job import TestJob

from repo_save_editor.storage.windows_save_directory import SaveNamespaceError


@pytest.fixture
def run(tmp_path):
    reports, fixtures = tmp_path / "reports", tmp_path / "fixtures"
    reports.mkdir()
    fixtures.mkdir()
    artifacts = RunArtifacts(uuid4().hex, reports, fixtures)
    artifacts.initialize()
    return artifacts


def copy(run):
    source = run.output / "source.exe"
    source.write_bytes(b"fixture executable")
    dest = run.fixtures / "case" / "repoditor-preview.exe"
    dest.parent.mkdir()
    run.copy(source, dest)
    return source, dest


def finish(run, *, passed=True, keep=False, seal=None):
    with TestJob(None) as job:
        return run.finish(passed=passed, keep=keep, job=job, seal=seal)


def test_retire_only_recorded_executable_and_report_missing_on_recheck(run):
    source, candidate = copy(run)
    others = [
        candidate.parent / name
        for name in (
            "unrelated.exe",
            "snapshot.es3",
            "snapshot.es3.bak-health-op",
            ".health-op.json",
            "trace.zip",
        )
    ]
    for path in others:
        path.write_bytes(b"keep")
    result = finish(run)
    assert result["state"] == "cleaned"
    assert result["retired_bytes"] == len(source.read_bytes())
    assert not candidate.exists()
    assert finish(run)["files"][0]["status"] == "missing"
    assert all(path.read_bytes() == b"keep" for path in others)


@pytest.mark.parametrize(("passed", "keep"), [(False, False), (True, True)])
def test_preserve_failed_or_pinned_runs(run, passed, keep):
    source, candidate = copy(run)
    result = finish(run, passed=passed, keep=keep)
    assert result["state"] == "retained"
    assert result["retired_bytes"] == 0
    assert result["retained_bytes"] == len(source.read_bytes())
    assert candidate.read_bytes() == source.read_bytes()


def test_same_bytes_at_replaced_path_are_not_owned(run):
    source, candidate = copy(run)
    moved = candidate.with_suffix(".old")
    candidate.rename(moved)
    candidate.write_bytes(source.read_bytes())
    assert finish(run)["state"] == "error"
    assert candidate.read_bytes() == moved.read_bytes() == source.read_bytes()


def test_changed_bytes_are_preserved(run):
    _, candidate = copy(run)
    candidate.write_bytes(b"modified fixture!!")
    assert finish(run)["state"] == "error"
    assert candidate.read_bytes() == b"modified fixture!!"


def test_reject_unexpected_hardlink(run):
    source, candidate = copy(run)
    alias = run.output / "outside.exe"
    os.link(candidate, alias)
    assert finish(run)["state"] == "error"
    assert candidate.read_bytes() == alias.read_bytes() == source.read_bytes()


def test_reject_reparse_ancestor_even_for_original_identity(run):
    source, candidate = copy(run)
    outside = run.output / "elsewhere"
    candidate.parent.rename(outside)
    _winapi.CreateJunction(str(outside), str(candidate.parent))
    try:
        assert finish(run)["state"] == "error"
        assert (outside / candidate.name).read_bytes() == source.read_bytes()
        with pytest.raises(SaveNamespaceError, match="Nonordinary save namespace"):
            run.copy(source, candidate.with_name("repoditor-preview-ordinary.exe"))
    finally:
        candidate.parent.rmdir()


@pytest.mark.parametrize("corruption", [b"{\n", b"{", b""])
def test_malformed_or_truncated_manifest_preserves_candidates(run, corruption):
    _, candidate = copy(run)
    run.manifest.write_bytes(
        run.manifest.read_bytes() + corruption if corruption else encode(run.header)
    )
    assert finish(run)["state"] == "error"
    assert candidate.is_file()


def test_invalid_path_in_manifest_rejects_entire_cleanup(run):
    source, candidate = copy(run)
    record = dict(run.read_manifest()[1][0], path=str(source))
    with run.manifest.open("ab") as stream:
        stream.write(encode(record))
    assert finish(run)["state"] == "error"
    assert candidate.is_file()
    assert source.is_file()


def test_copy_never_overwrites_an_existing_destination(run):
    source, candidate = copy(run)
    with pytest.raises(FileExistsError):
        run.copy(source, candidate)
    assert len(run.read_manifest()[1]) == 1
    assert source.read_bytes() == candidate.read_bytes()


def test_checkout_lock_excludes_another_runner_and_recovers():
    name = f"Global\\RepoDitor.NativeSafety.Test.{uuid4().hex}"
    with TestJob(name) as job:
        code = "import sys; from windows_test_job import TestJob; TestJob(sys.argv[1])"
        other = subprocess.run(  # noqa: S603 - fixed test code and generated job name
            [sys.executable, "-B", "-c", code, name],
            capture_output=True,
            cwd=Path(__file__).parent,
            check=False,
            timeout=10,
        )
        assert other.returncode != 0
        assert b"Another native safety run" in other.stderr
        assert job.active_processes() == 0
    with TestJob(name) as job:
        assert job.active_processes() == 0


@pytest.mark.parametrize("pid_reused", [False, True])
def test_stale_parent_snapshot_cannot_release_retirement(run, monkeypatch, pid_reused):
    source, candidate = copy(run)
    evidence = candidate.parent / ".MetaSave.health-pending.json"
    evidence.write_bytes(b"pending receipt")
    run.seal()
    seal = run.read_seal()
    done = f"Local\\RepoDitor.NativeSafety.Test.{uuid4().hex}"
    event = _winapi.CreateEventW(0, True, False, done)
    python = sys._base_executable
    child = """
import _winapi, sys
event = _winapi.OpenEventW(0x100000, False, sys.argv[1])
try:
    assert _winapi.WaitForSingleObject(event, 30000) == _winapi.WAIT_OBJECT_0
finally:
    _winapi.CloseHandle(event)
"""
    parent = """
import os, subprocess, sys
from pathlib import Path
try:
    escaped = subprocess.Popen([sys.executable, '-c', 'pass'],
                               creationflags=subprocess.CREATE_BREAKAWAY_FROM_JOB)
except PermissionError:
    pass
else:
    escaped.wait()
    raise AssertionError('The test job permitted breakaway')
p = subprocess.Popen([sys.executable, '-c', sys.argv[1], sys.argv[2]])
Path(sys.argv[3]).write_text(f'{os.getpid()} {p.pid}')
"""
    unrelated = None
    unrelated_name = f"{done}.unrelated"
    unrelated_event = _winapi.CreateEventW(0, True, False, unrelated_name)
    try:
        if pid_reused:
            unrelated = subprocess.Popen(  # noqa: S603 - fixed test child
                [python, "-c", child, unrelated_name]
            )
        pids = run.output / "parent-and-child"
        with TestJob(None) as job:
            assert job.run([python, "-c", parent, child, done, str(pids)], dict(os.environ)) == 0
            parent_pid, child_pid = map(int, pids.read_text().split())
            assert parent_pid not in job.members()
            assert child_pid in job.members()
            snapshots = iter(([parent_pid], [child_pid]))
            members = job.members
            with monkeypatch.context() as patch:
                patch.setattr(job, "members", lambda: next(snapshots, None) or members())
                if pid_reused:
                    open_process = job.kernel.OpenProcess
                    patch.setattr(
                        job.kernel,
                        "OpenProcess",
                        lambda access, inherit, pid: open_process(
                            access, inherit, unrelated.pid if pid == parent_pid else pid
                        ),
                    )
                blocked = run.finish(passed=True, keep=False, job=job, seal=seal, timeout=0)
            assert blocked["state"] == "error"
            assert not blocked["processes_exited"]
            assert blocked["retired_bytes"] == 0
            assert blocked["remaining_processes"][0]["pid"] == child_pid
            assert candidate.read_bytes() == source.read_bytes()
            assert run.read_seal() == seal

            cancelled = run.finish(passed=False, keep=False, job=job)
            assert cancelled["state"] == "retained"
            assert cancelled["retained_bytes"] == len(source.read_bytes())
            assert candidate.is_file()
            child_handle = _winapi.OpenProcess(0x100000, False, child_pid)
            try:
                _winapi.SetEvent(event)
                assert _winapi.WaitForSingleObject(child_handle, 5000) == _winapi.WAIT_OBJECT_0
            finally:
                _winapi.CloseHandle(child_handle)
            retired = run.finish(passed=True, keep=False, job=job, seal=seal)
            assert retired["processes_exited"]
            assert retired["remaining_processes"] == []
            assert retired["state"] == "cleaned"
            assert not candidate.exists()
            assert evidence.read_bytes() == b"pending receipt"
            assert source.is_file()
            if unrelated is not None:
                assert unrelated.poll() is None
            with pytest.raises(OSError, match="closed to new launches"):
                job.run([python, "-c", "pass"], dict(os.environ))
    finally:
        _winapi.SetEvent(event)
        _winapi.SetEvent(unrelated_event)
        if unrelated is not None:
            unrelated.wait(timeout=5)
        _winapi.CloseHandle(unrelated_event)
        _winapi.CloseHandle(event)


@pytest.mark.parametrize(
    ("failure", "message"),
    [
        ("query", "Cannot query native job accounting"),
        ("list", "Incomplete native job process list"),
        ("identity", "Cannot open diagnostic PID"),
        ("snapshot", "diagnostic snapshot is nonempty"),
        ("accounting", "accounting is nonzero"),
    ],
)
def test_uncertain_job_preserves_all_candidates(run, monkeypatch, failure, message):
    source, candidate = copy(run)
    with TestJob(None) as job:
        if failure == "query":

            def query(*_args):
                ctypes.set_last_error(5)
                return False

            monkeypatch.setattr(job.kernel, "QueryInformationJobObject", query)
        elif failure in {"list", "identity", "snapshot"}:
            query_job = job.kernel.QueryInformationJobObject

            def query(handle, kind, buffer, size, result_size):
                if kind == 1:
                    return query_job(handle, kind, buffer, size, result_size)
                counts = (ctypes.c_ulong * 2).from_buffer(buffer)
                counts[0] = 2 if failure == "list" else 1
                counts[1] = 1
                pid = ctypes.c_size_t.from_buffer(buffer, ctypes.sizeof(counts))
                pid.value = os.getpid()
                return True

            monkeypatch.setattr(job.kernel, "QueryInformationJobObject", query)
            if failure == "identity":

                def open_process(*_args):
                    ctypes.set_last_error(5)

                monkeypatch.setattr(job.kernel, "OpenProcess", open_process)
            elif failure == "snapshot":
                monkeypatch.setattr(job, "contains", lambda _: True)
        else:
            counts = iter((0, 1))
            monkeypatch.setattr(job, "active_processes", lambda: next(counts))
        report = run.finish(passed=True, keep=False, job=job, timeout=0)
    assert report["state"] == "error"
    assert message in report["error"]
    assert not report["processes_exited"]
    assert report["retired_bytes"] == 0
    assert candidate.read_bytes() == source.read_bytes()


def test_nested_job_is_accounted_for_and_only_exact_uploader_is_stopped(run):
    _, candidate = copy(run)
    entered = f"Local\\RepoDitor.NativeSafety.Test.{uuid4().hex}"
    python = Path(sys._base_executable).resolve()
    code = """
import sys
sys.path.insert(0, sys.argv[1])
from windows_test_job import TestJob
import _winapi
with TestJob(None) as inner:
    assert inner.contains(_winapi.GetCurrentProcess()) is False
    process = inner._start_runner([sys.executable, '-c',
        'import threading; threading.Event().wait(30)'], None)
    try:
        assert inner.active_processes() == 1
        event = _winapi.OpenEventW(2, False, sys.argv[2])
        try:
            _winapi.SetEvent(event)
        finally:
            _winapi.CloseHandle(event)
        _winapi.WaitForSingleObject(process, 30000)
    finally:
        _winapi.CloseHandle(process)
"""
    with TestJob(None) as job:
        event = _winapi.CreateEventW(0, True, False, entered)
        try:
            process = job._start_runner(
                [str(python), "-B", "-c", code, str(Path(__file__).parent), entered],
                dict(os.environ),
            )
            try:
                assert _winapi.WaitForSingleObject(event, 5000) == _winapi.WAIT_OBJECT_0
                assert job.active_processes() == 2
                with pytest.raises(OSError, match="still active"):
                    job.wait_until_idle(timeout=0, build_uploaders=(run.output / python.name,))
                assert candidate.is_file()
                job.wait_until_idle(build_uploaders=(python,))
                assert job.active_processes() == 0
            finally:
                _winapi.CloseHandle(process)
        finally:
            _winapi.CloseHandle(event)


def test_validation_seal_detects_truncated_valid_records(run):
    _, candidate = copy(run)
    runner_copy = run.output / "hosts/default/repoditor-preview.exe"
    runner_copy.parent.mkdir(parents=True)
    run.copy(candidate, runner_copy)
    run.seal()
    seal = run.read_seal()
    assert seal == run.receipt_for(*run.read_manifest())
    run.manifest.write_bytes(b"\n".join(run.manifest.read_bytes().splitlines()[:-1]) + b"\n")
    assert finish(run, seal=seal)["state"] == "error"
    assert candidate.is_file()
    assert runner_copy.is_file()


def test_retirement_rejects_an_open_executable(run):
    source, candidate = copy(run)
    with candidate.open("rb"):
        assert finish(run)["state"] == "error"
    assert candidate.read_bytes() == source.read_bytes()
