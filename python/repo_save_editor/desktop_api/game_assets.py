"""Structured game-art preparation records for the trusted Electron process."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import BinaryIO, Final

from repo_save_editor.desktop_api.icons import serialize_upgrade_texture
from repo_save_editor.services.game.discovery import discover_game_installation
from repo_save_editor.services.game.installed_build import validated_installed_build
from repo_save_editor.services.player.upgrade_textures import (
    MAX_BATCH_UPGRADES,
    DecodedUpgradeTexture,
    UpgradePreparationStage,
    UpgradeTextureError,
    prepare_installed_upgrade_textures,
    validate_upgrade_texture_key,
)

MAX_PREPARATION_PAYLOAD_BYTES: Final = 64 * 1024
PreparationEmitter = Callable[[dict[str, object]], None]


def parse_upgrade_keys_payload(payload: str) -> tuple[str, ...]:
    """Parse one bounded JSON array of dynamic upgrade identities."""
    if not isinstance(payload, str) or len(payload.encode("utf-8")) > MAX_PREPARATION_PAYLOAD_BYTES:
        raise UpgradeTextureError("Upgrade preparation payload exceeds the supported bound.")
    try:
        value = json.loads(payload)
    except json.JSONDecodeError as error:
        raise UpgradeTextureError("Upgrade preparation payload is invalid JSON.") from error
    if not isinstance(value, list) or len(value) > MAX_BATCH_UPGRADES:
        raise UpgradeTextureError("Upgrade preparation payload is outside the supported bound.")
    if any(not isinstance(key, str) for key in value):
        raise UpgradeTextureError("Upgrade preparation identities are malformed.")
    keys = tuple(dict.fromkeys(value))
    for key in keys:
        validate_upgrade_texture_key(key)
    return keys


def read_upgrade_keys_stdin(stream: BinaryIO) -> tuple[str, ...]:
    """Read exactly one bounded UTF-8 JSON batch request from a binary stdin stream."""
    raw = stream.read(MAX_PREPARATION_PAYLOAD_BYTES + 1)
    if len(raw) > MAX_PREPARATION_PAYLOAD_BYTES:
        raise UpgradeTextureError("Upgrade preparation payload exceeds the supported bound.")
    try:
        payload = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise UpgradeTextureError("Upgrade preparation payload is not valid UTF-8.") from error
    return parse_upgrade_keys_payload(payload)


def prepare_game_assets(upgrade_keys: tuple[str, ...], emit: PreparationEmitter) -> None:
    """Emit real progress while preparing one bounded dynamic upgrade set."""
    completed = 0
    total = len(upgrade_keys)
    failures = 0

    def emit_progress(
        stage: UpgradePreparationStage,
        installation_found: bool,
        build_verified: bool,
        current_asset: str | None = None,
    ) -> None:
        emit(
            {
                "type": "progress",
                "stage": stage.value,
                "installationFound": installation_found,
                "buildVerified": build_verified,
                "completed": completed if total else None,
                "total": total if total else None,
                "currentAsset": current_asset,
                "degraded": False,
            }
        )

    def emit_decode_start(_key: str, texture_name: str) -> None:
        emit_progress(
            UpgradePreparationStage.DECODING,
            True,
            True,
            texture_name,
        )

    def emit_texture(key: str, decoded: DecodedUpgradeTexture | None) -> None:
        nonlocal completed, failures
        completed += 1
        if decoded is None:
            failures += 1
        emit(
            {
                "type": "texture",
                "upgradeKey": key,
                "texture": None if decoded is None else serialize_upgrade_texture(decoded),
                "completed": completed,
                "total": total,
            }
        )

    if total == 0:
        emit_progress(UpgradePreparationStage.DISCOVERING, False, False)
    discovery = discover_game_installation()
    installation = discovery.installation
    if installation is None:
        completed = total
        emit(
            {
                "type": "final",
                "ok": True,
                "installationFound": False,
                "buildVerified": False,
                "completed": completed if total else None,
                "total": total if total else None,
                "degraded": True,
            }
        )
        return

    if total == 0:
        emit_progress(UpgradePreparationStage.VALIDATING, True, False)
    build = validated_installed_build(installation)
    if build is None:
        completed = total
        emit(
            {
                "type": "final",
                "ok": True,
                "installationFound": True,
                "buildVerified": False,
                "completed": completed if total else None,
                "total": total if total else None,
                "degraded": True,
            }
        )
        return

    if total == 0:
        emit(
            {
                "type": "final",
                "ok": True,
                "installationFound": True,
                "buildVerified": True,
                "completed": None,
                "total": None,
                "degraded": False,
            }
        )
        return

    result = prepare_installed_upgrade_textures(
        upgrade_keys,
        installation,
        build,
        on_stage=emit_progress,
        on_texture=emit_texture,
        on_decode_start=emit_decode_start,
    )
    if total and completed < total:
        failures += total - completed
        completed = total

    degraded = not result.assets_ready or failures > 0
    emit(
        {
            "type": "final",
            "ok": True,
            "installationFound": True,
            "buildVerified": True,
            "completed": completed if total else None,
            "total": total if total else None,
            "degraded": degraded,
        }
    )


__all__ = [
    "MAX_PREPARATION_PAYLOAD_BYTES",
    "parse_upgrade_keys_payload",
    "prepare_game_assets",
    "read_upgrade_keys_stdin",
]
