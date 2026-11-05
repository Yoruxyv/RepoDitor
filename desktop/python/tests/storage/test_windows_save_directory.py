"""Synthetic local-NTFS namespace and transaction regression controls."""

import ctypes
import os
import struct
from hashlib import sha256
from pathlib import Path

import pytest

from repo_save_editor.desktop_api import health_recovery as api
from repo_save_editor.desktop_api.saves import save_changes
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.storage import health_recovery
from repo_save_editor.storage.health_recovery import HealthTransaction, health_lock
from repo_save_editor.storage.repository import SaveBackupError, SaveRepository
from repo_save_editor.storage.windows_save_directory import (
    IoStatus,
    RenameInfo,
    SaveDirectory,
    SaveNamespaceError,
)

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows NTFS handle contracts")
SAVE = "REPO_SAVE_2026_08_08_10_20_30"
OP = "a" * 32
CHANGES = [{"feature": "players", "entity": "111", "field": "health", "after": 17}]


def stopped():
    return GameProcessStatus.NOT_RUNNING


def junction(directory, path, destination):
    """Set a mount-point reparse tag on a disposable empty directory, without a shell."""
    handle = directory.kernel.CreateFileW(str(path), 0x100, 7, None, 3, 0x02200000, None)
    assert handle != ctypes.c_void_p(-1).value
    substitute = ("\\??\\" + str(destination)).encode("utf-16-le")
    display = str(destination).encode("utf-16-le")
    names = substitute + b"\0\0" + display + b"\0\0"
    data = (
        struct.pack(
            "<LHHHHHH",
            0xA0000003,
            8 + len(names),
            0,
            0,
            len(substitute),
            len(substitute) + 2,
            len(display),
        )
        + names
    )
    buffer = ctypes.create_string_buffer(data)
    returned = ctypes.c_ulong()
    call = directory.kernel.DeviceIoControl
    call.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.c_void_p,
        ctypes.c_void_p,
    ]
    try:
        assert call(handle, 0x900A4, buffer, len(data), None, 0, ctypes.byref(returned), None), (
            ctypes.get_last_error()
        )
    finally:
        assert directory.kernel.CloseHandle(handle)
    assert path.is_junction()


def fixture(root, sample_save):
    path = root / SAVE / f"{SAVE}.es3"
    SaveRepository(root).save_as(path, sample_save)
    before = path.read_bytes()
    return path, before, sha256(before).hexdigest()


def test_relative_replace_exact_bytes_backup_enumeration_and_cleanup(tmp_path):
    slot = tmp_path / "ordinary-ユニコード"
    slot.mkdir()
    target, staging, backup = (
        slot / name for name in ("canonical.bin", "staged-😀.tmp", "backup.bin")
    )
    target.write_bytes(b"original")
    with SaveDirectory(target) as directory:
        with directory.open(backup, "xb") as stream:
            stream.write(directory.read(target))
        with directory.open(staging, "xb") as stream:
            stream.write(b"verified postimage")
        with directory.open(staging, rename=True) as stream:
            assert directory.read(staging) == b"verified postimage"
            with pytest.raises(PermissionError, match=r"\[Errno 13\]"):
                staging.write_bytes(b"foreign writer")
            directory.replace(stream, target)
        assert directory.read(target) == b"verified postimage"
        assert directory.read(backup) == b"original"
        assert set(directory.names()) == {target.name, backup.name}
        directory.remove(backup)
        assert set(directory.names()) == {target.name}
    assert target.read_bytes() == b"verified postimage"
    assert not staging.exists()


@pytest.mark.parametrize("ancestor", [False, True])
def test_movement_is_blocked_while_replacement_remains_possible(tmp_path, ancestor):
    slot = tmp_path / "approved" / "slot"
    slot.mkdir(parents=True)
    target, staged = slot / "canonical.bin", slot / "staging.tmp"
    target.write_bytes(b"original")
    staged.write_bytes(b"postimage")
    with SaveDirectory(target) as directory:
        moved = slot.parent if ancestor else slot
        with pytest.raises(OSError, match=r"\[WinError 32\]"):
            moved.rename(moved.with_name("moved"))
        with directory.open(staged, rename=True) as stream:
            directory.replace(stream, target)
    assert target.read_bytes() == b"postimage"


