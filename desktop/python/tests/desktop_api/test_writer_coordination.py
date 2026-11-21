"""Cross-process admission at the application-owned save mutation boundaries."""

import json
import os
import subprocess
import sys
import time
from hashlib import sha256
from pathlib import Path

import pytest

from repo_save_editor.desktop_api.health_recovery import health_state, recover_health
from repo_save_editor.services.cosmetics.schema import validate_meta_save
from repo_save_editor.storage.repository import EncryptedSaveRepository, SaveRepository

PROJECT = Path(__file__).resolve().parents[4]
PYTHON = sys._base_executable if os.name == "nt" else sys.executable
SAVE = "REPO_SAVE_2026_08_08_10_20_30"
OP = "a" * 32
WORKER = """
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path.cwd() / 'desktop/python'))
if sys.platform == 'win32':
    sys.path.insert(0, str(Path.cwd() / '.venv/Lib/site-packages'))
from repo_save_editor.desktop_api import saves, cosmetics
from repo_save_editor.desktop_api.health_recovery import prepare_health, write_health
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.storage.health_recovery import HealthTransaction
from repo_save_editor.storage.windows_save_directory import SaveDirectory

role, root, fingerprint, pause = sys.argv[1:5]
root = Path(root)
save = 'REPO_SAVE_2026_08_08_10_20_30'
operation = sys.argv[6]
changes = [{'feature':'players','entity':'111','field':'health','after':17}]
stopped = lambda: GameProcessStatus.NOT_RUNNING
reads = 0
original_load = saves.load_discovered_save
original_replace = Path.replace
original_bound_replace = SaveDirectory.replace
original_verified = HealthTransaction.verified
original_meta = cosmetics._load_meta_save

def wait():
    if pause != '-':
        Path(pause).write_text('commit reached')
        if sys.stdin.readline() != '\\n':
            raise RuntimeError('test owner did not release writer')

def load(*args, **kwargs):
    global reads
    reads += 1
    return original_load(*args, **kwargs)

def meta(*args, **kwargs):
    global reads
    reads += 1
    return original_meta(*args, **kwargs)

def replace(staging, target):
    if role in {'legacy', 'cosmetics'} and Path(target).suffix == '.es3':
        wait()
    return original_replace(staging, target)

def verified(transaction, written):
    original_verified(transaction, written)
    if role == 'health':
        wait()

def bound_replace(directory, staging, target):
    if role in {'legacy', 'cosmetics'} and target.suffix == '.es3':
        wait()
    return original_bound_replace(directory, staging, target)

saves.load_discovered_save = load
cosmetics._load_meta_save = meta
Path.replace = replace
SaveDirectory.replace = bound_replace
HealthTransaction.verified = verified
if role == 'prepare':
    result = prepare_health(save, fingerprint, changes, operation, root,
        game_status_loader=stopped, remember_intent=True)
elif role == 'health':
    result = write_health(save, fingerprint, changes, operation, root,
        game_status_loader=stopped, reserved=True)
elif role == 'cosmetics':
    catalog = tuple(InstalledCosmeticMetadata(i, f'Cosmetic {i}', 0, 0, 1) for i in range(2))
    result = cosmetics.save_cosmetics(fingerprint,
        [{'feature':'cosmetics','entity':'known','field':'unlockAll','after':True}], root,
        game_status_loader=stopped, catalog_loader=lambda: catalog)
else:
    result = saves.save_changes(save, fingerprint,
        [{'feature':'run','entity':'run','field':'currency','after':int(sys.argv[5])}], root,
        game_status_loader=stopped)
print(json.dumps({'result':result,'snapshot_reads':reads}))
"""


def start(root, fingerprint, role, pause=None, currency=777, operation=OP):
    return subprocess.Popen(  # noqa: S603 -- fixed interpreter/script and synthetic fixture arguments.
        [
            PYTHON,
            "-B",
            "-c",
            WORKER,
            role,
            str(root),
            fingerprint,
            str(pause or "-"),
            str(currency),
            operation,
        ],
        cwd=PROJECT,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def finish(process, *, release=False):
    try:
        stdout, stderr = process.communicate(input=b"\n" if release else None, timeout=15)
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)
    assert process.returncode == 0, stderr.decode()
    assert stderr == b""
    return json.loads(stdout)


def wait_for_commit(process, marker):
    deadline = time.monotonic() + 10
    while not marker.exists():
        assert process.poll() is None, process.communicate()
        assert time.monotonic() < deadline, "writer did not reach commit"
        time.sleep(0.01)


@pytest.fixture
def fixture(tmp_path, sample_save):
    root = tmp_path / "semiwork/Repo/saves"
    path = root / SAVE / f"{SAVE}.es3"
    SaveRepository(root).save_as(path, sample_save)
    return root, path, sha256(path.read_bytes()).hexdigest()


