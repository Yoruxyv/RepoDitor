"""Prepare and sign one reviewed private Health edit for the local candidate."""

from __future__ import annotations

import argparse
import base64
import json
import os
import stat
import sys
from contextlib import suppress
from hashlib import sha256
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from validate_run_fixture import (
    BUILD_ID,
    INTAKE_ROOT,
    REVIEWED_DIGESTS,
    open_input,
    provenance_digest,
    validate_fixture,
)

from repo_save_editor.core.save_resources import read_encrypted
from repo_save_editor.core.schema import get_dictionaries
from repo_save_editor.core.types import SaveData
from repo_save_editor.desktop_api.transactions.production_health import (
    _installed_game,
    _process_status,
    _source_pins,
)
from repo_save_editor.services.game.processes import GameProcessStatus
from repo_save_editor.services.player.state import get_player_max_health, get_players
from repo_save_editor.services.saves.discovery import SAVE_SLOT_PATTERN, get_default_save_root
from repo_save_editor.storage.health_recovery import HealthTransaction, _snapshot, health_lock
from repo_save_editor.storage.repository import SaveRepository
from repo_save_editor.storage.windows_save_directory import SaveDirectory

BUNDLE = INTAKE_ROOT.with_name("w6-private-health")
LOW = BUNDLE / "profile/AppData/LocalLow"
LIVE_BUNDLE = BUNDLE.with_name("w6-private-live-health")


def create_slot_parent(parent: Path) -> None:
    # Check each fixed descendant before creating the next, then open it with SaveDirectory.
    with SaveDirectory(BUNDLE / "approval.json"):
        cursor = BUNDLE
        for part in parent.relative_to(BUNDLE).parts:
            cursor /= part
            with suppress(FileExistsError):
                cursor.mkdir()
            info = cursor.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_file_attributes & 0x400:
                raise ValueError(
                    "The private profile contains a redirected or unsupported directory."
                )


def reviewed_health(data: SaveData, player: str, value: int) -> int:
    selected = next((entry for entry in get_players(data) if entry.player_id == player), None)
    if selected is None:
        raise ValueError("Confirm a player ID present in this Run.")
    values = get_dictionaries(data).get("playerHealth", {})
    before = values.get(player) if isinstance(values, dict) else None
    if (
        type(before) is not int
        or not 0 <= value <= get_player_max_health(data, player)
        or value == before
    ):
        raise ValueError("Choose a different Health value within this player's allowed range.")
    return before


def propose(fixture: Path, provenance: Path, player: str, value: int) -> None:
    validate_fixture(INTAKE_ROOT, fixture, provenance)
    with open_input(INTAKE_ROOT, fixture, "fixture_missing") as stream:
        source = read_encrypted(stream)
    with open_input(INTAKE_ROOT, provenance, "provenance_missing") as stream:
        if sha256(source).hexdigest() != provenance_digest(stream, fixture):
            raise ValueError("The export changed during intake.")
    data = SaveRepository.load_bytes(source)
    before = reviewed_health(data, player, value)
    save = fixture.parent.name
    target = LOW / "semiwork/Repo/saves" / save / fixture.name
    create_slot_parent(target.parent)
    with SaveDirectory(target) as directory, directory.open(target, "xb") as stream:
        stream.write(source)
        stream.flush()
        os.fsync(stream.fileno())
    with health_lock(target) as directory:
        if directory is None:
            raise ValueError("An ordinary local Windows NTFS slot is required.")
        transaction = HealthTransaction(target, "0" * 32, directory=directory)
        transaction.admit()
        fingerprint, identity = _snapshot(target, directory)
        if fingerprint != sha256(source).hexdigest():
            raise ValueError("The working copy failed its independent hash check.")
        record = {
            "version": 1,
            "build": BUILD_ID,
            "save": save,
            "fingerprint": fingerprint,
            "identity": identity,
            "namespace": transaction.namespace(),
            "edit": {"playerId": player, "before": before, "value": value},
        }
    write_proposal(BUNDLE, record)


def write_proposal(bundle: Path, record: dict[str, object]) -> None:
    proposal = bundle / "operator/proposal.json"
    payload = json.dumps(record, sort_keys=True, indent=2).encode()
    with SaveDirectory(proposal) as directory, directory.open(proposal, "xb") as output:
        output.write(payload)
    sys.stdout.write(payload.decode() + "\n")
    sys.stdout.write(f"Review SHA-256: {sha256(payload).hexdigest()}\n")


