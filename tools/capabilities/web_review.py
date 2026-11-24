"""Bind browser capability snapshots to reviewed Desktop write evidence."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Final, TypedDict, cast

from repo_save_editor.services.game import write_evidence as desktop
from tools.capabilities.schema import (
    STEAM_APP_ID,
    CapabilityDataError,
    exact_object,
    read_json,
    sha256_text_file,
)

REVIEW_PATH: Final = Path(__file__).with_name("evidence") / "web-desktop-review.v1.json"
REVIEW_PROVENANCE: Final = "docs/maintenance/game-update-capabilities.md#web-write-compatibility"


class WebDesktopReview(TypedDict):
    reviewedSteamBuildIds: list[str]
    desktopReleaseCommit: str
    desktopPolicySha256: str
    cosmeticIdsSha256: str


def _digest(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def desktop_policy_digest() -> str:
    """Bind the review to the Desktop approvals and their shared dependencies."""
    return _digest(
        {
            "approvedSources": [sources._asdict() for sources in desktop.APPROVED_WRITE_SOURCES],
            "saveFormat": desktop.SAVE_FORMAT_PINS,
            "runDomains": sorted(desktop.APPROVED_RUN_DOMAINS),
            "rechargeIdentities": desktop.RECHARGE_IDENTITIES,
            "rechargeUnity": desktop.RECHARGE_UNITY,
            "cosmeticCatalog": desktop.COSMETIC_CATALOG_DIGEST,
        }
    )


def read_review() -> WebDesktopReview:
    review = exact_object(
        read_json(REVIEW_PATH),
        {
            "reviewedSteamBuildIds",
            "desktopReleaseCommit",
            "desktopPolicySha256",
            "cosmeticIdsSha256",
        },
        "Web Desktop review",
    )
    for field, pattern in (
        ("desktopReleaseCommit", r"[0-9a-f]{40}"),
        ("desktopPolicySha256", r"sha256:[0-9a-f]{64}"),
        ("cosmeticIdsSha256", r"sha256:[0-9a-f]{64}"),
    ):
        value = review[field]
        if not isinstance(value, str) or re.fullmatch(pattern, value) is None:
            raise CapabilityDataError(f"Web Desktop review field {field} is invalid.")
    builds = review["reviewedSteamBuildIds"]
    if (
        not isinstance(builds, list)
        or not builds
        or not all(
            isinstance(build, str)
            and re.fullmatch(r"[1-9][0-9]{0,9}", build) is not None
            and int(build) <= 0xFFFFFFFF
            for build in builds
        )
        or builds != sorted(set(builds), key=int)
    ):
        raise CapabilityDataError("Web Desktop review requires ordered, unique Steam build IDs.")
    if review["desktopPolicySha256"] != desktop_policy_digest():
        raise CapabilityDataError("Desktop write evidence changed; review Web compatibility.")
    return cast(WebDesktopReview, review)


def align_web_snapshots(recharge: dict[str, object], cosmetics: dict[str, object]) -> None:
    review = read_review()
    latest_build = review["reviewedSteamBuildIds"][-1]
    if recharge["rechargeableItemIdentities"] != list(desktop.RECHARGE_IDENTITIES):
        raise CapabilityDataError("Reviewed Web and Desktop Recharge identities disagree.")
    if _digest(cosmetics["cosmeticIds"]) != review["cosmeticIdsSha256"]:
        raise CapabilityDataError("The Cosmetics IDs disagree with the accepted Desktop review.")

    compatibility = {
        "steamAppId": STEAM_APP_ID,
        "steamBuildId": latest_build,
        "unityVersion": desktop.RECHARGE_UNITY,
    }
    review_digest = sha256_text_file(REVIEW_PATH)
    for snapshot in (recharge, cosmetics):
        snapshot["compatibility"] = compatibility
        snapshot["provenance"] = REVIEW_PROVENANCE
        cast(dict[str, str], snapshot["sourceDigests"])["webDesktopReview"] = review_digest
    cosmetics["gameCompatibility"] = (
        f"Exact reviewed Cosmetics IDs carried forward to Steam build {latest_build}"
    )
