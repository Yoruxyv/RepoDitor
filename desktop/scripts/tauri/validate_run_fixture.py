"""Check one explicitly supplied disposable Run save and its export provenance."""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta
from hashlib import sha256
from pathlib import Path, PureWindowsPath
from re import fullmatch
from typing import BinaryIO

from repo_save_editor.core.crypto import SaveCryptoError
from repo_save_editor.core.save_resources import SaveResourceError, hash_encrypted, read_encrypted
from repo_save_editor.core.schema import (
    SAVE_INT32_MAX,
    SaveSchemaError,
    get_dictionaries,
    get_typed_value,
)
from repo_save_editor.core.types import SaveData
from repo_save_editor.services.game.discovery import APP_MANIFEST_NAME, STEAM_APP_ID
from repo_save_editor.services.game.installed_build import artwork_assembly_sha256, owned_file
from repo_save_editor.services.saves.discovery import SAVE_SLOT_PATTERN, SAVE_SLOT_TIMESTAMP_FORMAT
from repo_save_editor.storage.repository import SaveRepository

INTAKE_ROOT = Path(__file__).resolve().parents[2] / "build/w6-d1b-authentic"
BUILD_ID = "26407089"
# Binary digests independently recorded during W6-D1b installed-build validation.
REVIEWED_DIGESTS = {
    "REPO.exe": "d55398437cca91830809d5870f9ba5642627673eb9265b756307c54f8857048f",
    "UnityPlayer.dll": "b3938532fd45862e2683be7bfd9a7af6c238330c5b0c1b88470eef8840026644",
    "REPO_Data\\Managed\\Assembly-CSharp.dll": artwork_assembly_sha256(BUILD_ID),
    "REPO_Data\\globalgamemanagers": "0f4db5f1f0b1485f973ab7fc073143ec74d7cec32a230c54361f79747c149481",
}
PROVENANCE_LIMIT = 16 * 1024
PROVENANCE_FIELDS = {
    "appId",
    "buildId",
    "installedFileSha256",
    "generationProcedure",
    "capturedUtc",
    "originalFile",
    "guestCopy",
    "intendedHostCopy",
    "encryptedSha256",
}
MESSAGES = {
    "usage": "Supply the disposable .es3 path and its provenance.json path.",
    "outside_intake": "Use the designated intake directory, its saves/<slot>/<slot>.es3 layout, and provenance.json.",
    "fixture_missing": "Place the encrypted export at the supplied slot location.",
    "provenance_missing": "Supply the provenance.json generated during export.",
    "unsafe_input": "Use an ordinary local file with a single link and a stable file identity.",
    "invalid_provenance": "Regenerate the export record with the documented fields and paths.",
    "unsupported_build": "The recorded Steam app or build is outside the reviewed validation scope.",
    "build_digest_mismatch": "Compare the export's installed binary digests to the reviewed build before retrying.",
    "fixture_digest_mismatch": "Verify the encrypted copy against the export SHA-256 before retrying.",
    "malformed_encrypted": "Check that the export is an intact encrypted Run save.",
    "unsupported_run_schema": "The encrypted data opened but its Run schema is unsupported.",
    "unsupported_health": "The Run opened but the roster or raw Health fields are unsupported.",
    "resource_limit": "The supplied save exceeds the existing parser's safe resource limits.",
    "input_changed": "The fixture changed during validation. Re-export it from the closed game.",
    "verification_unavailable": "Recheck read access and fixture stability before retrying.",
}


class FixtureValidationError(ValueError):
    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(MESSAGES[reason])


def identity(info: os.stat_result) -> tuple[int, int, int, int]:
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


@contextmanager
def open_input(root: Path, path: Path, missing: str) -> Iterator[BinaryIO]:
    try:
        expected = owned_file(root, path).lstat()
    except FileNotFoundError as exc:
        raise FixtureValidationError(missing) from exc
    except ValueError as exc:
        raise FixtureValidationError("unsafe_input") from exc

    with path.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        try:
            current = owned_file(root, path).lstat()
        except (OSError, ValueError) as exc:
            raise FixtureValidationError("unsafe_input") from exc
        if (
            opened.st_nlink != 1
            or identity(opened) != identity(expected)
            or identity(opened) != identity(current)
        ):
            raise FixtureValidationError("unsafe_input")
        yield stream


def check_layout(root: Path, fixture: Path, provenance: Path) -> None:
    slot = SAVE_SLOT_PATTERN.fullmatch(fixture.parent.name)
    if (
        slot is None
        or not fixture.parent.name.isascii()
        or fixture != root / "saves" / fixture.parent.name / f"{fixture.parent.name}.es3"
        or provenance != root / "provenance.json"
    ):
        raise FixtureValidationError("outside_intake")
    try:
        datetime.strptime(slot["timestamp"], SAVE_SLOT_TIMESTAMP_FORMAT)  # noqa: DTZ007 -- validate slot format only.
    except ValueError as exc:
        raise FixtureValidationError("outside_intake") from exc


def unique_fields(pairs: list[tuple[str, object]]) -> dict[str, object]:
    fields = dict(pairs)
    if len(fields) != len(pairs):
        raise FixtureValidationError("invalid_provenance")
    return fields


def is_digest(value: object) -> bool:
    return isinstance(value, str) and fullmatch(r"[0-9a-fA-F]{64}", value) is not None


