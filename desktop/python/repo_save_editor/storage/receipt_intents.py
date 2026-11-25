"""Bound and validate the original edit intent stored in a recovery receipt."""

from __future__ import annotations

import json
import re

_HASH = re.compile(r"[0-9a-f]{64}\Z")
_ITEM_KEY = re.compile(r"Item .+/[0-9]+\Z")
HEALTH_INTENT_LIMIT = 2048
REFILL_INTENT_LIMIT = 2048
UPGRADE_INTENT_LIMIT = 2048
RUN_INTENT_LIMIT = 512


def valid_meta_intent(value: object) -> bool:
    """Admit only the bounded MetaSave action union; domain policy checks actual IDs."""
    if not isinstance(value, dict) or set(value) != {"metaCosmetics"}:
        return False
    action = value["metaCosmetics"]
    if not isinstance(action, dict):
        return False
    tag, admission = action.get("action"), action.get("admission")
    if not isinstance(admission, str) or _HASH.fullmatch(admission) is None:
        return False
    if tag == "unlockIds":
        ids = action.get("ids")
        if (
            set(action) != {"action", "admission", "ids"}
            or not isinstance(ids, list)
            or not 1 <= len(ids) <= 512
            or any(type(i) is not int or not 0 <= i <= 9_007_199_254_740_991 for i in ids)
            or len(set(ids)) != len(ids)
        ):
            return False
    elif tag not in ("unlockAll", "lockAll", "clearPresets") or set(action) != {
        "action",
        "admission",
    }:
        return False
    return len(json.dumps(value, separators=(",", ":")).encode()) <= 2048


def valid_refill_intent(value: object) -> bool:
    """Bound fixed refill actions; actual membership and eligibility remain domain checks."""
    if not isinstance(value, dict) or set(value) != {"refillToFull"}:
        return False
    edits = value["refillToFull"]
    if not isinstance(edits, list) or not 1 <= len(edits) <= 512:
        return False
    seen = set()
    for edit in edits:
        if not isinstance(edit, dict) or set(edit) != {"saveKey", "before"}:
            return False
        key = edit["saveKey"]
        if not isinstance(key, str) or "\0" in key or key in seen:
            return False
        if (
            _ITEM_KEY.fullmatch(key) is None
            or type(edit["before"]) is not int
            or not -9_007_199_254_740_991 <= edit["before"] <= 9_007_199_254_740_991
        ):
            return False
        seen.add(key)
    return (
        len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode())
        <= REFILL_INTENT_LIMIT
    )


def valid_health_batch_intent(value: object) -> bool:
    """Admit only distinct Health edits within the existing batch/receipt budgets."""
    if not isinstance(value, dict) or set(value) != {"health"}:
        return False
    edits = value["health"]
    if not isinstance(edits, list) or not 1 <= len(edits) <= 512:
        return False
    seen = set()
    for edit in edits:
        if not isinstance(edit, dict) or set(edit) != {"playerId", "before", "value"}:
            return False
        player = edit["playerId"]
        if (
            not isinstance(player, str)
            or not 0 < len(player) <= 20
            or not player.isascii()
            or not player.isdigit()
            or player in seen
            or type(edit["before"]) is not int
            or not 0 <= edit["before"] <= 9_007_199_254_740_991
            or type(edit["value"]) is not int
            or not 0 <= edit["value"] <= 2_147_483_647
            or edit["value"] == edit["before"]
        ):
            return False
        seen.add(player)
    # ASCII IDs and integers cannot expand through Unicode escaping. Default receipt
    # separators add six bytes per edit; complete receipts still have a 4096-byte cap.
    return len(json.dumps(value, separators=(",", ":")).encode()) <= HEALTH_INTENT_LIMIT


def valid_upgrade_intent(value: object) -> bool:
    """Bound durable upgrade identities and values without granting schema authority."""
    if not isinstance(value, dict) or set(value) != {"upgrades"}:
        return False
    edits = value["upgrades"]
    if not isinstance(edits, list) or not 1 <= len(edits) <= 512:
        return False
    seen = set()
    for edit in edits:
        if not isinstance(edit, dict) or set(edit) != {"playerId", "key", "value", "before"}:
            return False
        player, key = edit["playerId"], edit["key"]
        if (
            not isinstance(player, str)
            or not 0 < len(player) <= 20
            or not player.isascii()
            or not player.isdigit()
            or not isinstance(key, str)
            or not key.startswith("playerUpgrade")
            or key == "playerUpgrade"
            or "\0" in key
            or len(key.encode("utf-8", errors="surrogatepass")) > 512
            or type(edit["value"]) is not int
            or not 0 <= edit["value"] <= 2_147_483_647
            or type(edit["before"]) is not int
            or not 0 <= edit["before"] <= 9_007_199_254_740_991
            or edit["value"] == edit["before"]
            or (player, key) in seen
        ):
            return False
        seen.add((player, key))
    try:
        return (
            len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode())
            <= UPGRADE_INTENT_LIMIT
        )
    except UnicodeEncodeError:
        return False


def valid_run_intent(value: object) -> bool:
    """Five fixed fields fit 512 UTF-8 bytes; Python still verifies loaded-save authority."""
    if not isinstance(value, dict) or set(value) != {"run"}:
        return False
    edits = value["run"]
    if not isinstance(edits, list) or not 1 <= len(edits) <= 5:
        return False
    seen = set()
    for edit in edits:
        if not isinstance(edit, dict) or set(edit) != {"field", "before", "value"}:
            return False
        field, before, after = edit["field"], edit["before"], edit["value"]
        if not isinstance(field, str) or field in seen or before == after:
            return False
        seen.add(field)
        if field == "resumeLocation":
            if (
                not isinstance(before, str)
                or len(before.encode("utf-8", errors="surrogatepass")) > 64
                or after not in ("Normal", "Shop / Service Station")
            ):
                return False
        elif field in {"level", "currency", "lives", "totalHaul"}:
            if (
                type(before) is not int
                or not -(2**53 - 1) <= before <= 2**53 - 1
                or type(after) is not int
                or not (1 if field == "level" else -(2**31))
                <= after
                <= (2**31 if field == "level" else 2**31 - 1)
                or (field == "level" and before < 1)
            ):
                return False
        else:
            return False
    try:
        return (
            len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode())
            <= RUN_INTENT_LIMIT
        )
    except UnicodeEncodeError:
        return False


def valid_mixed_intent(value: object) -> bool:
    if not isinstance(value, dict) or set(value) != {"mixed"}:
        return False
    groups = value["mixed"]
    validators = {
        "health": valid_health_batch_intent,
        "upgrades": valid_upgrade_intent,
        "run": valid_run_intent,
        "refillToFull": valid_refill_intent,
    }
    if not isinstance(groups, dict) or groups.keys() != validators.keys():
        return False
    if sum(isinstance(edits, list) and bool(edits) for edits in groups.values()) < 2:
        return False
    try:
        return (
            all(edits == [] or validators[key]({key: edits}) for key, edits in groups.items())
            and len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()) <= 2048
        )
    except UnicodeEncodeError:
        return False


def valid_intent(value: object) -> bool:
    """Validate presentation intent without interpreting encrypted save semantics."""
    if not isinstance(value, dict) or set(value) != {"playerId", "health", "before"}:
        return False
    player = value["playerId"]
    return (
        isinstance(player, str)
        and 0 < len(player) <= 20
        and player.isascii()
        and player.isdigit()
        and type(value["health"]) is int
        and 0 <= value["health"] <= 2_147_483_647
        and type(value["before"]) is int
        and 0 <= value["before"] <= 9_007_199_254_740_991
    )