@pytest.mark.parametrize("operation", ["read", "create", "replace", "remove", "names"])
def test_in_place_root_reparse_never_redirects_operations(tmp_path, operation):
    slot, outside = tmp_path / "approved", tmp_path / "outside"
    slot.mkdir()
    outside.mkdir()
    target = slot / "canonical.bin"
    sentinel = outside / target.name
    sentinel.write_bytes(b"outside sentinel")
    # Root conversion requires an empty directory: stage through an independently held root.
    staged = tmp_path / "staged.bin"
    staged.write_bytes(b"synthetic postimage")
    with SaveDirectory(target) as directory, SaveDirectory(staged) as source_directory:
        junction(directory, slot, outside)
        if operation == "replace":
            with (
                source_directory.open(staged, rename=True) as stream,
                pytest.raises(OSError, match=r"\[WinError 1921\]"),
            ):
                directory.replace(stream, target)
        elif operation == "names":
            # Enumeration may describe the pinned empty object; it must never list outside.
            assert list(directory.names()) == []
        elif operation == "create":
            with (
                pytest.raises(OSError, match=r"\[WinError 1921\]"),
                directory.open(target, "xb"),
            ):
                pytest.fail("A converted root admitted file creation")
        else:
            with pytest.raises(OSError, match=r"\[WinError 1921\]"):
                getattr(directory, operation)(target)
    assert sentinel.read_bytes() == b"outside sentinel"
    assert staged.read_bytes() == b"synthetic postimage"
    assert list(outside.iterdir()) == [sentinel]


def test_existing_junction_and_hardlink_are_rejected(tmp_path):
    slot, outside = tmp_path / "approved", tmp_path / "outside"
    slot.mkdir()
    outside.mkdir()
    sentinel = outside / "canonical.bin"
    sentinel.write_bytes(b"outside sentinel")
    with SaveDirectory(sentinel) as directory:
        junction(directory, slot, outside)
    with (
        pytest.raises(SaveNamespaceError, match="Nonordinary save namespace"),
        SaveDirectory(slot / sentinel.name),
    ):
        pytest.fail("Reparse ancestry was admitted")
    linked = outside / "hardlink.bin"
    linked.hardlink_to(sentinel)
    with SaveDirectory(linked) as directory, pytest.raises(SaveNamespaceError):
        directory.read(linked)
    assert sentinel.read_bytes() == b"outside sentinel"


@pytest.mark.parametrize("relative", ["../outside.bin", "nested/file.bin", "canonical.bin:stream"])
def test_leaf_operations_reject_namespace_escape(tmp_path, relative):
    target = tmp_path / "canonical.bin"
    with SaveDirectory(target) as directory, pytest.raises(SaveNamespaceError):
        directory.read(tmp_path / relative)
    assert list(tmp_path.iterdir()) == []


def test_partial_admission_releases_all_ancestor_handles(tmp_path, monkeypatch):
    slot = tmp_path / "approved" / "slot"
    slot.mkdir(parents=True)
    original = SaveDirectory._directory_identity

    def fail(directory, handle):
        identity = original(directory, handle)
        if len(directory.handles) == len(slot.parts):
            raise OSError("synthetic partial admission")
        return identity

    monkeypatch.setattr(SaveDirectory, "_directory_identity", fail)
    with pytest.raises(OSError, match="partial admission"):
        SaveDirectory(slot / "canonical.bin")
    moved = slot.with_name("moved")
    slot.rename(moved)
    assert moved.is_dir()


@pytest.mark.parametrize("reserved", [False, True])
def test_admitted_transaction_cannot_be_redirected_before_replacement(
    tmp_path, sample_save, monkeypatch, reserved
):
    path, before, fingerprint = fixture(tmp_path, sample_save)
    verified = HealthTransaction.verified
    attempted = False

    def attempt(transaction, written):
        nonlocal attempted
        verified(transaction, written)
        with pytest.raises(OSError, match=r"\[WinError 32\]"):
            path.parent.rename(path.parent.with_name("relocated"))
        attempted = True

    monkeypatch.setattr(HealthTransaction, "verified", attempt)
    if reserved:
        # Simulate an exited reservation owner; subprocess handoff is covered by adapter tests.
        with health_lock(path) as directory:
            tx = HealthTransaction(path, OP, directory=directory)
            tx.prepare(before)
        monkeypatch.setattr(health_recovery, "_owner_exited", lambda *_: True)
    result = api.write_health(
        SAVE, fingerprint, CHANGES, OP, tmp_path, reserved=reserved, game_status_loader=stopped
    )["transaction"]
    assert attempted
    assert result["status"] == "applied"
    assert next(path.parent.glob("*.bak-health-*")).read_bytes() == before
    assert (
        SaveRepository.load(path)["dictionaryOfDictionaries"]["value"]["playerHealth"]["111"] == 17
    )


