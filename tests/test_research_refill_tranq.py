from __future__ import annotations

import hashlib
from copy import deepcopy
from pathlib import Path

import pytest

from repo_save_editor.core.crypto import encrypt_save
from repo_save_editor.research_refill_tranq import ITEM_KEY, synthesize_tranq_refill
from repo_save_editor.storage.repository import SaveRepository


def test_synthesizes_only_the_tranq_charge_removal(tmp_path: Path, sample_save) -> None:
    dictionaries = sample_save["dictionaryOfDictionaries"]["value"]
    dictionaries.update(
        {
            "item": {ITEM_KEY: 15, "Item Cart Medium/1": 8},
            "itemStatBattery": {ITEM_KEY: 0, "Item Cart Medium/1": 44},
            "itemBatteryUpgrades": {},
            "itemsPurchased": {"Item Gun Tranq": 1},
            "itemsPurchasedTotal": {"Item Gun Tranq": 1},
            "itemsUpgradesPurchased": {},
        }
    )
    expected = deepcopy(sample_save)
    del expected["dictionaryOfDictionaries"]["value"]["itemStatBattery"][ITEM_KEY]

    source = tmp_path / "depleted.es3"
    output = tmp_path / "refilled.es3"
    source_bytes = encrypt_save(sample_save)
    source.write_bytes(source_bytes)
    source_sha256 = hashlib.sha256(source_bytes).hexdigest()

    with pytest.raises(ValueError, match="paths must be different"):
        synthesize_tranq_refill(source, source, expected_source_sha256=source_sha256)
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        synthesize_tranq_refill(source, output, expected_source_sha256="0" * 64)

    result = synthesize_tranq_refill(
        source,
        output,
        expected_source_sha256=source_sha256,
    )

    assert source.read_bytes() == source_bytes
    assert SaveRepository.load(output) == expected
    assert result["semanticDiff"] == [
        {
            "change": "removed",
            "path": 'dictionaryOfDictionaries.value["itemStatBattery"]["Item Gun Tranq/1"]',
            "before": 0,
            "after": "absent",
        }
    ]
    assert result["sourceSha256After"] == source_sha256
    assert result["sourceUnchanged"] is True
    with pytest.raises(FileExistsError, match="existing output"):
        synthesize_tranq_refill(source, output, expected_source_sha256=source_sha256)
