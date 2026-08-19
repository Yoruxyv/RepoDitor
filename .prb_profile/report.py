from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path


def load(path: Path) -> list[dict[str, object]]:
    return [
        json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()
    ]


def scenarios(rows: list[dict[str, object]]) -> dict[str, list[dict[str, object]]]:
    result: dict[str, list[dict[str, object]]] = {}
    active: str | None = None
    for row in rows:
        if row.get("source") == "e2e" and row.get("event") == "scenario_start":
            active = str(row["scenario"])
            result[active] = []
            continue
        if row.get("source") == "e2e" and row.get("event") == "scenario_end":
            active = None
            continue
        if active is not None:
            result[active].append(row)
    return result


def duration(rows: list[dict[str, object]], event: str) -> float | None:
    values = [float(row["durationMs"]) for row in rows if row.get("event") == event]
    return values[-1] if values else None


def fmt(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.2f} ms"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: report.py <profile.jsonl>", file=sys.stderr)
        return 2
    rows = load(Path(sys.argv[1]))
    groups = scenarios(rows)
    electron_totals: list[float] = []
    print("PR B Recharge evidence profile")
    print("before: Recharge ~= 6960 ms; metadata discovery ~= 6470 ms")
    for name, group in groups.items():
        electron = duration(group, "electron_saves_write_total")
        python_total = duration(group, "python_saves_write_total")
        validation = duration(group, "recharge_evidence_validation")
        persistence = duration(group, "safe_persistence_total")
        canonical = duration(group, "canonical_post_write_projection")
        scans = sum(1 for row in group if row.get("event") == "unity_metadata_scan")
        sources = [
            row.get("sourceKind")
            for row in group
            if row.get("event") == "recharge_authorization_source"
        ]
        if electron is not None:
            electron_totals.append(electron)
        print(f"\n{name}")
        print(f"  Electron total: {fmt(electron)}")
        print(f"  Python total: {fmt(python_total)}")
        print(f"  Evidence validation: {fmt(validation)}")
        print(f"  Full Unity metadata scan count: {scans}")
        print(f"  Safe persistence: {fmt(persistence)}")
        print(f"  Canonical projection: {fmt(canonical)}")
        print(f"  Authorization source: {sources[-1] if sources else 'n/a'}")
    if electron_totals:
        print(f"\nMedian primed Electron total: {statistics.median(electron_totals):.2f} ms")
    scan_total = sum(1 for row in rows if row.get("event") == "unity_metadata_scan")
    # Scans during initial priming are expected; only per-scenario counts are the acceptance criterion.
    print(f"Total capture metadata scans (including initial priming): {scan_total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
