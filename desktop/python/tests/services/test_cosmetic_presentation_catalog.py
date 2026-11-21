"""Modern display metadata uses artwork sources without replacing historical proof."""

from pathlib import Path

import pytest

from repo_save_editor.services.cosmetics import presentation_catalog as presentation
from repo_save_editor.services.cosmetics.installed_artwork import (
    CosmeticArtworkError,
    prepare_installed_cosmetic_artwork,
)
from repo_save_editor.services.cosmetics.installed_catalog import _catalog_payload
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.cosmetics.policy import mutation_eligible_ids
from repo_save_editor.services.game.installed_build import (
    artwork_installation,
    validated_installed_artwork_build,
)
from repo_save_editor.services.game.installed_maps import read_installed_levels
from repo_save_editor.services.player.upgrade_textures import UpgradeTextureError, _validated_paths
from repo_save_editor.services.unity_serialized import UnityMetadataError
from tests.services.test_installed_cosmetic_catalog import _build_install


def test_readable_artwork_catalog_keeps_unproved_tail_read_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    catalog = tuple(InstalledCosmeticMetadata(i, str(i), 0, 0, 0) for i in range(558))
    monkeypatch.setattr(
        presentation,
        "discover_baked_artwork",
        lambda *_args, **_kwargs: {
            "cosmeticCatalog": _catalog_payload(catalog),
        },
    )
    monkeypatch.setattr(
        presentation,
        "discover_installed_cosmetic_catalog",
        lambda *_args, **_kwargs: pytest.fail("Modern metadata must reuse the artwork index"),
    )
    result = presentation.discover_cosmetic_presentation_catalog()
    assert result == catalog
    assert mutation_eligible_ids(result) == tuple(range(557))
    assert all(entry.icon_cache_key is None for entry in result)


