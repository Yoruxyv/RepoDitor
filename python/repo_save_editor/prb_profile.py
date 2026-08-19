"""Temporary PR B Recharge profiling helpers. Never shipped in production."""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from time import perf_counter, time

_ENABLED = "REPODITOR_PROFILE_RECHARGE"
_FILE = "REPODITOR_RECHARGE_PROFILE_FILE"


def enabled() -> bool:
    return os.environ.get(_ENABLED) == "1" and bool(os.environ.get(_FILE))


def emit(event: str, **fields: object) -> None:
    if not enabled():
        return
    path = Path(os.environ[_FILE])
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "python",
        "event": event,
        "pid": os.getpid(),
        "timestamp": time(),
        **fields,
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, separators=(",", ":")) + "\n")


@contextmanager
def timed(event: str, **fields: object) -> Iterator[None]:
    if not enabled():
        yield
        return
    started = perf_counter()
    try:
        yield
    finally:
        emit(event, durationMs=(perf_counter() - started) * 1000.0, **fields)
