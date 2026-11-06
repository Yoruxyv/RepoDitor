"""Operation-owned receipts and recovery for synthetic single-domain save transactions."""

from __future__ import annotations

import ctypes
import json
import os
import re
import stat
import sys
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from dataclasses import asdict, dataclass, replace
from hashlib import sha256
from pathlib import Path
from typing import BinaryIO

from repo_save_editor.core.save_resources import (
    bounded_save_operation,
    check_encrypted,
    hash_encrypted,
)
from repo_save_editor.storage.windows_save_directory import SaveDirectory, SaveNamespaceError

if sys.platform == "win32":
    import msvcrt
else:
    import fcntl

_ID = re.compile(r"[0-9a-f]{32}\Z")
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_RECEIPT_LIMIT = 4096
HEALTH_INTENT_LIMIT = 2048
UPGRADE_INTENT_LIMIT = 2048
RUN_INTENT_LIMIT = 512


class RecoveryError(OSError):
    """A public recovery rejection with no filesystem diagnostics."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def valid_operation(value: object) -> bool:
    """Validate a host-generated, path-free operation identity."""
    return isinstance(value, str) and _ID.fullmatch(value) is not None


def _present(path: Path, directory: SaveDirectory | None = None) -> bool:
    if directory is not None:
        return directory.exists(path)
    try:
        path.lstat()
    except FileNotFoundError:
        return False
    return True


def pending_health(path: Path, directory: SaveDirectory | None = None) -> bool:
    """Fail closed when pending metadata cannot be inspected."""
    if _present(path.with_name(f".{path.name}.health-pending.json"), directory):
        return True
    prefix = f".{path.name}.health-"
    return any(
        name.startswith(prefix) and name.endswith(".receipt.tmp")
        for name in _names(path.parent, directory)
    )


def _names(parent: Path, directory: SaveDirectory | None = None) -> Iterator[str]:
    if directory is not None:
        yield from directory.names()
    else:
        with os.scandir(parent) as entries:
            yield from (entry.name for entry in entries)


def _unlink(path: Path, directory: SaveDirectory | None = None, *, missing: bool = False) -> None:
    if directory is None:
        path.unlink(missing_ok=missing)
    else:
        try:
            directory.remove(path)
        except FileNotFoundError:
            if not missing:
                raise


def _regular(path: Path, *, missing: bool = False, directory: SaveDirectory | None = None) -> None:
    if directory is not None:
        directory.regular(path, missing=missing)
        return
    try:
        info = path.lstat()
    except FileNotFoundError:
        if missing:
            return
        raise
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_nlink != 1
        or getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
    ):
        raise RecoveryError("write_conflict")


def _hash(path: Path, directory: SaveDirectory | None = None) -> str:
    if directory is not None:
        return directory.snapshot(path)[0]
    _regular(path)
    with path.open("rb") as stream:
        return hash_encrypted(stream)


def _identity(path: Path) -> list[int]:
    _regular(path)
    info = path.stat()
    return [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns]


def _identity_shape(value: object) -> bool:
    return isinstance(value, list) and len(value) == 4 and all(type(n) is int for n in value)


def _process_started(kernel: ctypes.CDLL, handle: int) -> int:
    times = [ctypes.c_ulonglong() for _ in range(4)]
    kernel.GetProcessTimes.argtypes = [ctypes.c_void_p] + [ctypes.POINTER(ctypes.c_ulonglong)] * 4
    kernel.GetProcessTimes.restype = ctypes.c_int
    if not kernel.GetProcessTimes(handle, *(ctypes.byref(value) for value in times)):
        raise ctypes.WinError(ctypes.get_last_error())
    return times[0].value


def _current_started() -> int:
    if os.name != "nt":
        return 0
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetCurrentProcess.restype = ctypes.c_void_p
    return _process_started(kernel, kernel.GetCurrentProcess())


def _owner_exited(pid: int, started: int) -> bool:
    if os.name == "nt":
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
        kernel.OpenProcess.restype = ctypes.c_void_p
        kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        kernel.WaitForSingleObject.restype = ctypes.c_ulong
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = kernel.OpenProcess(0x00101000, False, pid)
        if not handle:
            return ctypes.get_last_error() == 87
        try:
            if _process_started(kernel, handle) != started:
                return True
            return bool(kernel.WaitForSingleObject(handle, 0) == 0)
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    except PermissionError:
        return False
    return False


def _snapshot(path: Path, directory: SaveDirectory | None = None) -> tuple[str, list[int]]:
    if directory is not None:
        return directory.snapshot(path)
    identity = _identity(path)
    digest = _hash(path)
    if _identity(path) != identity:
        raise RecoveryError("write_conflict")
    return digest, identity


def _flush_write(path: Path, data: bytes, directory: SaveDirectory | None = None) -> None:
    with directory.open(path, "xb") if directory is not None else path.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def _publish(
    source: Path,
    target: Path,
    directory: SaveDirectory | None = None,
    *,
    expected: bytes,
) -> None:
    if len(expected) > _RECEIPT_LIMIT:
        raise RecoveryError("write_conflict")
    if directory is not None:
        with directory.open(source, rename=True) as stream:
            if stream.read(len(expected) + 1) != expected:
                raise RecoveryError("write_conflict")
            directory.replace(stream, target)
        return
    # Receipt ordering must survive process death before the save can be replaced.
    if os.name == "nt":
        move = ctypes.WinDLL("kernel32", use_last_error=True).MoveFileExW
        move.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_ulong]
        move.restype = ctypes.c_int
        if not move(str(source), str(target), 0x1 | 0x8):
            raise ctypes.WinError(ctypes.get_last_error())
    else:
        source.replace(target)
        descriptor = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def _file_lock(stream: BinaryIO, *, unlock: bool = False) -> None:
    stream.seek(0)
    if sys.platform == "win32":
        msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK if unlock else msvcrt.LK_NBLCK, 1)
    else:
        fcntl.flock(stream.fileno(), fcntl.LOCK_UN if unlock else fcntl.LOCK_EX | fcntl.LOCK_NB)


@contextmanager
def health_lock(path: Path) -> Iterator[SaveDirectory | None]:
    """Serialize writers/recovery while retaining their admitted Windows namespace."""
    try:
        with ExitStack() as ownership:
            directory = ownership.enter_context(SaveDirectory(path)) if os.name == "nt" else None
            if directory is None:
                for parent in (path.parent, *path.parents):
                    info = parent.lstat()
                    if (
                        parent.is_symlink()
                        or getattr(info, "st_file_attributes", 0)
                        & stat.FILE_ATTRIBUTE_REPARSE_POINT
                    ):
                        raise RecoveryError("write_conflict")
            _regular(path, directory=directory)
            lock = path.with_name(f".{path.name}.health.lock")
            _regular(lock, missing=True, directory=directory)
            stream = ownership.enter_context(
                directory.open(lock, "a+b") if directory is not None else lock.open("a+b")
            )
            if stream.seek(0, os.SEEK_END) == 0:
                stream.write(b"0")
                stream.flush()
                os.fsync(stream.fileno())
            try:
                _file_lock(stream)
            except OSError as exc:
                raise RecoveryError("write_busy") from exc
            try:
                yield directory
            finally:
                _file_lock(stream, unlock=True)
    except SaveNamespaceError as exc:
        raise RecoveryError("write_conflict") from exc


@dataclass(frozen=True)
class Receipt:
    """Versioned fingerprints; filenames are derived, never accepted from a receipt."""

    operation: str
    save: str
    before: str
    before_identity: list[int]
    owner_pid: int
    owner_started: int
    after: str | None = None
    after_identity: list[int] | None = None
    phase: str = "prepared"
    version: int = 1
    intent: dict[str, object] | None = None
    namespace: str | None = None


def _receipt_bytes(value: Receipt) -> bytes:
    payload = asdict(value)
    if value.version < 3:
        del payload["namespace"]
    if value.version == 1:
        del payload["intent"]
    return json.dumps(payload, sort_keys=True, ensure_ascii=value.version < 4).encode()


class HealthTransaction:
    """One synthetic save operation, used only while its save's health_lock is held."""

    def __init__(
        self,
        path: Path,
        operation: str,
        *,
        intent: dict[str, object] | None = None,
        directory: SaveDirectory | None = None,
    ) -> None:
        if not valid_operation(operation):
            raise RecoveryError("invalid_request")
        if intent is not None and not (
            valid_intent(intent)
            or valid_health_batch_intent(intent)
            or valid_upgrade_intent(intent)
            or valid_run_intent(intent)
        ):
            raise RecoveryError("invalid_request")
        self.path = path
        self.directory = directory
        self.operation = operation
        self.pending = path.with_name(f".{path.name}.health-pending.json")
        self.archive = path.with_name(f".{path.name}.health-{operation}.json")
        self.process_started = _current_started()
        self.receipt_temp = path.with_name(
            f".{path.name}.health-{operation}.{os.getpid()}-{self.process_started}.receipt.tmp"
        )
        self.temporary = path.with_name(f".{path.name}.health-{operation}.tmp")
        self.backup = path.with_name(f"{path.name}.bak-health-{operation}")
        self.started = False
        self.resumed = False
        self.intent = intent

    def _read(self, path: Path) -> Receipt:
        _regular(path, directory=self.directory)
        with self.directory.open(path) if self.directory is not None else path.open("rb") as stream:
            blob = stream.read(_RECEIPT_LIMIT + 1)
        if len(blob) > _RECEIPT_LIMIT:
            raise RecoveryError("write_conflict")
        try:
            raw = json.loads(blob)
            if not isinstance(raw, dict):
                raise TypeError("Invalid receipt shape")
            fields = set(Receipt.__dataclass_fields__)
            if raw.get("version") in {1, 2}:
                fields.remove("namespace")
            if raw.get("version") == 1:
                fields.remove("intent")
            if set(raw) != fields:
                raise ValueError("Invalid receipt shape")
            value = Receipt(**raw)
            if (
                type(value.version) is not int
                or value.version not in {1, 2, 3, 4, 5, 6}
                or (value.version == 2 and not valid_intent(value.intent))
                or (
                    value.version in {4, 5, 6}
                    and (
                        not (
                            valid_upgrade_intent(value.intent)
                            if value.version == 4
                            else valid_run_intent(value.intent)
                            if value.version == 5
                            else valid_health_batch_intent(value.intent)
                        )
                        or (
                            value.namespace is not None and _HASH.fullmatch(value.namespace) is None
                        )
                    )
                )
                or (
                    value.version == 3
                    and (
                        not isinstance(value.namespace, str)
                        or _HASH.fullmatch(value.namespace) is None
                        or (value.intent is not None and not valid_intent(value.intent))
                    )
                )
                or value.save != self.path.name
                or value.operation != self.operation
                or not valid_operation(value.operation)
                or not isinstance(value.before, str)
                or _HASH.fullmatch(value.before) is None
                or not _identity_shape(value.before_identity)
                or type(value.owner_pid) is not int
                or not 0 < value.owner_pid <= 0xFFFFFFFF
                or type(value.owner_started) is not int
                or not 0 <= value.owner_started <= 0xFFFFFFFFFFFFFFFF
                or value.phase not in {"prepared", "verified", "applied", "unchanged"}
                or (
                    value.after is not None
                    and (not isinstance(value.after, str) or _HASH.fullmatch(value.after) is None)
                )
                or (value.phase in {"verified", "applied"} and value.after is None)
                or (value.phase == "prepared" and value.after is not None)
                or (value.after is not None and value.after == value.before)
                or (value.after is None) != (value.after_identity is None)
                or (value.after_identity is not None and not _identity_shape(value.after_identity))
            ):
                raise ValueError("Invalid receipt fields")
            return value
        except (TypeError, ValueError) as exc:
            raise RecoveryError("write_conflict") from exc

    def _write(self, value: Receipt, target: Path) -> None:
        blob = _receipt_bytes(value)
        if len(blob) > _RECEIPT_LIMIT:
            raise RecoveryError("write_conflict")
        _regular(target, missing=True, directory=self.directory)
        _regular(self.receipt_temp, missing=True, directory=self.directory)
        # An existing temp can only be removed after a valid receipt attributes it.
        if _present(self.receipt_temp, directory=self.directory):
            self._read(
                self.pending if _present(self.pending, directory=self.directory) else self.archive
            )
            _unlink(self.receipt_temp, self.directory)
        _flush_write(self.receipt_temp, blob, directory=self.directory)
        _publish(self.receipt_temp, target, self.directory, expected=blob)

    def admit(self) -> None:
        """Refuse unresolved targets and operation replay before mutation preparation."""
        if pending_health(self.path, directory=self.directory):
            raise RecoveryError("write_recovery_required")
        if _present(self.archive, directory=self.directory):
            raise RecoveryError("write_duplicate")
        if any(
            _present(p, directory=self.directory)
            for p in (self.backup, self.temporary, self.receipt_temp)
        ):
            raise RecoveryError("write_conflict")

    @bounded_save_operation
    def prepare(self, source: bytes) -> None:
        check_encrypted(source)
        if self.resumed:
            receipt = self._read(self.pending)
            if (
                receipt.phase != "prepared"
                or receipt.owner_pid != os.getpid()
                or receipt.owner_started != self.process_started
                or _snapshot(self.path, directory=self.directory)
                != (receipt.before, receipt.before_identity)
                or sha256(source).hexdigest() != receipt.before
            ):
                raise RecoveryError("write_conflict")
            return
        self.admit()
        current, identity = _snapshot(self.path, directory=self.directory)
        before = sha256(source).hexdigest()
        if current != before:
            raise RecoveryError("write_conflict")
        self.started = True
        self._write(
            Receipt(
                self.operation,
                self.path.name,
                before,
                identity,
                os.getpid(),
                self.process_started,
                version=(
                    6
                    if valid_health_batch_intent(self.intent)
                    else 5
                    if valid_run_intent(self.intent)
                    else 4
                    if valid_upgrade_intent(self.intent)
                    else 3
                    if self.directory is not None
                    else 2
                    if self.intent is not None
                    else 1
                ),
                namespace=self.directory.identity if self.directory is not None else None,
                intent=self.intent,
            ),
            self.pending,
        )

    def _require_namespace(self, receipt: Receipt) -> None:
        if self.directory is not None and receipt.namespace != self.directory.identity:
            raise RecoveryError("write_conflict")

    @bounded_save_operation
    def resume(self) -> None:
        """Claim a durably acknowledged reservation before doing any save work."""
        if _present(self.archive, directory=self.directory):
            raise RecoveryError("write_duplicate")
        receipt = self._read(self.pending)
        self._require_namespace(receipt)
        if receipt.phase != "prepared" or receipt.after is not None:
            raise RecoveryError("write_recovery_required")
        if not _owner_exited(receipt.owner_pid, receipt.owner_started):
            raise RecoveryError("write_busy")
        if _snapshot(self.path, directory=self.directory) != (
            receipt.before,
            receipt.before_identity,
        ):
            raise RecoveryError("write_conflict")
        self.started = True
        self._write(
            replace(receipt, owner_pid=os.getpid(), owner_started=self.process_started),
            self.pending,
        )
        self.resumed = True
        self.intent = receipt.intent

    def create_backup(self, source: bytes) -> Path:
        check_encrypted(source)
        _flush_write(self.backup, source, directory=self.directory)
        return self.backup

    def stage(self, written: bytes) -> Path:
        check_encrypted(written)
        _flush_write(self.temporary, written, directory=self.directory)
        return self.temporary

    def verified(self, written: bytes) -> None:
        check_encrypted(written)
        receipt = self._read(self.pending)
        after = sha256(written).hexdigest()
        if after == receipt.before:
            raise RecoveryError("write_conflict")
        current, identity = _snapshot(self.temporary, directory=self.directory)
        if current != after:
            raise RecoveryError("write_conflict")
        self._write(
            replace(receipt, after=after, after_identity=identity, phase="verified"), self.pending
        )

    def _adopt_preparing(self) -> bool:
        candidates = self._receipt_temps()
        if not candidates:
            return False
        if len(candidates) != 1:
            raise RecoveryError("write_conflict")
        temporary, publisher, started = candidates[0]
        preparing = self._read(temporary)
        self._require_namespace(preparing)
        if (
            preparing.phase != "prepared"
            or _present(self.backup, directory=self.directory)
            or _present(self.temporary, directory=self.directory)
        ):
            raise RecoveryError("write_conflict")
        if (publisher, started) != (preparing.owner_pid, preparing.owner_started):
            raise RecoveryError("write_conflict")
        if not _owner_exited(publisher, started):
            raise RecoveryError("write_busy")
        _publish(temporary, self.pending, self.directory, expected=_receipt_bytes(preparing))
        return True

    def _receipt_temps(self) -> list[tuple[Path, int, int]]:
        result: list[tuple[Path, int, int]] = []
        prefix = f".{self.path.name}.health-{self.operation}."
        for name in _names(self.path.parent, self.directory):
            if not name.startswith(prefix) or not name.endswith(".receipt.tmp"):
                continue
            if len(result) >= 16:
                raise RecoveryError("write_conflict")
            identity = name[len(prefix) : -len(".receipt.tmp")].split("-")
            if (
                len(identity) != 2
                or any(not value.isascii() or not value.isdigit() for value in identity)
                or not 0 < int(identity[0]) <= 0xFFFFFFFF
                or not 0 <= int(identity[1]) <= 0xFFFFFFFFFFFFFFFF
            ):
                raise RecoveryError("write_conflict")
            result.append((self.path.parent / name, int(identity[0]), int(identity[1])))
        return result

    def _cleanup(self) -> None:
        for temporary, publisher, started in self._receipt_temps():
            if (publisher, started) != (os.getpid(), self.process_started) and not _owner_exited(
                publisher, started
            ):
                raise RecoveryError("write_busy")
            _regular(temporary, directory=self.directory)
            _unlink(temporary, self.directory)
        _regular(self.temporary, missing=True, directory=self.directory)
        _unlink(self.temporary, self.directory, missing=True)

    def _classify(self, receipt: Receipt, current: str, identity: list[int]) -> tuple[str, bool]:
        backup_exact = (
            _present(self.backup, directory=self.directory)
            and _hash(self.backup, directory=self.directory) == receipt.before
        )
        if (
            receipt.after is not None
            and current == receipt.after
            and backup_exact
            and identity == receipt.after_identity
        ):
            return "applied", backup_exact
        if (
            current == receipt.before
            and receipt.phase != "applied"
            and identity == receipt.before_identity
        ):
            return "unchanged", backup_exact
        raise RecoveryError("write_conflict")

    def _preflight_resources(self) -> None:
        # Resource rejection must precede adoption, settlement, and evidence cleanup.
        for path in (self.path, self.backup, self.temporary):
            if _present(path, directory=self.directory):
                _hash(path, directory=self.directory)

    @bounded_save_operation
    def recover(
        self, *, own_completion: bool = False, acknowledge: bool = True
    ) -> dict[str, object]:
        """Classify actual bytes and settle once; never replay a mutation or delete backups."""
        self._preflight_resources()
        active = _present(self.pending, directory=self.directory)
        archived = _present(self.archive, directory=self.directory)
        if not active and not archived:
            active = self._adopt_preparing()
        if not active and not archived:
            if _present(self.backup, directory=self.directory) or _present(
                self.temporary, directory=self.directory
            ):
                raise RecoveryError("write_conflict")
            return self._result("rejected", _hash(self.path, directory=self.directory), False)
        receipt = self._read(self.pending if active else self.archive)
        self._require_namespace(receipt)
        if (
            active
            and not (
                own_completion
                and (receipt.owner_pid, receipt.owner_started)
                == (os.getpid(), self.process_started)
            )
            and not _owner_exited(receipt.owner_pid, receipt.owner_started)
        ):
            raise RecoveryError("write_busy")
        if archived:
            previous = self._read(self.archive)
            if (previous.before, previous.after) != (receipt.before, receipt.after):
                raise RecoveryError("write_conflict")
        current, current_identity = _snapshot(self.path, directory=self.directory)
        outcome, backup_exact = self._classify(receipt, current, current_identity)
        if not active:
            if receipt.phase != outcome:
                raise RecoveryError("write_conflict")
            return self._result(outcome, current, backup_exact)
        settled = replace(receipt, phase=outcome)
        if not archived:
            self._write(settled, self.archive)
        elif self._read(self.archive) != settled:
            raise RecoveryError("write_conflict")
        if own_completion:
            # Delivery can still be lost; only explicit reconciliation acknowledges the write.
            return self._result(outcome, current, backup_exact)
        self._cleanup()
        if _snapshot(self.path, directory=self.directory) != (current, current_identity):
            raise RecoveryError("write_conflict")
        if acknowledge:
            _unlink(self.pending, self.directory)
        return self._result(outcome, current, backup_exact)

    def _result(self, status: str, fingerprint: str | None, backup: bool) -> dict[str, object]:
        return {
            "operationId": self.operation,
            "status": status,
            "fingerprint": fingerprint,
            "backupAvailable": backup,
        }


