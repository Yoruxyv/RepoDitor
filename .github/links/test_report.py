import unittest

from report import Link, Report, classify


def evidence(errors: list[Link], timeouts: list[Link]) -> Report:
    return {
        "total": len(errors) + len(timeouts) + 1,
        "errors": len(errors),
        "timeouts": len(timeouts),
        "error_map": {"README.md": errors},
        "timeout_map": {"README.id.md": timeouts},
    }


class LinkReportTests(unittest.TestCase):
    def expect(self, report: Report, code: str, blocking: set[str], transient: set[str]) -> None:
        result = classify(report, code)
        if result != (blocking, transient):
            self.fail(f"Expected {(blocking, transient)}, got {result}.")

    def test_successful_report_has_no_unverified_links(self) -> None:
        self.expect(evidence([], []), "0", set(), set())

    def test_transient_status_and_timeout_remain_incomplete(self) -> None:
        slow = "https://example.test/badge"
        unavailable = "https://example.test/license"
        self.expect(
            evidence(
                [
                    {"url": slow, "status": {"text": "Error (cached)"}},
                    {"url": unavailable, "status": {"text": "Service Unavailable", "code": 503}},
                ],
                [{"url": slow, "status": {"text": "Timeout"}}],
            ),
            "2",
            set(),
            {slow, unavailable},
        )

    def test_broken_destination_local_asset_and_unknown_cached_error_block(self) -> None:
        destination = "https://example.test/gone"
        local = "file:///repo/missing.png"
        cached = "https://example.test/unknown"
        self.expect(
            evidence(
                [
                    {"url": destination, "status": {"text": "Gone", "code": 410}},
                    {"url": cached, "status": {"text": "Error (cached)"}},
                ],
                [{"url": local, "status": {"text": "Timeout"}}],
            ),
            "2",
            {destination, cached, local},
            set(),
        )

    def test_404_remains_blocking_even_if_duplicate_times_out(self) -> None:
        url = "https://example.test/removed"
        self.expect(
            evidence(
                [{"url": url, "status": {"text": "Not Found", "code": 404}}],
                [{"url": url, "status": {"text": "Timeout"}}],
            ),
            "2",
            {url},
            set(),
        )

    def test_rejects_inconsistent_empty_and_checker_failure(self) -> None:
        report = evidence([], [])
        cases: list[tuple[Report, str]] = [
            (report, "2"),
            (report, "1"),
            ({**report, "total": 0}, "0"),
            ({**report, "timeouts": 1}, "0"),
        ]
        for candidate, code in cases:
            with self.subTest(report=candidate, code=code):
                try:
                    classify(candidate, code)
                except ValueError:
                    continue
                self.fail("An unusable Lychee report was accepted.")
