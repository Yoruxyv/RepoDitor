from __future__ import annotations

import pytest

from repo_save_editor.services.game import write_evidence
from tools.capabilities import web_review, workflow
from tools.capabilities.schema import CapabilityDataError


def test_generated_snapshots_reuse_the_exact_reviewed_desktop_capabilities() -> None:
    snapshots = workflow.expected_artifacts()
    for snapshot in (snapshots.recharge, snapshots.cosmetics):
        assert snapshot["compatibility"] == {
            "steamAppId": "3241660",
            "steamBuildId": "26813769",
            "unityVersion": "6000.3.28f1",
        }
        assert snapshot["provenance"] == web_review.REVIEW_PROVENANCE
    assert snapshots.recharge["rechargeableItemIdentities"] == list(
        write_evidence.RECHARGE_IDENTITIES
    )
    assert snapshots.cosmetics["cosmeticIds"] == list(range(557))


@pytest.mark.parametrize(
    ("domain", "key", "unexpected"),
    [
        ("recharge", "rechargeableItemIdentities", "Item New Battery"),
        ("cosmetics", "cosmeticIds", 557),
    ],
)
def test_same_count_still_rejects_a_changed_identity(
    domain: str, key: str, unexpected: int | str
) -> None:
    snapshots = workflow.expected_artifacts()
    selected = snapshots.recharge if domain == "recharge" else snapshots.cosmetics
    identities = selected[key]
    assert isinstance(identities, list)
    identities[-1] = unexpected
    before = selected["compatibility"]
    with pytest.raises(CapabilityDataError, match=r"identities disagree|IDs disagree"):
        web_review.align_web_snapshots(snapshots.recharge, snapshots.cosmetics)
    assert selected["compatibility"] == before


@pytest.mark.parametrize("change", ["existing", "new"])
def test_changed_desktop_evidence_requires_review_before_web_generation(
    monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    sources = write_evidence.APPROVED_WRITE_SOURCES
    changed = sources[0]._replace(gameplay=("f" * 64, *sources[0].gameplay[1:]))
    approvals = (changed, *sources[1:]) if change == "existing" else (*sources, changed)
    monkeypatch.setattr(write_evidence, "APPROVED_WRITE_SOURCES", approvals)
    with pytest.raises(CapabilityDataError, match="Desktop write evidence changed"):
        workflow.expected_artifacts()


@pytest.mark.parametrize("builds", [[], ["26813769", "26732417"], ["26732417"] * 2, ["4294967296"]])
def test_invalid_reviewed_builds_fail_closed(
    monkeypatch: pytest.MonkeyPatch, builds: list[str]
) -> None:
    review = {**web_review.read_review(), "reviewedSteamBuildIds": builds}
    monkeypatch.setattr(web_review, "read_json", lambda _path: review)
    with pytest.raises(CapabilityDataError, match="ordered, unique Steam build IDs"):
        web_review.read_review()