def valid_health_batch_intent(value: object) -> bool:
    """Admit only distinct Health edits within the existing batch/receipt budgets."""
    if not isinstance(value, dict) or set(value) != {"health"}:
        return False
    edits = value["health"]
    if not isinstance(edits, list) or not 1 <= len(edits) <= 512:
        return False
    seen = set()
    for edit in edits:
        if not isinstance(edit, dict) or set(edit) != {"playerId", "before", "value"}:
            return False
        player = edit["playerId"]
        if (
            not isinstance(player, str)
            or not 0 < len(player) <= 20
            or not player.isascii()
            or not player.isdigit()
            or player in seen
            or type(edit["before"]) is not int
            or not 0 <= edit["before"] <= 9_007_199_254_740_991
            or type(edit["value"]) is not int
            or not 0 <= edit["value"] <= 2_147_483_647
            or edit["value"] == edit["before"]
        ):
            return False
        seen.add(player)
    # ASCII IDs and integers cannot expand through Unicode escaping. Default receipt
    # separators add six bytes per edit; complete receipts still have a 4096-byte cap.
    return len(json.dumps(value, separators=(",", ":")).encode()) <= HEALTH_INTENT_LIMIT


def valid_upgrade_intent(value: object) -> bool:
    """Bound durable upgrade identities and values without granting schema authority."""
    if not isinstance(value, dict) or set(value) != {"upgrades"}:
        return False
    edits = value["upgrades"]
    if not isinstance(edits, list) or not 1 <= len(edits) <= 512:
        return False
    seen = set()
    for edit in edits:
        if not isinstance(edit, dict) or set(edit) != {"playerId", "key", "value", "before"}:
            return False
        player, key = edit["playerId"], edit["key"]
        if (
            not isinstance(player, str)
            or not 0 < len(player) <= 20
            or not player.isascii()
            or not player.isdigit()
            or not isinstance(key, str)
            or not key.startswith("playerUpgrade")
            or key == "playerUpgrade"
            or "\0" in key
            or len(key.encode("utf-8", errors="surrogatepass")) > 512
            or type(edit["value"]) is not int
            or not 0 <= edit["value"] <= 2_147_483_647
            or type(edit["before"]) is not int
            or not 0 <= edit["before"] <= 9_007_199_254_740_991
            or edit["value"] == edit["before"]
            or (player, key) in seen
        ):
            return False
        seen.add((player, key))
    try:
        return (
            len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode())
            <= UPGRADE_INTENT_LIMIT
        )
    except UnicodeEncodeError:
        return False


