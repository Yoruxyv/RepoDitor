"""Apply RepoDitor's link policy to Lychee v0.24.2 JSON output."""

import json
import os
import sys
from pathlib import Path
from typing import NotRequired, TypedDict

TRANSIENT_HTTP = frozenset({408, 429, 500, 502, 503, 504})


class Status(TypedDict):
    text: str
    code: NotRequired[int]


class Link(TypedDict):
    url: str
    status: Status


class Report(TypedDict):
    total: int
    errors: int
    timeouts: int
    error_map: dict[str, list[Link]]
    timeout_map: dict[str, list[Link]]


def classify(report: Report, exit_code: str) -> tuple[set[str], set[str]]:
    errors = [link for links in report["error_map"].values() for link in links]
    timeouts = [link for links in report["timeout_map"].values() for link in links]
    if (
        report["total"] <= 0
        or exit_code not in {"0", "2"}
        or len(errors) != report["errors"]
        or len(timeouts) != report["timeouts"]
        or (exit_code == "2") != bool(errors or timeouts)
    ):
        raise ValueError("Lychee returned an empty, inconsistent, or unusable link report.")

    transient = {
        link["url"] for link in timeouts if link["url"].startswith(("http://", "https://"))
    }
    transient.update(
        link["url"]
        for link in errors
        if link["url"].startswith(("http://", "https://"))
        and link["status"].get("code") in TRANSIENT_HTTP
    )
    blocking = {
        link["url"] for link in timeouts if not link["url"].startswith(("http://", "https://"))
    }
    for link in errors:
        status = link["status"]
        code = status.get("code")
        if link["url"] in transient and (
            code in TRANSIENT_HTTP or (code is None and status["text"] == "Error (cached)")
        ):
            continue
        blocking.add(link["url"])
    return blocking, transient - blocking


def main() -> int:
    try:
        report = json.loads(Path(os.environ["LYCHEE_REPORT"]).read_text(encoding="utf-8"))
        blocking, transient = classify(report, os.environ["LYCHEE_EXIT_CODE"])
    except (KeyError, TypeError, ValueError, OSError, AttributeError):
        sys.stderr.write(
            "::error::Lychee did not produce a valid link result. See the previous step.\n"
        )
        return 1

    if blocking:
        sys.stderr.write(
            f"::error::{len(blocking)} unique links have blocking errors. See Lychee's JSON.\n"
        )
    if transient:
        sys.stdout.write(
            f"::warning::External link validation incomplete for {len(transient)} unique URLs "
            "due to transient responses. See Lychee's JSON.\n"
        )
    with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as summary:
        summary.write(
            "### Link validation\n\n"
            f"- Blocking errors: {len(blocking)} unique URLs\n"
            f"- External validation incomplete due to transient responses: {len(transient)} unique URLs\n\n"
            "See the Collect link results step for URL, source location and reported status.\n"
        )
    return int(bool(blocking))


if __name__ == "__main__":
    raise SystemExit(main())
