"""Verified installed-build admission for an independently gated MetaSave session."""

from __future__ import annotations

import json
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from typing import Final

from repo_save_editor.desktop_api.meta_transactions import (
    _failure,
    meta_recover,
    meta_state,
    meta_write,
)
from repo_save_editor.desktop_api.production_health import (
    _installed_game,
    _process_status,
    _source_pins,
    _verify_private_sources,
    private_sources_match,
    verified_private_game,
)
from repo_save_editor.services.cosmetics.installed_catalog import _catalog_payload
from repo_save_editor.services.cosmetics.installed_reader import read_installed_catalog
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.cosmetics.policy import PROVEN_MUTATION_BUILD_IDS
from repo_save_editor.services.cosmetics.presentation_catalog import (
    discover_cosmetic_mutation_catalog,
)
from repo_save_editor.services.saves.discovery import get_default_save_root
from repo_save_editor.services.saves.private_health import Bundle, private_bundle
from repo_save_editor.storage.health_recovery import RecoveryError

# MetaSave review is separate from Run-save review and must use an Electron-proven build.
APPROVED_META_BUILDS: Final[dict[str, tuple[str, ...]]] = {}


@lru_cache(maxsize=1)
def _read_private_catalog(root: Path, digest: str) -> tuple[InstalledCosmeticMetadata, ...]:
    catalog, _ = read_installed_catalog(root)
    actual = sha256(json.dumps(_catalog_payload(catalog), sort_keys=True).encode()).hexdigest()
    if actual != digest:
        raise RecoveryError("save_unsupported")
    return catalog


def verified_private_cosmetics(root: Path, bundle: Bundle) -> tuple[InstalledCosmeticMetadata, ...]:
    if not private_sources_match(root, bundle.cosmetic_sources):
        raise RecoveryError("save_unsupported")
    catalog = _read_private_catalog(root, bundle.cosmetic_catalog_digest)
    if not private_sources_match(root, bundle.cosmetic_sources):
        raise RecoveryError("save_unsupported")
    return catalog


def production_meta(
    action: str,
    operation: str | None,
    *,
    proof: str = "",
    fingerprint: str = "",
    intent: object = None,
    namespace: str = "",
) -> dict[str, object]:
    bundle = private_bundle()
    private = bundle is not None and bundle.session
    expected: tuple[str, ...] | None
    try:
        if bundle is not None and private:
            game, build = verified_private_game(bundle)
            expected = bundle.source_pins + bundle.save_format_pins
        else:
            if not APPROVED_META_BUILDS:
                raise RecoveryError("save_unsupported")
            game, build = _installed_game()
            expected = APPROVED_META_BUILDS.get(build.build_id)
            if expected is None or build.build_id not in PROVEN_MUTATION_BUILD_IDS:
                raise RecoveryError("save_unsupported")
        root = get_default_save_root()
        if root is None:
            raise RecoveryError("save_verification_unavailable")
    except RecoveryError as exc:
        if action == "state":
            return {"ok": True, "state": "disabled"}
        return _failure(
            operation or "", "conflict" if action == "recover" else "rejected", exc.code
        )

    def verify_sources() -> None:
        if bundle is not None and private:
            _verify_private_sources(game, build, bundle)
        elif expected is None or _source_pins(game, build) != expected:
            raise RecoveryError("save_unsupported")

    def admit(_root: Path) -> tuple[dict[str, str], tuple[InstalledCosmeticMetadata, ...]]:
        verify_sources()
        catalog = (
            verified_private_cosmetics(game.root, bundle)
            if bundle is not None and private
            else discover_cosmetic_mutation_catalog(game.root)
        )
        if catalog is None:
            raise RecoveryError("save_unsupported")
        verify_sources()
        admission = {
            "identity": "repoditor-production-meta-v1",
            "build": build.build_id,
            "manifest": sha256(json.dumps(expected).encode()).hexdigest(),
        }
        admission["digest"] = sha256(
            json.dumps([admission, _catalog_payload(catalog)], sort_keys=True).encode()
        ).hexdigest()
        return admission, catalog

    if action == "state":
        return {
            **meta_state(root, operation, admit=admit),
            "sourcePath": str(root.parent / "MetaSave.es3"),
        }
    if action == "recover":
        return {
            **meta_recover(root, operation or "", proof, admit=admit),
            "sourcePath": str(root.parent / "MetaSave.es3"),
        }
    return meta_write(
        root,
        operation or "",
        fingerprint,
        intent,
        namespace=namespace,
        prepare=action == "prepare",
        admit=admit,
        game_status_loader=lambda: _process_status(game.root / "REPO.exe"),
    )
