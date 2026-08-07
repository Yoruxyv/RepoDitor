"""Player-upgrade tab construction."""

from __future__ import annotations

import tkinter as tk
from collections.abc import Callable
from tkinter import ttk

from repo_save_editor.services.upgrades import PlayerUpgrade


def build_player_upgrade_tab(
    parent: ttk.Frame,
    upgrades: tuple[PlayerUpgrade, ...],
    variables: dict[str, tk.StringVar],
    on_change: Callable[..., None],
) -> None:
    """Rebuild the player-upgrade editor from detected save fields."""
    for child in parent.winfo_children():
        child.destroy()
    variables.clear()

    for column in (1, 3):
        parent.columnconfigure(column, weight=1)

    ttk.Label(
        parent,
        text="Upgrades are detected automatically from the loaded save.",
    ).grid(row=0, column=0, columnspan=4, sticky="w", pady=(0, 8))

    if not upgrades:
        ttk.Label(
            parent,
            text="No playerUpgrade* dictionaries were found in this save.",
        ).grid(row=1, column=0, columnspan=4, sticky="w")
        return

    has_unknown = False
    for index, upgrade in enumerate(upgrades):
        row = (index // 2) + 1
        pair = index % 2
        label_column = pair * 2
        input_column = label_column + 1

        variable = tk.StringVar(value="0")
        variable.trace_add("write", on_change)
        variables[upgrade.key] = variable

        label = upgrade.label
        if not upgrade.known:
            label = f"{label}  (detected)"
            has_unknown = True

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
            to=999999999,
            textvariable=variable,
            width=12,
        ).grid(
            row=row,
            column=input_column,
            sticky="ew",
            padx=(0, 18 if not pair else 0),
            pady=6,
        )

    if has_unknown:
        final_row = ((len(upgrades) - 1) // 2) + 2
        ttk.Label(
            parent,
            text=(
                "Detected entries are valid playerUpgrade* dictionaries that RepoDitor "
                "does not recognize yet. They may come from mods or newer game versions."
            ),
            wraplength=650,
        ).grid(row=final_row, column=0, columnspan=4, sticky="w", pady=(10, 0))
