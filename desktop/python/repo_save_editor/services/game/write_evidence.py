"""Source fingerprints from the maintainer gameplay acceptance of Steam build 26732417."""

import os
from hashlib import sha256
from pathlib import Path
from typing import Final

from repo_save_editor.services.game.installed_build import owned_file

APPROVED_RUN_DOMAINS: Final = frozenset({"health", "upgrades", "run"})
GAMEPLAY_PINS: Final = (
    "f451e440ab57306bdad394161dc51abb6f651d08f6a12a46af59d8f9cb7b4acb",
    "cda4c3f576b0be97424dc66c99664b8df27a7bc455a6349b51853b306ea5c7f1",
    "98a0fedcdf70fc47fa49257bf8aab80955d9b947717d236bceb9da6fd44f4d40",
    "e57c92a01999eea97e58cf570cc36fecddedc9f0fb981e88ddc7a960651f9d31",
)
RECHARGE_UNITY: Final = "6000.3.28f1"
RECHARGE_SOURCES: Final = (
    (
        "REPO_Data/resources.assets",
        "be85ad6d88bf8426b390b14e83477dcee00627ac25f6589007830cc618413cb0",
    ),
    (
        "REPO_Data/globalgamemanagers.assets",
        "5b2fb71cfff84ac29b776671c0f22055bc9ecc138637cc1d4ae2cdb7c93415be",
    ),
)
RECHARGE_IDENTITIES: Final = (
    "Item Cart Cannon",
    "Item Cart Laser",
    "Item Drone Feather",
    "Item Drone Indestructible",
    "Item Drone Torque",
    "Item Drone Zero Gravity",
    "Item Extraction Tracker",
    "Item Gun Handgun",
    "Item Gun Laser",
    "Item Gun Shockwave",
    "Item Gun Shotgun",
    "Item Gun Stun",
    "Item Gun Tranq",
    "Item Leaf Blower",
    "Item Melee Baseball Bat",
    "Item Melee Frying Pan",
    "Item Melee Inflatable Hammer",
    "Item Melee Sledge Hammer",
    "Item Melee Stun Baton",
    "Item Melee Sword",
    "Item Orb Zero Gravity",
    "Item Phase Bridge",
    "Item Rubber Duck",
    "Item Staff Torque",
    "Item Staff Void",
    "Item Staff Zero Gravity",
    "Item Valuable Tracker",
    "Item Vehicle Semiscooter",
    "Item Vehicle Semiscooter Small",
)
COSMETIC_SOURCES: Final = (
    ("REPO_Data/level0", "8f0612738e51234ac07a4a41aeb7620ca4df925a094a71d7c79dc3e6078eb560"),
    (
        "REPO_Data/globalgamemanagers.assets",
        "5b2fb71cfff84ac29b776671c0f22055bc9ecc138637cc1d4ae2cdb7c93415be",
    ),
    (
        "REPO_Data/sharedassets0.assets",
        "13dcaef6f17c53a43e30229ef3ded5da74f20ae21d9a5a3de2edaeb424ef0902",
    ),
)
COSMETIC_CATALOG_DIGEST: Final = "a6efecc662a549a2704a6684a87af0d806172e28b4f4ab071fbe02b9397fa779"
SAVE_FORMAT_PINS: Final = (
    "4a5779c413fcf61c389d1560265e740341e492f234743f4802364ec800454296",
    "6ae62e082dc494a2433984177f60ca4db5fae69b1f360a8b33754172b310b8c5",
    "37112a6105aa0540579d49745a57d2dcc2148246feecd18a72fe8adee7ab38cb",
    "4492e20b232e35e43646d4ad4b3d7c59974605f58bf49dc771887be050312575",
    "c839a303a89f5f0f4b8aa7236cfe651f1fa2e51ced2bc483eeeaf5c347423b08",
    "6f9aadb7221efabd8d35f66b2e4a8ae625b021e77988e6c745703fda567a1dd2",
    "5776169973a26a387b8b3e5c0f2301a7ab9a6dd7c7d3efa22a96abc47fbf8662",
    "ee950004b576fb28dc85f4b0435ed04bf96612de2e8b53be84d07afe85a0de6c",
)


def source_digest(root: Path, path: Path, *, max_bytes: int = 256 * 1024 * 1024) -> str:
    source = owned_file(root, path)
    with source.open("rb") as stream:
        before = os.fstat(stream.fileno())
        if before.st_size > max_bytes:
            raise ValueError("Installed game source exceeds its hash budget.")
        hashed = sha256()
        remaining = before.st_size
        while remaining:
            chunk = stream.read(min(65536, remaining))
            if not chunk:
                raise ValueError("Installed game source was truncated.")
            hashed.update(chunk)
            remaining -= len(chunk)
        if stream.read(1):
            raise ValueError("Installed game source grew.")
        after = owned_file(root, path).stat()
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
        ):
            raise ValueError("Installed game source changed.")
    return hashed.hexdigest()


def source_pins_match(root: Path, pins: tuple[tuple[str, str], ...]) -> bool:
    try:
        return bool(pins) and all(
            source_digest(root, root / name, max_bytes=512 * 1024 * 1024) == digest
            for name, digest in pins
        )
    except (OSError, ValueError):
        return False