def test_historical_build_keeps_its_existing_catalog_loader(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(presentation, "discover_baked_artwork", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(presentation, "artwork_installation", lambda *_args: None)
    expected = (InstalledCosmeticMetadata(0, "Historical", 0, 0, 0),)
    calls = []

    def historical(game_dir, *, cache_dir):
        calls.append((game_dir, cache_dir))
        return expected

    monkeypatch.setattr(presentation, "discover_installed_cosmetic_catalog", historical)
    game, cache = Path("historical"), Path("cache")
    assert presentation.discover_cosmetic_presentation_catalog(game, cache_dir=cache) == expected
    assert calls == [(game, cache)]


@pytest.fixture
def modern(tmp_path, monkeypatch):
    monkeypatch.setattr(presentation, "discover_baked_artwork", lambda *_args, **_kwargs: None)
    return _build_install(tmp_path, unity_version="6000.3.17f1", build_id="26407089")


def test_verified_unity6_fallback_preserves_canonical_duplicate_name_ids(modern, tmp_path):
    root, _level, _target, _manifest = modern
    cache = tmp_path / "display-cache"
    result = presentation.discover_cosmetic_presentation_catalog(root, cache_dir=cache)
    assert result is not None
    assert [(c.cosmetic_id, c.asset_name) for c in result] == [
        (0, "Hat"),
        (1, "Hat"),
        (2, "Glasses"),
    ]
    assert not cache.exists()
    with pytest.raises(ValueError, match="not approved"):
        presentation.discover_cosmetic_mutation_catalog(root)


def test_fallback_invalidates_changed_sources_without_using_legacy_cache(modern, monkeypatch):
    root, _level, target, _manifest = modern
    monkeypatch.setattr(
        presentation,
        "discover_installed_cosmetic_catalog",
        lambda *_args, **_kwargs: pytest.fail("A new build cannot reuse the legacy cache"),
    )
    first = presentation.discover_cosmetic_presentation_catalog(root)
    target.write_bytes(target.read_bytes().replace(b"Hat", b"Cap"))
    second = presentation.discover_cosmetic_presentation_catalog(root)
    assert first is not None
    assert second is not None
    assert first[0].asset_name == "Hat"
    assert second[0].asset_name == "Cap"
    assert [c.cosmetic_id for c in second] == [0, 1, 2]


@pytest.mark.parametrize("source", [1, 2, 3])
def test_sources_changed_during_fallback_are_rejected(modern, monkeypatch, source):
    root, *_ = modern
    original = presentation.read_installed_catalog

    def changed(game):
        result = original(game)
        path = modern[source]
        path.write_bytes(path.read_bytes() + b"changed")
        return result

    monkeypatch.setattr(presentation, "read_installed_catalog", changed)
    assert presentation.discover_cosmetic_presentation_catalog(root) is None


@pytest.mark.parametrize("damage", ["sources", "ownership", "reader"])
def test_fallback_source_limits_and_io_failures_fail_soft(modern, monkeypatch, damage):
    root, *_ = modern
    if damage == "sources":
        monkeypatch.setattr(presentation, "MAX_OPEN_FILES", 1)
    else:

        def fail(*_args):
            raise OSError("unavailable installed source")

        monkeypatch.setattr(
            presentation, "owned_file" if damage == "ownership" else "read_installed_catalog", fail
        )
    assert presentation.discover_cosmetic_presentation_catalog(root) is None


@pytest.mark.parametrize(
    "options",
    [
        {"unity_version": "6000.3.18f1"},
        {"pointers": ((2, 7000), (2, 7000))},
        {"extra_meta_managers": 1},
        {"unresolved_target_external": True},
        {"target_script_class": "NotCosmeticAsset"},
    ],
)
def test_fallback_preserves_strict_reader_rejections(tmp_path, monkeypatch, options):
    monkeypatch.setattr(presentation, "discover_baked_artwork", lambda *_args, **_kwargs: None)
    root, *_ = _build_install(
        tmp_path, **{"unity_version": "6000.3.17f1", "build_id": "26407089", **options}
    )
    assert presentation.discover_cosmetic_presentation_catalog(root) is None


def test_mutation_catalog_requires_independent_build_admission(modern, monkeypatch):
    root, *_ = modern
    monkeypatch.setattr(
        presentation,
        "discover_installed_cosmetic_catalog",
        lambda *_args, **_kwargs: pytest.fail("Unapproved metadata must not reach a writer"),
    )
    with pytest.raises(ValueError, match="not approved"):
        presentation.discover_cosmetic_mutation_catalog(root)


def test_artwork_metadata_cannot_expand_mutation_build_admission(modern, monkeypatch):
    root, *_ = modern
    catalog = (InstalledCosmeticMetadata(0, "Display only", 0, 0, 0),)
    monkeypatch.setattr(
        presentation,
        "discover_baked_artwork",
        lambda *_args, **_kwargs: {"cosmeticCatalog": _catalog_payload(catalog)},
    )
    assert presentation.discover_cosmetic_presentation_catalog(root) == catalog
    with pytest.raises(ValueError, match="not approved"):
        presentation.discover_cosmetic_mutation_catalog(root)
    monkeypatch.setattr(presentation, "artwork_installation", lambda *_args: None)
    with pytest.raises(ValueError, match="not approved"):
        presentation.discover_cosmetic_mutation_catalog(root)


@pytest.mark.parametrize("build", ["23363152", "26294889"])
def test_existing_proven_builds_keep_their_separate_catalog_paths(modern, monkeypatch, build):
    root, _level, _target, manifest = modern
    manifest.write_bytes(manifest.read_bytes().replace(b"26407089", build.encode()))
    expected = (InstalledCosmeticMetadata(0, "Approved fixture", 0, 0, 0),)
    monkeypatch.setattr(
        presentation, "discover_installed_cosmetic_catalog", lambda *_args, **_kwargs: expected
    )
    monkeypatch.setattr(
        presentation,
        "discover_baked_artwork",
        lambda *_args, **_kwargs: {"cosmeticCatalog": _catalog_payload(expected)},
    )
    assert presentation.discover_cosmetic_mutation_catalog(root) == expected


def test_new_metadata_alone_does_not_admit_artwork_without_assembly_pin(modern):
    root, *_ = modern
    installation = artwork_installation(root)
    assert installation is not None
    assert validated_installed_artwork_build(installation) is not None
    data = root / "REPO_Data"
    (data / "Managed").mkdir()
    (data / "Managed/Assembly-CSharp.dll").write_bytes(b"unreviewed assembly")
    (data / "resources.assets").write_bytes(b"unreviewed resources")
    (data / "globalgamemanagers").write_bytes(b"unreviewed resources")
    (data / "sharedassets0.assets").write_bytes(b"unreviewed resources")
    with pytest.raises(UnityMetadataError, match="assembly"):
        read_installed_levels(installation)
    with pytest.raises(UpgradeTextureError, match="assembly"):
        _validated_paths(installation)
    with pytest.raises(CosmeticArtworkError, match="assembly"):
        prepare_installed_cosmetic_artwork([0], game_dir=root)
    with pytest.raises(ValueError, match="not approved"):
        presentation.discover_cosmetic_mutation_catalog(root)
