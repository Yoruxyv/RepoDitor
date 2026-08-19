"""Safe save opening and writing for the desktop process boundary."""

from __future__ import annotations

import contextlib
from collections.abc import Callable, Mapping
from dataclasses import replace
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from typing import cast

from repo_save_editor.core.crypto import SaveCryptoError
from repo_save_editor.core.types import SaveData
from repo_save_editor.desktop_api.game_status import GameSafetyError, require_game_closed
from repo_save_editor.desktop_api.protocol import DesktopSaveError, _failure
from repo_save_editor.desktop_api.run_save_changes import (
    apply_run_save_changes,
    requested_refill_item_types,
)
from repo_save_editor.services.game.processes import GameProcessStatus, get_game_process_status
from repo_save_editor.services.items.discovery import discover_advanced_save
from repo_save_editor.services.items.models import AdvancedSaveError, ItemRechargeCapability
from repo_save_editor.services.items.recharge_capability import (
    discover_installed_recharge_capabilities,
)
from repo_save_editor.services.items.recharge_evidence import verify_recharge_evidence
from repo_save_editor.services.player.state import get_player_health, get_players
from repo_save_editor.services.player.upgrades import discover_player_upgrades, get_player_upgrade
from repo_save_editor.services.run import get_resume_location_label, get_run_stat
from repo_save_editor.services.saves.discovery import (
    DiscoveredSave,
    SaveRootStatus,
    discover_saves,
)
from repo_save_editor.services.saves.summaries import get_save_summary
from repo_save_editor.storage.repository import (
    SaveBackupError,
    SaveRepository,
    SaveStaleError,
    SaveVerificationError,
    SaveWriteError,
)

RechargeCapabilityLoader = Callable[
    [tuple[str, ...]],
    Mapping[str, ItemRechargeCapability],
]
RechargeEvidenceVerifier = Callable[
    [object, tuple[str, ...]],
    Mapping[str, ItemRechargeCapability] | None,
]


def load_discovered_save(
    save_id: str,
    root: Path | None = None,
) -> tuple[DiscoveredSave, SaveData, bytes]:
    """Resolve and load one save previously exposed by discovery."""
    discovery = discover_saves(root)
    if discovery.status is SaveRootStatus.UNREADABLE:
        raise DesktopSaveError("backend_unavailable", "The save folder could not be read.")

    save = next((item for item in discovery.saves if item.identifier == save_id), None)
    if save is None:
        raise DesktopSaveError("save_missing", "The selected save no longer exists.")

    try:
        source = save.path.read_bytes()
        return save, SaveRepository.load_bytes(source), source
    except FileNotFoundError as exc:
        raise DesktopSaveError("save_missing", "The selected save no longer exists.") from exc
    except SaveCryptoError as exc:
        if "too small" in str(exc):
            raise DesktopSaveError("save_corrupt", "The selected save is corrupted.") from exc
        raise DesktopSaveError(
            "save_decrypt_failed", "The selected save could not be decrypted."
        ) from exc
    except ValueError as exc:
        raise DesktopSaveError(
            "save_unsupported", "The selected save format is not supported."
        ) from exc
    except OSError as exc:
        raise DesktopSaveError(
            "backend_unavailable", "The selected save could not be opened."
        ) from exc


def _fingerprint(source: bytes) -> str:
    return sha256(source).hexdigest()


def _session(save: DiscoveredSave, data: SaveData, source: bytes) -> dict[str, object]:
    summary = get_save_summary(data)
    return {
        "id": save.identifier,
        "displayName": save.display_name,
        "path": str(save.path),
        "lastModified": save.modified_at.isoformat(),
        "fingerprint": _fingerprint(source),
        "level": summary.level,
        "currency": get_run_stat(data, "currency"),
        "playerCount": len(get_players(data)),
        "resumeLocation": get_resume_location_label(data),
    }


def open_save(save_id: str, root: Path | None = None) -> dict[str, object]:
    """Resolve, decrypt, validate, and summarize one discovered save.

    Args:
        save_id: Opaque identifier previously returned by save discovery.
        root: Optional isolated discovery root used by tests.

    Returns:
        A renderer-safe operation result. Raw decrypted data never crosses this
        boundary.
    """
    try:
        save, data, source = load_discovered_save(save_id, root)
        session = _session(save, data, source)
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)

    return {
        "ok": True,
        "session": session,
        "requiredUpgradeVisualKeys": [upgrade.key for upgrade in discover_player_upgrades(data)],
    }


