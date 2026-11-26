"""Compare the reviewed Unity launcher independently of two PE metadata fields."""

from hashlib import sha256
from pathlib import Path
from struct import unpack_from

from repo_save_editor.services.game.installed_build import owned_file

# Both gameplay-reviewed builds use the same launcher image.
_REVIEWED_LAUNCHER = "9a2162d7150bdab3441411201e18bf12fb2b4ae9cd4aa65b73b7d736874911d1"
_MAX_LAUNCHER_BYTES = 2 * 1024 * 1024


def launcher_contract(raw: bytes) -> str | None:
    """Hash the full x64 PE image with the COFF timestamp and checksum cleared."""
    data = bytearray(raw)
    if not 64 <= len(data) <= _MAX_LAUNCHER_BYTES or data[:2] != b"MZ":
        return None
    offset = unpack_from("<I", data, 60)[0]
    optional = offset + 24
    if offset < 64 or optional + 68 > len(data):
        return None
    if data[offset : offset + 6] != b"PE\0\0\x64\x86":
        return None
    optional_size = unpack_from("<H", data, offset + 20)[0]
    if (
        not 68 <= optional_size <= len(data) - optional
        or data[optional : optional + 2] != b"\x0b\x02"
    ):
        return None
    data[offset + 8 : offset + 12] = bytes(4)
    data[optional + 64 : optional + 68] = bytes(4)
    return sha256(data).hexdigest()


def matches_reviewed_launcher(root: Path, expected: str) -> bool:
    """Accept metadata-only variations of the independently reviewed launcher."""
    with owned_file(root, root / "REPO.exe").open("rb") as file:
        data = file.read(_MAX_LAUNCHER_BYTES + 1)
    return sha256(data).hexdigest() == expected and launcher_contract(data) == _REVIEWED_LAUNCHER
