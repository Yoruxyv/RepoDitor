"""Bounded receipt publication through the admitted Windows namespace."""

import os
from contextlib import contextmanager
from hashlib import sha256

import pytest

from repo_save_editor.desktop_api import health_recovery as api
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.storage import health_recovery as storage
from repo_save_editor.storage.repository import SaveRepository
from repo_save_editor.storage.windows_save_directory import SaveDirectory

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows NTFS publication handles")
SAVE = "REPO_SAVE_2026_08_08_10_20_30"
OP = "a" * 32
LIMIT = 4096


def observe_reads(monkeypatch):
    original = SaveDirectory.open
    reads = []

    class Observed:
        def __init__(self, stream):
            self.stream = stream

        def read(self, size=-1):
            result = self.stream.read(size)
            reads.append((size, len(result)))
            return result

        def __getattr__(self, name):
            return getattr(self.stream, name)

    @contextmanager
    def opened(directory, path, *args, **kwargs):
        with original(directory, path, *args, **kwargs) as stream:
            yield Observed(stream) if kwargs.get("rename") else stream

    monkeypatch.setattr(SaveDirectory, "open", opened)
    return reads


@pytest.mark.parametrize("length", [1, LIMIT - 1, LIMIT])
@pytest.mark.parametrize(
    "mutation", ["exact", "extra", "truncated", "mismatch", "huge", "replaced"]
)
def test_publication_compares_at_most_expected_plus_one(tmp_path, monkeypatch, length, mutation):
    expected = b"x" * length
    contents = {
        "exact": expected,
        "extra": expected + b"!",
        "truncated": expected[:-1],
        "mismatch": b"!" + expected[1:],
        "huge": expected + b"!" * (1024 * 1024),
        "replaced": b"replacement evidence",
    }[mutation]
    source, target, unrelated = (tmp_path / name for name in ("receipt.tmp", "pending", "other"))
    source.write_bytes(expected)
    target.write_bytes(b"previous receipt")
    unrelated.write_bytes(b"unrelated evidence")
    if mutation == "replaced":
        substitute = tmp_path / "substitute"
        substitute.write_bytes(contents)
        substitute.replace(source)
    else:
        source.write_bytes(contents)
    reads = observe_reads(monkeypatch)
    with SaveDirectory(target) as directory:
        if mutation == "exact":
            storage._publish(source, target, directory, expected=expected)
            assert not source.exists()
            assert target.read_bytes() == expected
        else:
            with pytest.raises(storage.RecoveryError, match=r"^write_conflict$"):
                storage._publish(source, target, directory, expected=expected)
            assert source.read_bytes() == contents
            assert target.read_bytes() == b"previous receipt"
    assert reads == [(length + 1, min(length + 1, len(contents)))]
    assert unrelated.read_bytes() == b"unrelated evidence"


def test_expected_receipt_cannot_exceed_inspection_limit(tmp_path, monkeypatch):
    source, target = tmp_path / "receipt.tmp", tmp_path / "pending"
    expected = b"x" * (LIMIT + 1)
    source.write_bytes(expected)
    target.write_bytes(b"previous receipt")
    reads = observe_reads(monkeypatch)
    with (
        SaveDirectory(target) as directory,
        pytest.raises(storage.RecoveryError, match=r"^write_conflict$"),
    ):
        storage._publish(source, target, directory, expected=expected)
    assert reads == []
    assert source.read_bytes() == expected
    assert target.read_bytes() == b"previous receipt"


@pytest.mark.parametrize("version", [1, 2, 3])
@pytest.mark.parametrize("extra", [False, True])
def test_receipt_schema_inspection_boundary(tmp_path, version, extra):
    path = tmp_path / "save.es3"
    path.write_bytes(b"synthetic source")
    with SaveDirectory(path) as directory:
        transaction = storage.HealthTransaction(path, OP, directory=directory)
        receipt = storage.Receipt(
            OP,
            path.name,
            sha256(path.read_bytes()).hexdigest(),
            [0, 0, 0, 0],
            os.getpid(),
            transaction.process_started,
            version=version,
            intent={"playerId": "111", "health": 17, "before": 25} if version > 1 else None,
            namespace=directory.identity if version == 3 else None,
        )
        blob = storage._receipt_bytes(receipt)
        transaction.pending.write_bytes(blob + b" " * (LIMIT - len(blob) + int(extra)))
        if extra:
            with pytest.raises(storage.RecoveryError, match=r"^write_conflict$"):
                transaction._read(transaction.pending)
        else:
            assert transaction._read(transaction.pending) == receipt
        assert transaction.pending.stat().st_size == LIMIT + int(extra)


