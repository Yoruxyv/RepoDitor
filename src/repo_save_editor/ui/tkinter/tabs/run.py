"""Run-stat tab construction."""

from __future__ import annotations

import tkinter as tk
from collections.abc import Callable
from tkinter import ttk


def build_run_stats_tab(
    parent: ttk.Frame,
    run_stats: tuple[tuple[str, str], ...],
    variables: dict[str, tk.StringVar],
    on_change: Callable[..., None],
) -> None:
    """Build the editable run-stat form."""
    parent.columnconfigure(1, weight=1)

    for row, (label, key) in enumerate(run_stats):
        variable = tk.StringVar(value="0")
        variable.trace_add("write", on_change)
        variables[key] = variable

        ttk.Label(parent, text=label).grid(
            row=row,
            column=0,
            sticky="w",
            padx=(0, 10),
            pady=7,
        )
        ttk.Spinbox(
            parent,
            from_=-999999999,
            to=999999999,
            textvariable=variable,
            width=18,
        ).grid(row=row, column=1, sticky="ew", pady=7)