def provenance_digest(stream: BinaryIO, fixture: Path) -> str:
    raw = stream.read(PROVENANCE_LIMIT + 1)
    if len(raw) > PROVENANCE_LIMIT:
        raise FixtureValidationError("invalid_provenance")
    try:
        record = json.loads(raw, object_pairs_hook=unique_fields)
    except (ValueError, RecursionError) as exc:
        raise FixtureValidationError("invalid_provenance") from exc
    if not isinstance(record, dict) or record.keys() != PROVENANCE_FIELDS:
        raise FixtureValidationError("invalid_provenance")
    if any(
        not isinstance(record[key], str) or not record[key].strip()
        for key in PROVENANCE_FIELDS - {"installedFileSha256"}
    ):
        raise FixtureValidationError("invalid_provenance")
    if record["appId"] != STEAM_APP_ID or record["buildId"] != BUILD_ID:
        raise FixtureValidationError("unsupported_build")

    digests = record["installedFileSha256"]
    if (
        not isinstance(digests, dict)
        or digests.keys() != REVIEWED_DIGESTS.keys() | {APP_MANIFEST_NAME}
        or not all(is_digest(value) for value in digests.values())
        or not is_digest(record["encryptedSha256"])
    ):
        raise FixtureValidationError("invalid_provenance")
    if any(digests[name].lower() != expected for name, expected in REVIEWED_DIGESTS.items()):
        raise FixtureValidationError("build_digest_mismatch")

    try:
        captured = datetime.fromisoformat(record["capturedUtc"])
    except ValueError as exc:
        raise FixtureValidationError("invalid_provenance") from exc
    original = PureWindowsPath(record["originalFile"])
    exported = PureWindowsPath(record["guestCopy"])
    slot_path = ("saves", fixture.parent.name, fixture.name)
    if (
        captured.utcoffset() != timedelta(0)
        or Path(record["intendedHostCopy"]) != fixture
        or original == exported
        or not (original.is_absolute() and exported.is_absolute())
        or original.parts[-7:] != ("AppData", "LocalLow", "semiwork", "Repo", *slot_path)
        or exported.parts[-3:] != slot_path
    ):
        raise FixtureValidationError("invalid_provenance")
    return str(record["encryptedSha256"]).lower()


def inspect_health(data: SaveData) -> dict[str, int | None]:
    roster = get_typed_value(data, "playerNames")
    dictionaries = get_dictionaries(data)
    if not roster or any(
        fullmatch(r"[0-9]{1,20}", key) is None or not isinstance(name, str)
        for key, name in roster.items()
    ):
        raise FixtureValidationError("unsupported_health")
    counts: dict[str, int | None] = {"playerCount": len(roster)}
    for key in ("playerHealth", "playerUpgradeHealth"):
        count_key = f"{key}Entries"
        if key == "playerUpgradeHealth" and key not in dictionaries:
            counts[count_key] = None
            continue
        values = dictionaries.get(key)
        if (
            not isinstance(values, dict)
            or any(
                fullmatch(r"[0-9]{1,20}", player_id) is None
                or type(value) is not int
                or not 0 <= value <= SAVE_INT32_MAX
                for player_id, value in values.items()
            )
            or (key == "playerHealth" and not roster.keys() <= values.keys())
        ):
            raise FixtureValidationError("unsupported_health")
        counts[count_key] = len(values)
    return counts


def validate_fixture(root: Path, fixture: Path, provenance: Path) -> dict[str, object]:
    check_layout(root, fixture, provenance)
    with open_input(root, provenance, "provenance_missing") as stream:
        expected_digest = provenance_digest(stream, fixture)
    with open_input(root, fixture, "fixture_missing") as stream:
        original = identity(os.fstat(stream.fileno()))
        encrypted = read_encrypted(stream)
        if identity(os.fstat(stream.fileno())) != original:
            raise FixtureValidationError("input_changed")
    if sha256(encrypted).hexdigest() != expected_digest:
        raise FixtureValidationError("fixture_digest_mismatch")

    try:
        counts = inspect_health(SaveRepository.load_bytes(encrypted))
    except SaveCryptoError as exc:
        raise FixtureValidationError("malformed_encrypted") from exc
    except SaveSchemaError as exc:
        raise FixtureValidationError("unsupported_run_schema") from exc
    finally:
        with open_input(root, fixture, "fixture_missing") as stream:
            if (
                original != identity(os.fstat(stream.fileno()))
                or hash_encrypted(stream) != expected_digest
            ):
                raise FixtureValidationError("input_changed")
            if original != identity(os.fstat(stream.fileno())):
                raise FixtureValidationError("input_changed")

    return {
        "status": "read_only_pass",
        "buildId": BUILD_ID,
        "installedEvidence": "reviewed_binary_digests_match",
        "generationEvidence": "operator_record",
        "encryptedInputUnchanged": True,
        "healthWriteCompatibility": "unsupported",
        "healthFieldRepresentation": "nonnegative_int32",
        **counts,
    }


def main(args: list[str]) -> int:
    if args == ["--help"]:
        sys.stdout.write(
            "Usage: validate_run_fixture.py <disposable .es3> <provenance.json>\n"
            "Both inputs must be under desktop/build/w6-d1b-authentic.\n"
        )
        return 0
    try:
        if len(args) != 2:
            raise FixtureValidationError("usage")
        output = validate_fixture(INTAKE_ROOT, Path(args[0]).absolute(), Path(args[1]).absolute())
    except (FixtureValidationError, OSError, SaveResourceError) as exc:
        if isinstance(exc, FixtureValidationError):
            reason = exc.reason
        else:
            reason = (
                "resource_limit"
                if isinstance(exc, SaveResourceError)
                else "verification_unavailable"
            )
        sys.stdout.write(
            json.dumps({"status": "blocked", "reason": reason, "message": MESSAGES[reason]}) + "\n"
        )
        return 1
    sys.stdout.write(json.dumps(output) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