@pytest.mark.parametrize("mutation", ["extra", "truncated", "huge", "replaced"])
def test_application_rejects_substituted_receipt_before_backup(
    tmp_path, sample_save, monkeypatch, mutation
):
    path = tmp_path / SAVE / f"{SAVE}.es3"
    SaveRepository(tmp_path).save_as(path, sample_save)
    before = path.read_bytes()
    original = storage._flush_write
    expected, substituted = [], []

    def substitute(target, data, directory=None):
        original(target, data, directory)
        expected.append(data)
        blob = {
            "extra": data + b"!",
            "truncated": data[:-1],
            "huge": b"x" * (1024 * 1024),
            "replaced": b"foreign receipt evidence",
        }[mutation]
        if mutation == "replaced":
            replacement = target.with_suffix(".substitution")
            replacement.write_bytes(blob)
            replacement.replace(target)
        else:
            target.write_bytes(blob)
        substituted.append((target, blob))

    reads = observe_reads(monkeypatch)
    monkeypatch.setattr(storage, "_flush_write", substitute)
    result = api.write_health(
        SAVE,
        sha256(before).hexdigest(),
        [{"feature": "players", "entity": "111", "field": "health", "after": 17}],
        OP,
        tmp_path,
        game_status_loader=lambda: GameProcessStatus.NOT_RUNNING,
    )["transaction"]
    assert result == {
        "operationId": OP,
        "status": "uncertain",
        "fingerprint": None,
        "backupAvailable": False,
        "reason": "save_stale",
    }
    assert len(expected) == len(substituted) == 1
    assert reads == [(len(expected[0]) + 1, min(len(expected[0]) + 1, len(substituted[0][1])))]
    assert reads[0][0] <= LIMIT + 1
    assert path.read_bytes() == before
    assert substituted[0][0].read_bytes() == substituted[0][1]
    assert not list(path.parent.glob("*.bak-*"))
    assert not path.with_name(f".{path.name}.health-pending.json").exists()
    assert not path.with_name(f".{path.name}.health-{OP}.json").exists()
    assert api.recover_health(SAVE, OP, tmp_path)["transaction"]["status"] == "conflict"
    assert substituted[0][0].read_bytes() == substituted[0][1]
    assert path.read_bytes() == before


@pytest.mark.parametrize("mutation", ["extra", "truncated", "huge"])
def test_adoption_rechecks_receipt_on_held_publication_handle(tmp_path, monkeypatch, mutation):
    path = tmp_path / "save.es3"
    before = b"unchanged synthetic source"
    path.write_bytes(before)
    with storage.health_lock(path) as directory:
        transaction = storage.HealthTransaction(path, OP, directory=directory)

        def interrupted(*_args, **_kwargs):
            raise OSError("interrupted publication")

        with monkeypatch.context() as scope:
            scope.setattr(storage, "_publish", interrupted)
            with pytest.raises(OSError, match=r"^interrupted publication$"):
                transaction.prepare(before)
        orphan = transaction.receipt_temp
    original = orphan.read_bytes()
    substituted = {
        "extra": original + b"!",
        "truncated": original[:-1],
        "huge": b"x" * (1024 * 1024),
    }[mutation]

    def exited(*_args):
        # The recovery parser has inspected valid metadata; publication must recheck it.
        orphan.write_bytes(substituted)
        return True

    reads = observe_reads(monkeypatch)
    monkeypatch.setattr(storage, "_owner_exited", exited)
    with storage.health_lock(path) as directory:
        restarted = storage.HealthTransaction(path, OP, directory=directory)
        with pytest.raises(storage.RecoveryError, match=r"^write_conflict$"):
            restarted.recover()
        assert not restarted.pending.exists()
        assert not restarted.archive.exists()
    assert reads == [(len(original) + 1, min(len(original) + 1, len(substituted)))]
    assert orphan.read_bytes() == substituted
    assert path.read_bytes() == before
    assert not list(tmp_path.glob("*.bak-*"))


def test_publication_keeps_namespace_and_source_pinned_during_comparison(tmp_path, monkeypatch):
    slot = tmp_path / "slot"
    slot.mkdir()
    source, target = slot / "receipt.tmp", slot / "pending"
    expected = b"expected receipt"
    source.write_bytes(expected)
    original = SaveDirectory.open
    checked = []

    class Checked:
        def __init__(self, stream):
            self.stream = stream

        def read(self, size):
            with pytest.raises(OSError, match=r"\[WinError 32\]"):
                slot.rename(tmp_path / "relocated")
            with pytest.raises(PermissionError, match=r"\[Errno 13\]"):
                source.write_bytes(b"concurrent growth")
            checked.append(size)
            return self.stream.read(size)

        def __getattr__(self, name):
            return getattr(self.stream, name)

    @contextmanager
    def opened(directory, path, *args, **kwargs):
        with original(directory, path, *args, **kwargs) as stream:
            yield Checked(stream) if kwargs.get("rename") else stream

    monkeypatch.setattr(SaveDirectory, "open", opened)
    with SaveDirectory(target) as directory:
        storage._publish(source, target, directory, expected=expected)
    assert checked == [len(expected) + 1]
    assert target.read_bytes() == expected
    assert not source.exists()
