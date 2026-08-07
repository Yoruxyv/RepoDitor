"""Shared domain types for R.E.P.O. save editing."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, TypeAlias

SaveData: TypeAlias = dict[str, Any]


@dataclass(frozen=True, slots=True)
class Player:
    """A player entry stored in a run save."""

    player_id: str
    name: str

    @property
    def display_name(self) -> str:
        """Return the UI-friendly player label."""
        return f"{self.name}  [{self.player_id}]"