def valid_run_intent(value: object) -> bool:
    """Five fixed fields fit 512 UTF-8 bytes; Python still verifies loaded-save authority."""
    if not isinstance(value, dict) or set(value) != {"run"}:
        return False
    edits = value["run"]
    if not isinstance(edits, list) or not 1 <= len(edits) <= 5:
        return False
    seen = set()
    for edit in edits:
        if not isinstance(edit, dict) or set(edit) != {"field", "before", "value"}:
            return False
        field, before, after = edit["field"], edit["before"], edit["value"]
        if not isinstance(field, str) or field in seen or before == after:
            return False
        seen.add(field)
        if field == "resumeLocation":
            if (
                not isinstance(before, str)
                or len(before.encode("utf-8", errors="surrogatepass")) > 64
                or after not in ("Normal", "Shop / Service Station")
            ):
                return False
        elif field in {"level", "currency", "lives", "totalHaul"}:
            if (
                type(before) is not int
                or not -(2**53 - 1) <= before <= 2**53 - 1
                or type(after) is not int
                or not (1 if field == "level" else -(2**31))
                <= after
                <= (2**31 if field == "level" else 2**31 - 1)
                or (field == "level" and before < 1)
            ):
                return False
        else:
            return False
    try:
        return (
            len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode())
            <= RUN_INTENT_LIMIT
        )
    except UnicodeEncodeError:
        return False


