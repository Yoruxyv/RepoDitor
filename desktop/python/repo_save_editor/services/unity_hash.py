"""Unity Hash128 filenames for the bounded UTF-8 identities observed in artwork.

SpookyHash V2 short-message algorithm, zero seeds, little-endian output.
Adapted from Bob Jenkins' public-domain SpookyV2.cpp / SpookyV2.h.
"""

from __future__ import annotations

import struct

_MASK = (1 << 64) - 1
_CONSTANT = 0xDEADBEEFDEADBEEF


def _rotate(value: int, bits: int) -> int:
    value &= _MASK
    return ((value << bits) | (value >> (64 - bits))) & _MASK


def _mix(state: list[int]) -> None:
    for step, rotation in enumerate((50, 52, 30, 41, 54, 48, 38, 37, 62, 34, 5, 36)):
        current = (step + 2) % 4
        following = (current + 1) % 4
        other = (current + 2) % 4
        state[current] = (_rotate(state[current], rotation) + state[following]) & _MASK
        state[other] ^= state[current]


def unity_hash128(key: str) -> str:
    """Return the exact reviewed Unity filename hash, or reject an unproven input."""
    data = key.encode("utf-8")
    # shortcut: only the short-message algorithm is needed, extend if keys reach 192 bytes.
    if not 0 < len(data) < 192 or "\0" in key:
        raise ValueError("Unsupported baked artwork identity.")
    state = [0, 0, _CONSTANT, _CONSTANT]
    offset = 0
    while offset + 32 <= len(data):
        first, second, third, fourth = struct.unpack_from("<4Q", data, offset)
        state[2] = (state[2] + first) & _MASK
        state[3] = (state[3] + second) & _MASK
        _mix(state)
        state[0] = (state[0] + third) & _MASK
        state[1] = (state[1] + fourth) & _MASK
        offset += 32
    if offset + 16 <= len(data):
        first, second = struct.unpack_from("<2Q", data, offset)
        state[2] = (state[2] + first) & _MASK
        state[3] = (state[3] + second) & _MASK
        _mix(state)
        offset += 16
    tail = data[offset:]
    state[3] += len(data) << 56
    state[2] += int.from_bytes(tail[:8], "little") if tail else _CONSTANT
    state[3] += int.from_bytes(tail[8:], "little") if tail else _CONSTANT
    state = [value & _MASK for value in state]
    for step, rotation in enumerate((15, 52, 26, 51, 28, 9, 47, 54, 32, 25, 63)):
        current = (step + 2) % 4
        following = (current + 1) % 4
        state[following] ^= state[current]
        state[current] = _rotate(state[current], rotation)
        state[following] = (state[following] + state[current]) & _MASK
    return struct.pack("<2Q", *state[:2]).hex()