def existing_target(path: Path) -> Path:
    root = get_default_save_root()
    save = path.parent.name
    if (
        root is None
        or not path.is_absolute()
        or SAVE_SLOT_PATTERN.fullmatch(save) is None
        or not save.isascii()
        or path != root / save / f"{save}.es3"
    ):
        raise ValueError("Select the exact slot file from your Windows R.E.P.O. saves folder.")
    return root / save / f"{save}.es3"


def check_installed_build() -> None:
    game, build = _installed_game()
    if build.build_id != BUILD_ID or _source_pins(game, build) != tuple(REVIEWED_DIGESTS.values()):
        raise ValueError("The installed Steam build differs from the reviewed private build.")
    if _process_status(game.root / "REPO.exe") is not GameProcessStatus.NOT_RUNNING:
        raise ValueError("Close R.E.P.O. and confirm Windows can verify the game is closed.")


def propose_existing(path: Path, player: str, value: int) -> None:
    target = existing_target(path)
    check_installed_build()
    with SaveDirectory(target) as directory, directory.open(target) as stream:
        identity = directory.file_identity(stream)
        source = read_encrypted(stream)
        fingerprint = sha256(source).hexdigest()
        if directory.snapshot(target) != (fingerprint, identity):
            raise ValueError("The selected save changed during review.")
        before = reviewed_health(SaveRepository.load_bytes(source), player, value)
        record = {
            "version": 2,
            "build": BUILD_ID,
            "save": target.parent.name,
            "existingPath": str(target),
            "fingerprint": fingerprint,
            "identity": identity,
            "namespace": directory.identity,
            "edit": {"playerId": player, "before": before, "value": value},
        }
    write_proposal(LIVE_BUNDLE, record)


def sign(reviewed_sha256: str, *, existing: bool = False) -> None:
    bundle = LIVE_BUNDLE if existing else BUNDLE
    proposal = bundle / "operator/proposal.json"
    with SaveDirectory(proposal) as local, local.open(proposal) as stream:
        payload = stream.read(3073)
    if len(payload) > 3072 or sha256(payload).hexdigest() != reviewed_sha256:
        raise ValueError("The proposal differs from the exact reviewed record.")
    record = json.loads(payload)
    target = signing_target(record, existing=existing)
    with SaveDirectory(target) as directory:
        if directory.identity != record["namespace"] or directory.snapshot(target) != (
            record["fingerprint"],
            record["identity"],
        ):
            raise ValueError("The reviewed file identity or bytes changed.")
        # Signing does not create a lock file or receipt beside the selected save.
        key_path = bundle / "operator/ed25519.key"
        with SaveDirectory(key_path) as local, local.open(key_path) as stream:
            key = Ed25519PrivateKey.from_private_bytes(stream.read(33))
        envelope = {
            "payload": base64.b64encode(payload).decode("ascii"),
            "signature": base64.b64encode(key.sign(payload)).decode("ascii"),
        }
        ticket = bundle / "approval.json"
        with SaveDirectory(ticket) as local, local.open(ticket, "xb") as stream:
            stream.write(json.dumps(envelope).encode())
            stream.flush()
            os.fsync(stream.fileno())
    sys.stdout.write("Installed one signed private Health approval.\n")


def signing_target(record: dict, *, existing: bool) -> Path:
    save = record["save"]
    if SAVE_SLOT_PATTERN.fullmatch(save) is None or not save.isascii():
        raise ValueError("The proposal names an invalid slot.")
    if existing:
        check_installed_build()
        return existing_target(Path(record["existingPath"]))
    return LOW / "semiwork/Repo/saves" / save / f"{save}.es3"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    proposal = commands.add_parser("propose")
    proposal.add_argument("fixture", type=Path)
    proposal.add_argument("provenance", type=Path)
    proposal.add_argument("player_id")
    proposal.add_argument("new_health", type=int)
    live = commands.add_parser("propose-existing")
    live.add_argument("save_path", type=Path)
    live.add_argument("player_id")
    live.add_argument("new_health", type=int)
    commands.add_parser("sign").add_argument("reviewed_sha256")
    commands.add_parser("sign-existing").add_argument("reviewed_sha256")
    args = parser.parse_args()
    if args.action == "propose":
        propose(
            args.fixture.absolute(), args.provenance.absolute(), args.player_id, args.new_health
        )
    elif args.action == "propose-existing":
        propose_existing(args.save_path, args.player_id, args.new_health)
    else:
        sign(args.reviewed_sha256, existing=args.action == "sign-existing")


if __name__ == "__main__":
    main()
