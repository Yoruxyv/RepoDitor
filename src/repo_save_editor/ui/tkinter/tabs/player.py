"""Player-upgrade tab construction."""

from __future__ import annotations

import tkinter as tk
from collections.abc import Callable
from tkinter import ttk


def build_player_upgrade_tab(
    parent: ttk.Frame,
    upgrades: tuple[tuple[str, str], ...],
    variables: dict[str, tk.StringVar],
    on_change: Callable[..., None],
) -> None:
    """Build the current two-column player-upgrade editor."""
    for column in (0, 2):
        parent.columnconfigure(column, weight=1)

    for index, (label, key) in enumerate(upgrades):
        row = index // 2
        pair = index % 2
        label_column = pair * 2
        input_column = label_column + 1

        variable = tk.StringVar(value="0")
        variable.trace_add("write", on_change)
        variables[key] = variable

        ttk.Label(parent, text=label).grid(
            row=row,
            column=label_column,
            sticky="w",
            padx=(0, 8),
            pady=6,
        )
        ttk.Spinbox(
            parent,
            from_=0,
            to=9999,
            textvariable=variable,
            width=10,
        ).grid(
            row=row,
            column=input_column,
            sticky="ew",
            padx=(0, 18 if not pair else 0),
            pady=6,
        )
