"""Modern display metadata uses artwork sources without replacing historical proof."""

from pathlib import Path

import pytest

from repo_save_editor.services.cosmetics import presentation_catalog as presentation
from repo_save_editor.services.cosmetics.installed_catalog import _catalog_payload
from repo_save_editor.services.cosmetics.models import InstalledCosmeticMetadata
from repo_save_editor.services.cosmetics.policy import mutation_eligible_ids


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
    expected = (InstalledCosmeticMetadata(0, "Historical", 0, 0, 0),)
    calls = []

    def historical(game_dir, *, cache_dir):
        calls.append((game_dir, cache_dir))
        return expected

    monkeypatch.setattr(presentation, "discover_installed_cosmetic_catalog", historical)
    game, cache = Path("historical"), Path("cache")
    assert presentation.discover_cosmetic_presentation_catalog(game, cache_dir=cache) == expected
    assert calls == [(game, cache)]