def test_pre_admitted_legacy_writer_cannot_overlap_health_acknowledgement(fixture, tmp_path):
    root, path, fingerprint = fixture
    marker = tmp_path / "legacy-commit"
    legacy = start(root, fingerprint, "legacy", marker)
    try:
        wait_for_commit(legacy, marker)
        preparation = finish(start(root, fingerprint, "prepare"))["result"]["transaction"]
        assert preparation["status"] == "rejected"
        assert preparation["reason"] == "write_busy"
        assert not list(path.parent.glob("*.json"))
        contender = finish(start(root, fingerprint, "legacy"))
        assert contender["result"]["error"]["code"] == "save_stale"
        assert contender["snapshot_reads"] == 0
        assert finish(legacy, release=True)["result"]["ok"] is True
    finally:
        if legacy.poll() is None:
            legacy.kill()
            legacy.communicate(timeout=5)
    after_legacy = path.read_bytes()
    fresh = sha256(after_legacy).hexdigest()
    assert finish(start(root, fresh, "prepare"))["result"]["transaction"]["status"] == "prepared"
    assert finish(start(root, fresh, "health"))["result"]["transaction"]["status"] == "applied"
    assert recover_health(SAVE, OP, root)["transaction"]["status"] == "applied"
    assert health_state(SAVE, root)["state"] == "idle"
    assert finish(start(root, fingerprint, "legacy"))["result"]["error"]["code"] == "save_stale"
    data = SaveRepository.load(path)["dictionaryOfDictionaries"]["value"]
    assert data["playerHealth"]["111"] == 17
    assert data["runStats"]["currency"] == 777
    assert next(path.parent.glob("*.bak-health-*")).read_bytes() == after_legacy


def test_health_writer_blocks_ordinary_snapshot_until_reconciliation(fixture, tmp_path):
    root, path, fingerprint = fixture
    assert (
        finish(start(root, fingerprint, "prepare"))["result"]["transaction"]["status"] == "prepared"
    )
    marker = tmp_path / "health-commit"
    writer = start(root, fingerprint, "health", marker)
    try:
        wait_for_commit(writer, marker)
        contender = finish(start(root, fingerprint, "legacy"))
        assert contender["result"]["error"]["code"] == "save_stale"
        assert contender["snapshot_reads"] == 0
        other_host = finish(start(root, fingerprint, "health", operation="b" * 32))
        assert other_host["result"]["transaction"]["status"] == "rejected"
        assert other_host["result"]["transaction"]["reason"] == "write_busy"
        assert other_host["snapshot_reads"] == 0
        assert finish(writer, release=True)["result"]["transaction"]["status"] == "applied"
    finally:
        if writer.poll() is None:
            writer.kill()
            writer.communicate(timeout=5)
    current = sha256(path.read_bytes()).hexdigest()
    assert finish(start(root, current, "legacy"))["result"]["error"]["code"] == "save_stale"
    assert recover_health(SAVE, OP, root)["transaction"]["status"] == "applied"
    assert finish(start(root, current, "legacy"))["result"]["ok"] is True
    assert (
        SaveRepository.load(path)["dictionaryOfDictionaries"]["value"]["playerHealth"]["111"] == 17
    )


def test_writer_exit_releases_lock_and_stale_snapshots_still_reject(fixture, tmp_path):
    root, path, fingerprint = fixture
    before = path.read_bytes()
    marker = tmp_path / "abandoned-commit"
    writer = start(root, fingerprint, "legacy", marker)
    try:
        wait_for_commit(writer, marker)
    finally:
        writer.kill()
        writer.communicate(timeout=5)
    assert path.read_bytes() == before
    assert next(path.parent.glob("*.bak-*")).read_bytes() == before
    assert finish(start(root, fingerprint, "legacy"))["result"]["ok"] is True
    assert (
        finish(start(root, fingerprint, "legacy", currency=888))["result"]["error"]["code"]
        == "save_stale"
    )
    fresh = sha256(path.read_bytes()).hexdigest()
    assert finish(start(root, fresh, "legacy", currency=888))["result"]["ok"] is True
    assert (
        SaveRepository.load(path)["dictionaryOfDictionaries"]["value"]["runStats"]["currency"]
        == 888
    )


def test_cosmetic_writers_share_the_snapshot_and_commit_lock(tmp_path):
    root = tmp_path / "Repo/saves"
    path = root.parent / "MetaSave.es3"
    data = json.loads((PROJECT / "desktop/e2e/fixtures/meta-save.json").read_text())
    EncryptedSaveRepository(root.parent, validate_meta_save).save_as(path, data)
    before = path.read_bytes()
    fingerprint = sha256(before).hexdigest()
    marker = tmp_path / "meta-commit"
    writer = start(root, fingerprint, "cosmetics", marker)
    try:
        wait_for_commit(writer, marker)
        contender = finish(start(root, fingerprint, "cosmetics"))
        assert contender["result"]["error"]["code"] == "save_stale"
        assert contender["snapshot_reads"] == 0
        assert finish(writer, release=True)["result"]["ok"] is True
    finally:
        if writer.poll() is None:
            writer.kill()
            writer.communicate(timeout=5)
    assert next(path.parent.glob("*.bak-*")).read_bytes() == before
    assert finish(start(root, fingerprint, "cosmetics"))["result"]["error"]["code"] == "save_stale"