@pytest.mark.parametrize("action", ["write", "recover"])
def test_handoff_rejects_relocated_namespace_with_identical_leaf_inode(
    tmp_path, sample_save, monkeypatch, action
):
    root = tmp_path / "saves"
    path, before, fingerprint = fixture(root, sample_save)
    with health_lock(path) as directory:
        tx = HealthTransaction(path, OP, directory=directory)
        tx.prepare(before)
    receipt = tx.pending.read_bytes()
    original_identity = path.stat().st_ino
    moved = path.parent.with_name("previous-slot")
    path.parent.rename(moved)
    path.parent.mkdir()
    for entry in moved.iterdir():
        entry.rename(path.parent / entry.name)
    assert path.stat().st_ino == original_identity
    monkeypatch.setattr(health_recovery, "_owner_exited", lambda *_: True)
    if action == "write":
        result = api.write_health(
            SAVE, fingerprint, CHANGES, OP, root, reserved=True, game_status_loader=stopped
        )["transaction"]
        assert result["status"] == "rejected"
    else:
        assert api.recover_health(SAVE, OP, root)["transaction"]["status"] == "conflict"
    assert path.read_bytes() == before
    assert tx.pending.read_bytes() == receipt
    assert not tx.backup.exists()
    assert not tx.archive.exists()


def test_ordinary_writer_uses_bound_reads_backup_and_replacement(
    tmp_path, sample_save, monkeypatch
):
    path, before, fingerprint = fixture(tmp_path, sample_save)
    original = Path.open

    def reject_path_open(value, *args, **kwargs):
        if value.parent == path.parent:
            raise AssertionError("Mutation used a pathname open")
        return original(value, *args, **kwargs)

    monkeypatch.setattr(Path, "open", reject_path_open)
    result = save_changes(SAVE, fingerprint, CHANGES, tmp_path, game_status_loader=stopped)
    assert result["ok"] is True
    with SaveDirectory(path) as directory:
        assert directory.read(Path(result["result"]["backupPath"])) == before
        assert directory.read(path) != before


def test_original_post_validation_junction_race_admits_no_redirected_write(
    tmp_path, sample_save, monkeypatch
):
    root = tmp_path / "approved"
    path, before, fingerprint = fixture(root, sample_save)
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / path.name
    sentinel.write_bytes(before)
    original = SaveDirectory._directory_identity
    attempted = False
    preserved = tmp_path / "preserved-original.bin"

    def convert_after_validation(directory, handle):
        nonlocal attempted
        identity = original(directory, handle)
        if not attempted and len(directory.handles) == len(path.parent.parts):
            attempted = True
            path.rename(preserved)
            junction(directory, path.parent, outside)
        return identity

    monkeypatch.setattr(SaveDirectory, "_directory_identity", convert_after_validation)
    result = api.write_health(SAVE, fingerprint, CHANGES, OP, root, game_status_loader=stopped)[
        "transaction"
    ]
    assert attempted
    assert result["status"] == "rejected"
    assert result["reason"] == "backend_unavailable"
    assert sentinel.read_bytes() == before
    assert preserved.read_bytes() == before
    assert list(outside.iterdir()) == [sentinel]


def test_native_partial_staging_failure_cleans_only_staging(tmp_path, sample_save, monkeypatch):
    path, before, fingerprint = fixture(tmp_path, sample_save)
    original = SaveRepository._write_temp

    def fail_sync(_descriptor):
        raise OSError("synthetic staging flush failure")

    def stage(target, written, directory=None):
        with monkeypatch.context() as scope:
            scope.setattr(os, "fsync", fail_sync)
            return original(target, written, directory)

    monkeypatch.setattr(SaveRepository, "_write_temp", staticmethod(stage))
    result = save_changes(SAVE, fingerprint, CHANGES, tmp_path, game_status_loader=stopped)
    assert result["error"]["code"] == "save_write_failed"
    assert path.read_bytes() == before
    assert next(path.parent.glob("*.bak-*")).read_bytes() == before
    assert not list(path.parent.glob("*.tmp"))


def test_post_rename_io_failure_is_uncertain_and_recoverable(tmp_path, sample_save, monkeypatch):
    path, before, fingerprint = fixture(tmp_path, sample_save)
    original = SaveDirectory.replace

    def fail_after_replace(directory, stream, target):
        original(directory, stream, target)
        if target == path:
            raise OSError("synthetic failure after successful native rename")

    monkeypatch.setattr(SaveDirectory, "replace", fail_after_replace)
    result = api.write_health(SAVE, fingerprint, CHANGES, OP, tmp_path, game_status_loader=stopped)[
        "transaction"
    ]
    assert result["status"] == "uncertain"
    assert result["reason"] == "save_write_failed"
    assert next(path.parent.glob("*.bak-health-*")).read_bytes() == before
    assert path.read_bytes() != before
    assert not list(path.parent.glob("*.tmp"))
    monkeypatch.setattr(health_recovery, "_owner_exited", lambda *_: True)
    assert api.recover_health(SAVE, OP, tmp_path)["transaction"]["status"] == "applied"