def _canonical_applied_state(
    data: SaveData,
    changes: object,
    fingerprint: str,
    recharge_capabilities: Mapping[str, ItemRechargeCapability],
) -> dict[str, object]:
    # Build narrow backend-authoritative state for domains changed by this successful write.
    canonical: dict[str, object] = {"fingerprint": fingerprint}
    safe_changes = cast(list[dict[str, object]], changes)

    player_changes = [change for change in safe_changes if change["feature"] == "players"]
    if player_changes:
        with contextlib.suppress(KeyError, ValueError):
            canonical["players"] = [
                {
                    "id": cast(str, change["entity"]),
                    "health": get_player_health(data, cast(str, change["entity"])),
                }
                for change in player_changes
            ]

    upgrade_changes = [change for change in safe_changes if change["feature"] == "upgrades"]
    if upgrade_changes:
        with contextlib.suppress(KeyError, ValueError):
            canonical["upgrades"] = [
                {
                    "playerId": cast(str, change["entity"]),
                    "key": cast(str, change["field"]),
                    "value": get_player_upgrade(
                        data,
                        cast(str, change["entity"]),
                        cast(str, change["field"]),
                    ),
                }
                for change in upgrade_changes
            ]

    run_changes = [change for change in safe_changes if change["feature"] == "run"]
    if run_changes:
        try:
            run_state: dict[str, object] = {
                "stats": [
                    {
                        "key": cast(str, change["field"]),
                        "value": get_run_stat(data, cast(str, change["field"])),
                    }
                    for change in run_changes
                    if change["field"] != "resumeLocation"
                ]
            }
            if any(change["field"] == "resumeLocation" for change in run_changes):
                run_state["resumeLocation"] = get_resume_location_label(data)
            canonical["run"] = run_state
        except (KeyError, ValueError):
            pass

    advanced_changes = [change for change in safe_changes if change["feature"] == "advanced"]
    if advanced_changes:
        try:
            advanced = discover_advanced_save(data, recharge_capabilities)
            items_by_key = {item.save_key: item for item in advanced.items}
            selected = [items_by_key[cast(str, change["entity"])] for change in advanced_changes]
            current_charge = next(
                domain for domain in advanced.domains if domain.key == "currentCharge"
            )
            if current_charge.entry_count is not None:
                canonical["advanced"] = {
                    "items": [
                        {
                            "saveKey": item.save_key,
                            "storedCharge": item.stored_charge,
                            "chargeState": item.charge_state.value,
                            "rechargeCapability": item.recharge_capability.value,
                            "canRefillToFull": item.can_refill_to_full,
                        }
                        for item in selected
                    ],
                    "currentChargeEntryCount": current_charge.entry_count,
                }
        except (AdvancedSaveError, KeyError, StopIteration, ValueError):
            pass

    return canonical


def save_changes(
    save_id: str,
    expected_fingerprint: str,
    changes: object,
    root: Path | None = None,
    *,
    game_status_loader: Callable[[], GameProcessStatus] = get_game_process_status,
    recharge_capability_loader: RechargeCapabilityLoader = (
        discover_installed_recharge_capabilities
    ),
    recharge_evidence: object | None = None,
    recharge_evidence_verifier: RechargeEvidenceVerifier = verify_recharge_evidence,
) -> dict[str, object]:
    """Validate and safely persist one typed set of pending changes.

    The game must be confirmed closed. The source fingerprint is checked before
    mutation, then the shared repository creates an exact-byte backup, stages and
    reopens encrypted output, and atomically replaces the source.

    Args:
        save_id: Opaque identifier previously returned by discovery.
        expected_fingerprint: SHA-256 captured when the save was opened.
        changes: Typed pending changes accepted by the desktop boundary.
        root: Optional isolated discovery root used by tests.
        game_status_loader: Injectable game-process check used by tests.

    Returns:
        A renderer-safe success result or stable error payload.
    """
    try:
        require_game_closed(game_status_loader)
        save, data, source = load_discovered_save(save_id, root)
        if (
            not isinstance(expected_fingerprint, str)
            or len(expected_fingerprint) != 64
            or any(character not in "0123456789abcdef" for character in expected_fingerprint)
        ):
            return _failure("save_validation_failed", "The opened save fingerprint is invalid.")
        if _fingerprint(source) != expected_fingerprint:
            return _failure(
                "save_stale",
                "The save changed after it was opened. Reopen it before saving edits.",
            )
        refill_item_types = requested_refill_item_types(changes)
        recharge_capabilities: Mapping[str, ItemRechargeCapability]
        if refill_item_types:
            verified_evidence = (
                recharge_evidence_verifier(recharge_evidence, refill_item_types)
                if recharge_evidence is not None
                else None
            )
            recharge_capabilities = (
                verified_evidence
                if verified_evidence is not None
                else recharge_capability_loader(refill_item_types)
            )
        else:
            recharge_capabilities = {}
        apply_run_save_changes(data, changes, recharge_capabilities)
        backup, written = SaveRepository(save.path.parent).overwrite(
            save.path,
            data,
            expected_source=source,
        )
        try:
            metadata = save.path.stat()
            modified_at = datetime.fromtimestamp(metadata.st_mtime, tz=UTC)
        except OSError:
            modified_at = datetime.now(tz=UTC)
        updated_save = replace(
            save,
            modified_at=modified_at,
            file_size=len(written),
        )
        session = _session(updated_save, data, written)
        result = {
            "backupPath": str(backup),
            "session": session,
            "canonical": _canonical_applied_state(
                data,
                changes,
                cast(str, session["fingerprint"]),
                recharge_capabilities,
            ),
        }
    except GameSafetyError as exc:
        return _failure(exc.code, exc.message)
    except DesktopSaveError as exc:
        return _failure(exc.code, exc.message)
    except SaveCryptoError:
        return _failure("save_write_failed", "The edited save could not be encrypted safely.")
    except (ValueError, TypeError) as exc:
        return _failure("save_validation_failed", str(exc))
    except SaveBackupError:
        return _failure(
            "backup_failed", "The original save could not be backed up. Nothing was written."
        )
    except SaveStaleError:
        return _failure(
            "save_stale",
            "The save changed while edits were being prepared. Reopen it before saving.",
        )
    except SaveVerificationError:
        return _failure(
            "save_verification_failed",
            "The staged save could not be verified. The original was preserved.",
        )
    except FileNotFoundError:
        return _failure("save_missing", "The selected save no longer exists.")
    except (SaveWriteError, OSError):
        return _failure("save_write_failed", "The edited save could not be written safely.")

    return {"ok": True, "result": result}
