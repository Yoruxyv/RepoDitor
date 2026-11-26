"""Verified installed-build admission for an independently gated MetaSave session."""

from __future__ import annotations

import json
from functools import lru_cache
from hashlib import sha256
from pathlib import Path

from repo_save_editor.desktop_api.transactions.meta_transactions import (
    _failure,
    meta_recover,
    meta_state,
    meta_write,
)
from repo_save_editor.desktop_api.transactions.production_health import (
    RuntimeSaveSources,
    _installed_game,
    _process_status,
    _source_pins,
    _verify_private_sources,
    recheck_shared_sources,
    verified_private_game,
    verify_shared_sources,
)
from repo_save_editor.services.artwork.baked_artwork import entry_artwork_revision
from repo_save_editor.services.artwork.native_artwork_cache import native_artwork_cache
from repo_save_editor.services.cosmetics.installed_catalog import (
    _catalog_payload,
    _parse_cached_catalog,
)
from repo_save_editor.services.cosmetics.installed_reader_native import read_installed_catalog
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.cosmetics.policy import PROVEN_MUTATION_IDS
from repo_save_editor.services.game.discovery import GameInstallation
from repo_save_editor.services.game.installed_build import ValidatedInstalledBuild
from repo_save_editor.services.game.write_evidence import (
    COSMETIC_CATALOG_DIGEST,
    SAVE_FORMAT_PINS,
    source_pins_match,
)
from repo_save_editor.services.saves.discovery import get_default_save_root
from repo_save_editor.services.saves.private_health import Bundle, private_bundle
from repo_save_editor.storage.health_recovery import RecoveryError


@lru_cache(maxsize=1)
def _read_qualified_catalog(
    root: Path, digest: str, isolated: bool
) -> tuple[InstalledCosmeticMetadata, ...]:
    with native_artwork_cache("cosmetic-metadata", isolated=isolated) as cache:
        encoded = cache.editor_frame("cosmetic-metadata", digest) if cache else None
        # Every cached frame must match the frozen review digest before it can be parsed.
        if encoded is not None and sha256(encoded).hexdigest() == digest:
            catalog = _parse_cached_catalog(json.loads(encoded))
            if catalog is not None:
                return catalog
        catalog, _ = read_installed_catalog(root, native=True)
        encoded = json.dumps(_catalog_payload(catalog), sort_keys=True).encode()
        if sha256(encoded).hexdigest() != digest:
            raise RecoveryError("save_unsupported")
        if cache is not None:
            cache.publish_editor_frame("cosmetic-metadata", digest, encoded)
        return catalog


def verified_private_cosmetics(root: Path, bundle: Bundle) -> tuple[InstalledCosmeticMetadata, ...]:
    return _verified_catalog(
        root, bundle.cosmetic_sources, bundle.cosmetic_catalog_digest, not bundle.live
    )


def _verified_catalog(
    root: Path, sources: tuple[tuple[str, str], ...], digest: str, isolated: bool
) -> tuple[InstalledCosmeticMetadata, ...]:
    if not source_pins_match(root, sources):
        raise RecoveryError("save_unsupported")
    catalog = _read_qualified_catalog(root, digest, isolated)
    if not source_pins_match(root, sources):
        raise RecoveryError("save_unsupported")
    return catalog


def _verify_changed_catalog(
    root: Path, sources: tuple[tuple[str, str], ...]
) -> tuple[InstalledCosmeticMetadata, ...]:
    # A presentation cache keyed by the old digest cannot prove a changed file.
    if not source_pins_match(root, sources):
        raise RecoveryError("save_verification_unavailable")
    catalog, targets = read_installed_catalog(root, ownership=True)
    # The reviewed digest covers every catalog slot through the last supported
    # ownership ID. New slots may follow it and remain presentation-only.
    prefix = catalog[: PROVEN_MUTATION_IDS[-1] + 1]
    keys = [row.icon_cache_key for row in catalog if row.icon_cache_key is not None]
    if (
        len({(file, target) for file, target, _ in targets}) != len(catalog)
        or len(set(keys)) != len(keys)
        or sha256(json.dumps(_catalog_payload(prefix), sort_keys=True).encode()).hexdigest()
        != COSMETIC_CATALOG_DIGEST
        or not source_pins_match(root, sources)
    ):
        raise RecoveryError("save_unsupported")
    return catalog


def _changed_catalog_sources(
    game: GameInstallation,
    build: ValidatedInstalledBuild,
    reviewed: tuple[tuple[str, str], ...],
) -> tuple[tuple[str, str], ...] | None:
    paths = tuple(name for name, _ in reviewed)
    if set(paths) != {
        "REPO_Data/level0",
        "REPO_Data/globalgamemanagers.assets",
        "REPO_Data/sharedassets0.assets",
    } or source_pins_match(game.root, reviewed):
        return None
    return tuple(zip(paths, _source_pins(game, build, paths), strict=True))


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
    try:
        approved = None
        dynamic_sources = None
        if bundle is not None and private:
            game, build = verified_private_game(bundle)
            expected = bundle.source_pins + bundle.save_format_pins
        else:
            game, build = _installed_game()
            shared = verify_shared_sources(game, build)
            approved = shared.reviewed if isinstance(shared, RuntimeSaveSources) else shared
            dynamic_sources = _changed_catalog_sources(game, build, approved.cosmetics)
            expected = (
                tuple(digest for _, digest in shared.pins)
                if isinstance(shared, RuntimeSaveSources)
                else approved.gameplay + SAVE_FORMAT_PINS
            ) + tuple(digest for _, digest in (dynamic_sources or approved.cosmetics))
        root = get_default_save_root()
        if root is None:
            raise RecoveryError("save_verification_unavailable")
    except (OSError, ValueError) as exc:
        if action == "state":
            return {"ok": True, "state": "disabled"}
        return _failure(
            operation or "",
            "conflict" if action == "recover" else "rejected",
            exc.code if isinstance(exc, RecoveryError) else "save_verification_unavailable",
        )

    def verify_sources() -> None:
        if bundle is not None and private:
            _verify_private_sources(game, build, bundle)
        else:
            recheck_shared_sources(game, build, shared)

    def admit(_root: Path) -> tuple[dict[str, str], tuple[InstalledCosmeticMetadata, ...]]:
        verify_sources()
        if bundle is not None and private:
            catalog = verified_private_cosmetics(game.root, bundle)
        elif dynamic_sources is not None:
            catalog = _verify_changed_catalog(game.root, dynamic_sources)
        elif approved is not None:
            catalog = _verified_catalog(
                game.root, approved.cosmetics, COSMETIC_CATALOG_DIGEST, False
            )
        else:
            raise RecoveryError("save_verification_unavailable")
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

    if action in {"state", "recover"}:
        revision = entry_artwork_revision(game.root)
        result = (
            meta_state(root, operation, admit=admit)
            if action == "state"
            else meta_recover(root, operation or "", proof, admit=admit)
        )
        view = result.get("view")
        if isinstance(view, dict) and revision and revision == entry_artwork_revision(game.root):
            view["artworkRevision"] = revision
        return {**result, "sourcePath": str(root.parent / "MetaSave.es3")}
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