def test_namespace_remains_pinned_at_every_mutating_transaction_boundary(
    tmp_path, sample_save, monkeypatch
):
    path, before, fingerprint = fixture(tmp_path, sample_save)
    opened, replaced, removed = SaveDirectory.open, SaveDirectory.replace, SaveDirectory.remove
    observed = set()

    def attempt(name):
        observed.add(name)
        with pytest.raises(OSError, match=r"\[WinError 32\]"):
            path.parent.rename(path.parent.with_name("relocated"))

    def open_leaf(directory, target, mode="rb", **kwargs):
        if mode != "rb":
            attempt(
                "lock"
                if target.name.endswith(".lock")
                else "receipt"
                if target.name.endswith(".receipt.tmp")
                else "backup"
                if ".bak-" in target.name
                else "staging"
            )
        return opened(directory, target, mode, **kwargs)

    def replace_leaf(directory, stream, target):
        attempt("replacement" if target == path else "publication")
        return replaced(directory, stream, target)

    def remove_leaf(directory, target):
        attempt("acknowledgement" if target.name.endswith("health-pending.json") else "cleanup")
        return removed(directory, target)

    monkeypatch.setattr(SaveDirectory, "open", open_leaf)
    monkeypatch.setattr(SaveDirectory, "replace", replace_leaf)
    monkeypatch.setattr(SaveDirectory, "remove", remove_leaf)
    result = api.write_health(SAVE, fingerprint, CHANGES, OP, tmp_path, game_status_loader=stopped)[
        "transaction"
    ]
    assert result["status"] == "applied"
    monkeypatch.setattr(health_recovery, "_owner_exited", lambda *_: True)
    assert api.recover_health(SAVE, OP, tmp_path)["transaction"]["status"] == "applied"
    assert observed == {
        "lock",
        "receipt",
        "backup",
        "staging",
        "replacement",
        "publication",
        "cleanup",
        "acknowledgement",
    }
    assert next(path.parent.glob("*.bak-health-*")).read_bytes() == before


@pytest.mark.parametrize(
    ("device", "flags", "length"), [(7, 0x10, 8), (20, 0, 8), (0, 0, 8), (7, 0, 0)]
)
def test_remote_unknown_and_incomplete_device_information_fail_closed(
    tmp_path, monkeypatch, device, flags, length
):
    original = SaveDirectory._require_local_ntfs
    admitted = []

    def inspect(directory, handle):
        admitted.append(directory)

        def query(_handle, status, buffer, _size, _kind):
            buffer[0], buffer[1] = device, flags
            ctypes.cast(status, ctypes.POINTER(IoStatus)).contents.information = length
            return 0

        directory.native.NtQueryVolumeInformationFile = query
        original(directory, handle)

    monkeypatch.setattr(SaveDirectory, "_require_local_ntfs", inspect)
    with pytest.raises(SaveNamespaceError, match="Unsupported save device"):
        SaveDirectory(tmp_path / "canonical.bin")
    assert admitted[0].handles == []
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("name", ["a", "ab", "abc", "abcd", "abcde", "target-😀.bin"])
def test_rename_uses_documented_sdk_buffer_size_and_complete_utf16(tmp_path, name):
    target, staging = tmp_path / name, tmp_path / "staging.tmp"
    target.write_bytes(b"original")
    staging.write_bytes(b"postimage")
    with SaveDirectory(target) as directory:
        original = directory.native.NtSetInformationFile
        called = False

        def inspect(handle, status, buffer, length, kind):
            nonlocal called
            header = ctypes.cast(buffer, ctypes.POINTER(RenameInfo)).contents
            assert kind == 10
            assert header.replace == 1
            assert header.root == directory.handles[-1]
            assert length >= ctypes.sizeof(RenameInfo) + header.length
            assert (
                ctypes.string_at(
                    ctypes.addressof(buffer) + RenameInfo.name.offset, header.length
                ).decode("utf-16-le")
                == name
            )
            called = True
            return original(handle, status, buffer, length, kind)

        directory.native.NtSetInformationFile = inspect
        with directory.open(staging, rename=True) as stream:
            directory.replace(stream, target)
        assert called
    assert target.read_bytes() == b"postimage"


def test_backup_open_failure_does_not_delete_a_file_it_never_created(tmp_path, monkeypatch):
    target = tmp_path / "canonical.bin"
    target.write_bytes(b"original")
    attempted = []
    original = SaveDirectory.open

    def deny(directory, path, mode="rb", **kwargs):
        if mode == "xb":
            path.write_bytes(b"preexisting unrelated evidence")
            attempted.append(path)
            raise PermissionError("synthetic denied creation")
        return original(directory, path, mode, **kwargs)

    with SaveDirectory(target) as directory:
        monkeypatch.setattr(SaveDirectory, "open", deny)
        with pytest.raises(SaveBackupError, match="could not be backed up"):
            SaveRepository._create_backup(target, b"original", directory)
    assert len(attempted) == 1
    assert attempted[0].read_bytes() == b"preexisting unrelated evidence"
    assert target.read_bytes() == b"original"
