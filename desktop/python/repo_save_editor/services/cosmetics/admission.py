"""Source-pinned disposable cosmetic admission, separate from presentation discovery."""

from __future__ import annotations

import json
import os
from hashlib import sha256
from pathlib import Path
from typing import cast

from repo_save_editor.services.cosmetics.installed_catalog import _catalog_payload
from repo_save_editor.services.cosmetics.installed_reader import read_installed_catalog
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.cosmetics.synthetic_fixture import MANIFEST, PIN
from repo_save_editor.services.game.installed_build import (
    artwork_installation,
    installed_build_identity,
    owned_file,
)


def fixture_manifest() -> dict[str, object]:
    """Verify frozen bytes against the source literal, never fixture-supplied expectations."""
    if sha256(MANIFEST).hexdigest() != PIN:
        raise ValueError("Synthetic cosmetic trust anchor mismatch.")
    return cast(dict[str, object], json.loads(MANIFEST))


def admit_cosmetics(low: Path) -> tuple[dict[str, str], tuple[InstalledCosmeticMetadata, ...]]:
    """Admit only exact generated sources beneath the isolated fixture's fixed game root."""
    if (
        not low.is_absolute()
        or low.parts[-2:] != ("AppData", "LocalLow")
        or low.resolve(strict=True) != low
    ):
        raise ValueError("Unsupported synthetic cosmetic root.")
    expected = fixture_manifest()
    home = low.parent.parent
    game = home / "SteamLibrary/steamapps/common/RepoDitor E2E Install"
    installation = artwork_installation(game)
    build = installed_build_identity(installation) if installation is not None else None
    if installation is None or build is None or build.build_id != expected["build"]:
        raise ValueError("Unsupported synthetic cosmetic build.")
    files = expected["files"]
    if not isinstance(files, dict):
        raise TypeError("Invalid synthetic cosmetic anchor.")

    def snapshot() -> list[object]:
        result: list[object] = []
        paths = [build.manifest_path, *(game / name for name in files)]
        for path in paths:
            owned_file(home, path)
            with path.open("rb") as stream:
                before = os.fstat(stream.fileno())
                blob = stream.read(1024 * 1024 + 1)
                after = os.fstat(stream.fileno())
            identity = [before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns]
            if (
                len(blob) > 1024 * 1024
                or identity != [after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns]
                or path.stat() != after
            ):
                raise ValueError("Synthetic cosmetic source changed.")
            digest = sha256(blob).hexdigest()
            if path != build.manifest_path and digest != files[path.relative_to(game).as_posix()]:
                raise ValueError("Synthetic cosmetic source mismatch.")
            result.append([str(path).casefold(), identity, digest])
        return result

    before = snapshot()
    catalog, targets = read_installed_catalog(game)
    if (
        _catalog_payload(catalog) != expected["catalog"]
        or [list(target) for target in targets] != expected["targets"]
        or snapshot() != before
        or installed_build_identity(installation) != build
    ):
        raise ValueError("Synthetic cosmetic catalog mismatch.")
    proof = {"manifest": PIN, "identity": str(expected["identity"]), "build": build.build_id}
    proof["digest"] = sha256(json.dumps([proof, before], sort_keys=True).encode()).hexdigest()
    return proof, catalog
