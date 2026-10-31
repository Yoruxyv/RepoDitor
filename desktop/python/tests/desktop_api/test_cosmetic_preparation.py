"""Bounded cosmetics batch transport regressions."""

from __future__ import annotations

import io
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from repo_save_editor.desktop_api.cosmetic_preparation import (
    parse_cosmetic_ids,
    stream_cosmetic_artwork,
)


@pytest.mark.parametrize("raw", [
    b"[]", b"not json", b"[1]", b'["01"]', b'["-1"]', b'["2000"]',
    b'["1","1"]', b'["1.0"]', b'["1", null]', b'["\xff"]',
    b'["0"]' + b" " * (16 * 1024),
])
def test_rejects_invalid_batches(raw: bytes) -> None:
    with pytest.raises(ValueError):
        parse_cosmetic_ids(io.BytesIO(raw))


def test_accepts_canonical_batch() -> None:
    assert parse_cosmetic_ids(io.BytesIO(b'["0","12","556"]')) == (0, 12, 556)


def test_streams_once_and_validates_order() -> None:
    records: list[dict[str, object]] = []
    prepared = (SimpleNamespace(cosmetic_id=0), SimpleNamespace(cosmetic_id=1))
    def feed(ids: tuple[int, ...], *, on_decoded: object) -> tuple[object, ...]:
        assert ids == (0, 1)
        for artwork in prepared:
            on_decoded(artwork)
        return prepared

    with (
        patch("repo_save_editor.desktop_api.cosmetic_preparation.prepare_installed_cosmetic_artwork", side_effect=feed) as decode,
        patch("repo_save_editor.desktop_api.cosmetic_preparation.serialize_cosmetic_artwork", side_effect=lambda artwork: {"cosmeticId": artwork.cosmetic_id}),
    ):
        stream_cosmetic_artwork((0, 1), records.append)
    decode.assert_called_once()
    assert [record["type"] for record in records] == ["texture", "texture", "final"]
    assert records[-1] == {"type": "final", "ok": True, "completed": 2, "total": 2}


def test_rejects_wrong_order_without_partial_artwork() -> None:
    records: list[dict[str, object]] = []
    prepared = (SimpleNamespace(cosmetic_id=1), SimpleNamespace(cosmetic_id=0))
    with patch("repo_save_editor.desktop_api.cosmetic_preparation.prepare_installed_cosmetic_artwork", return_value=prepared):
        stream_cosmetic_artwork((0, 1), records.append)
    assert records == [{"type": "final", "ok": False, "completed": 0, "total": 2}]
