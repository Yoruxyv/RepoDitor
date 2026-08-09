"""Research-only synthesis of the controlled Tranq refill candidate."""

from __future__ import annotations

import argparse
import hashlib
import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from repo_save_editor.core.schema import get_dictionaries
from repo_save_editor.storage.repository import SaveRepository

EXPECTED_SOURCE_SHA256 = "798e24438d170b9a06dac2ca22c49c8733a862c38ea468b633ad3ff9bdb3e537"
ITEM_KEY = "Item Gun Tranq/1"
SEMANTIC_PATH = 'dictionaryOfDictionaries.value["itemStatBattery"]["Item Gun Tranq/1"]'


def _sha256(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def _container(dictionaries: dict[str, Any], key: str) -> dict[str, Any]:
    value = dictionaries.get(key)
    if not isinstance(value, dict):
        raise ValueError(f"Expected '{key}' to be a dictionary.")
    return value


def synthesize_tranq_refill(
    source: Path,
    output: Path,
    *,
    expected_source_sha256: str = EXPECTED_SOURCE_SHA256,
) -> dict[str, object]:
    """Remove only the controlled Tranq charge leaf and verify the new save."""
    source = source.resolve()
    output = output.resolve()
    if source == output:
        raise ValueError("Source and output paths must be different.")
    if output.exists():
        raise FileExistsError(f"Refusing to replace existing output: {output}")

    source_bytes = source.read_bytes()
    source_sha256 = _sha256(source_bytes)
    if source_sha256 != expected_source_sha256:
        raise ValueError(
            f"Source SHA-256 mismatch: expected {expected_source_sha256}, got {source_sha256}."
        )

    source_data = SaveRepository.load_bytes(source_bytes)
    generated_data = deepcopy(source_data)
    dictionaries = get_dictionaries(generated_data)
    items = _container(dictionaries, "item")
    charges = _container(dictionaries, "itemStatBattery")

    item_value = items.get(ITEM_KEY)
    if isinstance(item_value, bool) or item_value != 15:
        raise ValueError(f"Expected item['{ITEM_KEY}'] to equal 15.")
    charge_value = charges.get(ITEM_KEY)
    if isinstance(charge_value, bool) or charge_value != 0 or ITEM_KEY not in charges:
        raise ValueError(f"Expected itemStatBattery['{ITEM_KEY}'] to equal 0.")

    del charges[ITEM_KEY]
    SaveRepository(output.parent).save_as(output, generated_data)
    reopened = SaveRepository.load(output)
    if reopened != generated_data:
        raise ValueError("Generated save did not reopen with the expected data.")

    restored = deepcopy(reopened)
    _container(get_dictionaries(restored), "itemStatBattery")[ITEM_KEY] = 0
    if restored != source_data:
        raise ValueError(f"Generated save changed data beyond removal of {SEMANTIC_PATH}.")

    source_after = source.read_bytes()
    source_sha256_after = _sha256(source_after)
    if source_after != source_bytes or source_sha256_after != source_sha256:
        raise ValueError("Source evidence changed while the research output was generated.")

    output_bytes = output.read_bytes()
    return {
        "source": {
            "path": str(source),
            "bytes": len(source_bytes),
            "sha256": source_sha256,
        },
        "output": {
            "path": str(output),
            "bytes": len(output_bytes),
            "sha256": _sha256(output_bytes),
        },
        "validatedSourceState": {
            f'item["{ITEM_KEY}"]': 15,
            f'itemStatBattery["{ITEM_KEY}"]': 0,
        },
        "semanticDiff": [
            {
                "change": "removed",
                "path": SEMANTIC_PATH,
                "before": 0,
                "after": "absent",
            }
        ],
        "sourceSha256After": source_sha256_after,
        "sourceUnchanged": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create the research-only Tranq refill candidate without replacing its source."
    )
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        result = synthesize_tranq_refill(args.source, args.output)
    except (OSError, ValueError) as exc:
        parser.exit(1, f"error: {exc}\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
