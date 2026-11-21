"""Provisional byte budgets for one Python-owned save operation, not an RSS limit."""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from hashlib import sha256
from typing import BinaryIO, ParamSpec, TypeVar

ENCRYPTED_LIMIT = 32 * 1024 * 1024
PLAINTEXT_LIMIT = 128 * 1024 * 1024
ENCRYPTED_OPERATION_LIMIT = 64 * 1024 * 1024
PLAINTEXT_OPERATION_LIMIT = 256 * 1024 * 1024
RESOURCE_MESSAGE = "The save exceeds RepoDitor's experimental supported-size limits."


class SaveResourceError(ValueError):
    """A path-free rejection that must not discard transaction evidence."""

    def __init__(self) -> None:
        super().__init__(RESOURCE_MESSAGE)


class SaveBudget:
    """Count distinct immutable payloads; verification and exact backups share a budget entry."""

    def __init__(self) -> None:
        self.encrypted: dict[str, int] = {}
        self.plaintext: dict[str, int] = {}
        self.encrypted_size = 0
        self.plaintext_size = 0

    def encrypted_snapshot(self, digest: str, size: int) -> None:
        if size > ENCRYPTED_LIMIT:
            raise SaveResourceError
        if digest not in self.encrypted:
            if self.encrypted_size + size > ENCRYPTED_OPERATION_LIMIT:
                raise SaveResourceError
            self.encrypted[digest] = size
            self.encrypted_size += size

    def plaintext_snapshot(self, blob: bytes) -> None:
        if len(blob) > PLAINTEXT_LIMIT:
            raise SaveResourceError
        digest = sha256(blob).hexdigest()
        if digest not in self.plaintext:
            if self.plaintext_size + len(blob) > PLAINTEXT_OPERATION_LIMIT:
                raise SaveResourceError
            self.plaintext[digest] = len(blob)
            self.plaintext_size += len(blob)


_ACTIVE: ContextVar[SaveBudget | None] = ContextVar("save_budget", default=None)
_P = ParamSpec("_P")
_T = TypeVar("_T")


@contextmanager
def save_operation() -> Iterator[SaveBudget]:
    """Nested repository/adapter calls share the outer request's aggregate ceilings."""
    active = _ACTIVE.get()
    if active is not None:
        yield active
        return
    budget = SaveBudget()
    token = _ACTIVE.set(budget)
    try:
        yield budget
    finally:
        _ACTIVE.reset(token)


def bounded_save_operation(function: Callable[_P, _T]) -> Callable[_P, _T]:
    """Give direct library callers the same operation boundary as desktop commands."""

    @wraps(function)
    def bounded(*args: _P.args, **kwargs: _P.kwargs) -> _T:
        with save_operation():
            return function(*args, **kwargs)

    return bounded


def check_encrypted(blob: bytes) -> None:
    if len(blob) > ENCRYPTED_LIMIT:
        raise SaveResourceError
    with save_operation() as budget:
        budget.encrypted_snapshot(sha256(blob).hexdigest(), len(blob))


def check_plaintext(blob: bytes) -> None:
    with save_operation() as budget:
        budget.plaintext_snapshot(blob)


def _chunks(stream: BinaryIO) -> Iterator[bytes]:
    # Inspect the opened object, then bound actual I/O even if it grows after fstat.
    if os.fstat(stream.fileno()).st_size > ENCRYPTED_LIMIT:
        raise SaveResourceError
    size = 0
    while chunk := stream.read(min(65536, ENCRYPTED_LIMIT + 1 - size)):
        size += len(chunk)
        if size > ENCRYPTED_LIMIT:
            raise SaveResourceError
        yield chunk


@bounded_save_operation
def read_encrypted(stream: BinaryIO) -> bytes:
    blob = b"".join(_chunks(stream))
    check_encrypted(blob)
    return blob


@bounded_save_operation
def hash_encrypted(stream: BinaryIO) -> str:
    digest, size = sha256(), 0
    for chunk in _chunks(stream):
        digest.update(chunk)
        size += len(chunk)
    value = digest.hexdigest()
    with save_operation() as budget:
        budget.encrypted_snapshot(value, size)
    return value