def valid_intent(value: object) -> bool:
    """Validate presentation intent without interpreting encrypted save semantics."""
    if not isinstance(value, dict) or set(value) != {"playerId", "health", "before"}:
        return False
    player = value["playerId"]
    return (
        isinstance(player, str)
        and 0 < len(player) <= 20
        and player.isascii()
        and player.isdigit()
        and type(value["health"]) is int
        and 0 <= value["health"] <= 2_147_483_647
        and type(value["before"]) is int
        and 0 <= value["before"] <= 9_007_199_254_740_991
    )


def inspect_pending(path: Path, directory: SaveDirectory | None = None) -> Receipt | None:
    """Read the fixed pending marker or one preparing receipt; never settle or replay it."""
    pending = path.with_name(f".{path.name}.health-pending.json")
    if not _present(pending, directory):
        prefix = f".{path.name}.health-"
        candidates: list[Path] = []
        for name in _names(path.parent, directory):
            if name.startswith(prefix) and name.endswith(".receipt.tmp"):
                candidates.append(path.parent / name)
                if len(candidates) > 1:
                    raise RecoveryError("write_conflict")
        if not candidates:
            return None
        pending = candidates[0]
    _regular(pending, directory=directory)
    with directory.open(pending) if directory is not None else pending.open("rb") as stream:
        blob = stream.read(_RECEIPT_LIMIT + 1)
    try:
        if len(blob) > _RECEIPT_LIMIT:
            raise ValueError("Oversized receipt")
        raw = json.loads(blob)
        operation = raw.get("operation") if isinstance(raw, dict) else None
        if not isinstance(operation, str) or not valid_operation(operation):
            raise ValueError("Invalid identity")
        transaction = HealthTransaction(path, operation, directory=directory)
        receipt = transaction._read(pending)
        if pending != transaction.pending:
            publishers = transaction._receipt_temps()
            if receipt.phase != "prepared" or publishers != [
                (pending, receipt.owner_pid, receipt.owner_started)
            ]:
                raise RecoveryError("write_conflict")
        return receipt
    except (TypeError, ValueError) as exc:
        raise RecoveryError("write_conflict") from exc
