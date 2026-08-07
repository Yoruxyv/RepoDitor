"""Installed-map discovery tab construction."""

from __future__ import annotations

import tkinter as tk
from collections.abc import Callable
from pathlib import Path
from tkinter import ttk

from repo_save_editor.services.maps import GameMap


def build_maps_tab(
    parent: ttk.Frame,
    on_rescan: Callable[[], None],
) -> tuple[ttk.Treeview, tk.StringVar]:
    """Build the read-only installed-map catalog view."""
    parent.columnconfigure(0, weight=1)
    parent.rowconfigure(2, weight=1)

    ttk.Label(
        parent,
        text=(
            "Maps are discovered from the installed game's Addressables catalog. "
            "RepoDitor does not hardcode the playable map list."
        ),
        wraplength=650,
    ).grid(row=0, column=0, sticky="ew", pady=(0, 8))

    source_variable = tk.StringVar(value="Game installation not scanned yet.")
    source_row = ttk.Frame(parent)
    source_row.grid(row=1, column=0, sticky="ew", pady=(0, 8))
    source_row.columnconfigure(0, weight=1)
    ttk.Label(source_row, textvariable=source_variable, wraplength=580).grid(
        row=0, column=0, sticky="w"
    )
    ttk.Button(source_row, text="Rescan Maps", command=on_rescan).grid(row=0, column=1, padx=(8, 0))

    table_frame = ttk.Frame(parent)
    table_frame.grid(row=2, column=0, sticky="nsew")
    table_frame.columnconfigure(0, weight=1)
    table_frame.rowconfigure(0, weight=1)

    tree = ttk.Treeview(
        table_frame,
        columns=("name", "internal", "source"),
        show="headings",
        selectmode="browse",
    )
    tree.heading("name", text="Map")
    tree.heading("internal", text="Game ID")
    tree.heading("source", text="Label Source")
    tree.column("name", width=220, anchor=tk.W)
    tree.column("internal", width=120, anchor=tk.W)
    tree.column("source", width=110, anchor=tk.W)
    tree.grid(row=0, column=0, sticky="nsew")

    scrollbar = ttk.Scrollbar(table_frame, orient=tk.VERTICAL, command=tree.yview)
    scrollbar.grid(row=0, column=1, sticky="ns")
    tree.configure(yscrollcommand=scrollbar.set)

    ttk.Label(
        parent,
        text=(
            "This tab currently discovers installed maps only. The save format has no "
            "confirmed field for forcing the next generated map, so RepoDitor does not "
            "pretend that changing this list controls the next mission."
        ),
        wraplength=650,
    ).grid(row=3, column=0, sticky="ew", pady=(10, 0))

    return tree, source_variable


def refresh_maps_tab(
    tree: ttk.Treeview,
    source_variable: tk.StringVar,
    maps: tuple[GameMap, ...],
    catalog_path: Path | None,
) -> None:
    """Refresh the installed-map table without owning discovery logic."""
    for item in tree.get_children():
        tree.delete(item)

    if catalog_path is None:
        source_variable.set(
            "R.E.P.O. installation not found automatically. Set REPO_GAME_DIR to the "
            "game folder and rescan."
        )
        return

    source_variable.set(f"Source: {catalog_path}")
    for game_map in maps:
        tree.insert(
            "",
            tk.END,
            values=(
                game_map.display_name,
                game_map.internal_name,
                "Known alias" if game_map.known_label else "Detected",
            ),
        )
