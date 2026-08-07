from __future__ import annotations

from typing import Any

import pytest


@pytest.fixture
def sample_save() -> dict[str, Any]:
    return {
        "teamName": {"__type": "System.String", "value": "R.E.P.O."},
        "dateAndTime": {"__type": "System.String", "value": "2026-08-06"},
        "timePlayed": {"__type": "System.Single", "value": 100.0},
        "playerNames": {
            "__type": "Dictionary",
            "value": {"111": "Alpha", "222": "Beta"},
        },
        "dictionaryOfDictionaries": {
            "__type": "Dictionary",
            "value": {
                "runStats": {
                    "level": 4,
                    "currency": 12,
                    "lives": 3,
                    "totalHaul": 500,
                    "save level": 0,
                },
                "playerUpgradeStrength": {"111": 2},
                "playerHealth": {"111": 80},
            },
        },
    }
