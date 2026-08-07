"""Run-stat tab construction."""

from __future__ import annotations

import tkinter as tk
from collections.abc import Callable
from tkinter import ttk


def build_run_stats_tab(
    parent: ttk.Frame,
    run_stats: tuple[tuple[str, str], ...],
    variables: dict[str, tk.StringVar],
    resume_variable: tk.StringVar,
    resume_options: tuple[str, ...],
    on_change: Callable[..., None],
) -> ttk.Combobox:
    """Build the editable run-stat form and friendly resume selector."""
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

    resume_row = len(run_stats)
    ttk.Separator(parent).grid(
        row=resume_row,
        column=0,
        columnspan=2,
        sticky="ew",
        pady=(10, 8),
    )
    ttk.Label(parent, text="Resume Location").grid(
        row=resume_row + 1,
        column=0,
        sticky="w",
        padx=(0, 10),
        pady=7,
    )

    resume_variable.trace_add("write", on_change)
    combo = ttk.Combobox(
        parent,
        textvariable=resume_variable,
        values=resume_options,
        state="readonly",
        width=24,
    )
    combo.grid(row=resume_row + 1, column=1, sticky="ew", pady=7)

    ttk.Label(
        parent,
        text=(
            "Shop / Service Station maps to the confirmed raw save level value 1. Normal maps to 0."
        ),
        wraplength=560,
    ).grid(row=resume_row + 2, column=0, columnspan=2, sticky="w", pady=(2, 0))

    return combo
