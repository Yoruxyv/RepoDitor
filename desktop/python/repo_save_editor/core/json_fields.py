"""Replace selected ES3 value spans without reserializing unrelated JSON."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any


def _replace_fields(
    source: str, replacements: Mapping[str, str], *, es3_values: bool = False
) -> str:
    decoder = json.JSONDecoder()
    position = 0

    def whitespace(start: int) -> int:
        while start < len(source) and source[start] in " \t\r\n":
            start += 1
        return start

    position = whitespace(position)
    if source[position : position + 1] != "{":
        raise ValueError("Expected a JSON object for field preservation.")
    position = whitespace(position + 1)
    seen = set()
    parts: list[str] = []
    previous = 0
    while source[position : position + 1] != "}":
        key, end = decoder.raw_decode(source, position)
        if not isinstance(key, str) or key in seen:
            raise ValueError("Duplicate or invalid JSON field.")
        seen.add(key)
        position = whitespace(end)
        if source[position : position + 1] != ":":
            raise ValueError("Invalid JSON object separator.")
        start = whitespace(position + 1)
        _, end = decoder.raw_decode(source, start)
        if key in replacements:
            replacement = replacements[key]
            if es3_values:
                replacement = _replace_fields(source[start:end], {"value": replacement})
            parts.extend((source[previous:start], replacement))
            previous = end
        position = whitespace(end)
        if source[position : position + 1] == "}":
            break
        if source[position : position + 1] != ",":
            raise ValueError("Invalid JSON field separator.")
        position = whitespace(position + 1)
    if not set(replacements) <= seen:
        raise ValueError("A field selected for preservation is missing.")
    parts.append(source[previous:])
    return "".join(parts)


def replace_es3_values(source: str, replacements: Mapping[str, Any]) -> str:
    """Retain unknown wrapper metadata as well as untouched top-level values."""
    encoded = {key: json.dumps(value, ensure_ascii=False) for key, value in replacements.items()}
    return _replace_fields(source, encoded, es3_values=True)
