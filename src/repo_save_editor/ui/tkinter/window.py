"""Tkinter development interface for RepoDitor."""

from __future__ import annotations

import copy
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from repo_save_editor.core.crypto import SaveCryptoError
from repo_save_editor.core.schema import SaveSchemaError
from repo_save_editor.core.types import Player, SaveData
from repo_save_editor.services.maps import MapDiscoveryError, discover_installed_maps
from repo_save_editor.services.players import (
    get_player_health,
    get_players,
    set_player_health,
)
from repo_save_editor.services.run_state import (
    RESUME_LOCATION_OPTIONS,
    RUN_STATS,
    get_resume_location_label,
    get_run_stat_for_display,
    set_resume_location_from_label,
    set_run_stat_from_display,
)
from repo_save_editor.services.save_discovery import (
    DiscoveredSave,
    SaveRootStatus,
    discover_saves,
    get_default_save_root,
)
from repo_save_editor.services.saves import format_duration, get_save_summary
from repo_save_editor.services.upgrades import (
    PlayerUpgrade,
    discover_player_upgrades,
    get_player_upgrade,
    set_player_upgrade,
)
from repo_save_editor.storage.repository import SaveRepository
from repo_save_editor.ui.tkinter.tabs.maps import build_maps_tab, refresh_maps_tab
from repo_save_editor.ui.tkinter.tabs.player import build_player_upgrade_tab
from repo_save_editor.ui.tkinter.tabs.run import build_run_stats_tab

APP_TITLE = "R.E.P.O. Save Editor"


class RepoSaveEditor(tk.Tk):
    """Tkinter shell around the interface-independent editor services."""

    def __init__(self, repository: SaveRepository | None = None) -> None:
        super().__init__()

        self.repository = repository or SaveRepository(get_default_save_root())

        self.title(APP_TITLE)
        self.minsize(940, 650)
        self.geometry("1080x720")

        self.current_path: Path | None = None
        self.data: SaveData | None = None
        self.players: list[Player] = []
        self.player_by_display: dict[str, Player] = {}
        self.player_upgrades: tuple[PlayerUpgrade, ...] = ()
        self.dirty = False

        self.path_var = tk.StringVar(value="No save loaded")
        self.status_var = tk.StringVar(value="Ready.")
        self.player_var = tk.StringVar()
        self.meta_var = tk.StringVar(value="Open a save to begin.")

        self.upgrade_vars: dict[str, tk.StringVar] = {}
        self.run_vars: dict[str, tk.StringVar] = {}
        self.resume_var = tk.StringVar(value=RESUME_LOCATION_OPTIONS[0])
        self.health_var = tk.StringVar(value="0")
        self.health_var.trace_add("write", self._mark_dirty)

        self._build_ui()
        self._set_editor_enabled(False)

        self.after(150, self.scan_default_saves)
        self.after(200, self.refresh_installed_maps)

    def _build_ui(self) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        toolbar = ttk.Frame(self, padding=(10, 10, 10, 6))
        toolbar.grid(row=0, column=0, sticky="ew")
        toolbar.columnconfigure(5, weight=1)

        ttk.Button(toolbar, text="Open .es3", command=self.open_file).grid(
            row=0, column=0, padx=(0, 6)
        )
        ttk.Button(
            toolbar,
            text="Scan Default Saves",
            command=self.scan_default_saves,
        ).grid(row=0, column=1, padx=(0, 6))
        ttk.Button(toolbar, text="Save / Overwrite", command=self.save_overwrite).grid(
            row=0, column=2, padx=(0, 6)
        )
        ttk.Button(toolbar, text="Save As…", command=self.save_as).grid(
            row=0, column=3, padx=(0, 6)
        )
        ttk.Button(toolbar, text="Reload", command=self.reload_current).grid(
            row=0, column=4, padx=(0, 10)
        )

        ttk.Label(toolbar, textvariable=self.path_var).grid(row=0, column=5, sticky="ew")

        content = ttk.Panedwindow(self, orient=tk.HORIZONTAL)
        content.grid(row=1, column=0, sticky="nsew", padx=10, pady=(0, 8))

        self.left = ttk.Frame(content, padding=8)
        self.right = ttk.Frame(content, padding=8)
        content.add(self.left, weight=1)
        content.add(self.right, weight=3)

        self._build_slot_panel(self.left)
        self._build_editor_panel(self.right)

        ttk.Label(
            self,
            textvariable=self.status_var,
            relief=tk.SUNKEN,
            anchor=tk.W,
            padding=(8, 4),
        ).grid(row=2, column=0, sticky="ew")

    def _build_slot_panel(self, parent: ttk.Frame) -> None:
        parent.columnconfigure(0, weight=1)
        parent.rowconfigure(2, weight=1)

        ttk.Label(parent, text="Save slots", font=("", 11, "bold")).grid(
            row=0, column=0, sticky="w"
        )
        ttk.Label(
            parent,
            text="Scans REPO_SAVE_*.es3 and ignores BACKUP files.",
            wraplength=250,
        ).grid(row=1, column=0, sticky="ew", pady=(2, 8))

        list_frame = ttk.Frame(parent)
        list_frame.grid(row=2, column=0, sticky="nsew")
        list_frame.columnconfigure(0, weight=1)
        list_frame.rowconfigure(0, weight=1)

        self.slot_list = tk.Listbox(list_frame, exportselection=False)
        self.slot_list.grid(row=0, column=0, sticky="nsew")
        self.slot_list.bind("<Double-Button-1>", lambda _event: self.open_selected_slot())

        scrollbar = ttk.Scrollbar(
            list_frame,
            orient=tk.VERTICAL,
            command=self.slot_list.yview,
        )
        scrollbar.grid(row=0, column=1, sticky="ns")
        self.slot_list.configure(yscrollcommand=scrollbar.set)

        self.slot_paths: list[Path] = []
        ttk.Button(parent, text="Open Selected", command=self.open_selected_slot).grid(
            row=3, column=0, sticky="ew", pady=(8, 0)
        )

    def _build_editor_panel(self, parent: ttk.Frame) -> None:
        parent.columnconfigure(0, weight=1)
        parent.rowconfigure(3, weight=1)

        meta_frame = ttk.LabelFrame(parent, text="Save", padding=10)
        meta_frame.grid(row=0, column=0, sticky="ew")
        meta_frame.columnconfigure(0, weight=1)
        ttk.Label(meta_frame, textvariable=self.meta_var).grid(row=0, column=0, sticky="w")

        player_frame = ttk.Frame(parent)
        player_frame.grid(row=1, column=0, sticky="ew", pady=(10, 6))
        player_frame.columnconfigure(1, weight=1)

        ttk.Label(player_frame, text="Player:").grid(row=0, column=0, padx=(0, 8))
        self.player_combo = ttk.Combobox(
            player_frame,
            textvariable=self.player_var,
            state="readonly",
        )
        self.player_combo.grid(row=0, column=1, sticky="ew")
        self.player_combo.bind("<<ComboboxSelected>>", self._on_player_changed)

        status_frame = ttk.LabelFrame(parent, text="Player Status", padding=10)
        status_frame.grid(row=2, column=0, sticky="ew", pady=(0, 8))
        status_frame.columnconfigure(1, weight=1)

        ttk.Label(status_frame, text="Current Health").grid(
            row=0, column=0, sticky="w", padx=(0, 10)
        )
        ttk.Spinbox(
            status_frame,
            from_=0,
            to=999999999,
            textvariable=self.health_var,
            width=18,
        ).grid(row=0, column=1, sticky="ew")
        ttk.Label(
            status_frame,
            text=(
                "Current HP stored in the save. This is separate from the "
                "Health upgrade level below."
            ),
            wraplength=520,
        ).grid(row=1, column=0, columnspan=2, sticky="w", pady=(6, 0))

        notebook = ttk.Notebook(parent)
        notebook.grid(row=3, column=0, sticky="nsew")

        self.player_tab = ttk.Frame(notebook, padding=12)
        run_tab = ttk.Frame(notebook, padding=12)
        maps_tab = ttk.Frame(notebook, padding=12)
        notebook.add(self.player_tab, text="Player Upgrades")
        notebook.add(run_tab, text="Run Stats")
        notebook.add(maps_tab, text="Maps")

        build_player_upgrade_tab(
            self.player_tab,
            self.player_upgrades,
            self.upgrade_vars,
            self._mark_dirty,
        )
        self.resume_combo = build_run_stats_tab(
            run_tab,
            RUN_STATS,
            self.run_vars,
            self.resume_var,
            RESUME_LOCATION_OPTIONS,
            self._mark_dirty,
        )
        self.maps_tree, self.maps_source_var = build_maps_tab(
            maps_tab,
            self.refresh_installed_maps,
        )

        footer = ttk.Frame(parent)
        footer.grid(row=4, column=0, sticky="ew", pady=(10, 0))
        footer.columnconfigure(0, weight=1)
        ttk.Label(
            footer,
            text=(
                "Tip: values are upgrade levels, not the player's final calculated "
                "health/speed. Very large values may behave strangely."
            ),
            wraplength=650,
        ).grid(row=0, column=0, sticky="w")
        ttk.Button(
            footer,
            text="Apply Changes",
            command=self.apply_fields,
        ).grid(row=0, column=1, padx=(10, 0))

    def refresh_installed_maps(self) -> None:
        """Refresh the installed map catalog independently of the loaded save."""
        try:
            catalog = discover_installed_maps()
        except MapDiscoveryError as exc:
            refresh_maps_tab(self.maps_tree, self.maps_source_var, (), None)
            self.maps_source_var.set(f"Could not read installed map catalog: {exc}")
            return

        if catalog is None:
            refresh_maps_tab(self.maps_tree, self.maps_source_var, (), None)
            return

        refresh_maps_tab(
            self.maps_tree,
            self.maps_source_var,
            catalog.maps,
            catalog.path,
        )

    def scan_default_saves(self) -> None:
        self.slot_list.delete(0, tk.END)
        self.slot_paths = []

        result = discover_saves(self.repository.root)
        if result.status is SaveRootStatus.MISSING:
            self.status_var.set(f"Default save directory not found: {self.repository.root}")
            return
        if result.status is SaveRootStatus.UNREADABLE:
            self.status_var.set(f"Default save directory is not readable: {self.repository.root}")
            return

        for save in result.saves:
            self.slot_paths.append(save.path)
            self.slot_list.insert(tk.END, self._slot_label(save))

        self.status_var.set(
            f"Found {len(result.saves)} main save file(s) under {self.repository.root}"
        )

    @staticmethod
    def _slot_label(save: DiscoveredSave) -> str:
        modified = save.modified_at.astimezone().strftime("%Y-%m-%d %H:%M")
        size_kib = save.file_size / 1024
        return f"{save.display_name} | {modified} | {size_kib:.1f} KiB"

    def open_selected_slot(self) -> None:
        selection = self.slot_list.curselection()
        if not selection:
            messagebox.showinfo(APP_TITLE, "Select a save slot first.")
            return
        self.load_path(self.slot_paths[selection[0]])

    def open_file(self) -> None:
        filename = filedialog.askopenfilename(
            title="Open R.E.P.O. save",
            initialdir=self.repository.root if self.repository.root.exists() else None,
            filetypes=[("R.E.P.O. ES3 save", "*.es3"), ("All files", "*.*")],
        )
        if filename:
            self.load_path(Path(filename))

    def load_path(self, path: Path) -> None:
        if (
            self.dirty
            and self.data is not None
            and not messagebox.askyesno(
                APP_TITLE,
                "Discard unsaved field changes and open another save?",
            )
        ):
            return

        try:
            data = self.repository.load(path)
        except (OSError, SaveCryptoError, SaveSchemaError) as exc:
            messagebox.showerror(APP_TITLE, str(exc))
            self.status_var.set("Failed to load save.")
            return

        self.current_path = path
        self.data = data
        self.players = get_players(data)
        self.player_by_display = {player.display_name: player for player in self.players}
        self.player_upgrades = discover_player_upgrades(data)
        self._rebuild_upgrade_tab()

        self.path_var.set(str(path))
        self._refresh_metadata()
        self._refresh_players()
        self._refresh_run_fields()
        self._set_editor_enabled(True)
        self.dirty = False
        self.status_var.set(f"Loaded {path.name}")

    def reload_current(self) -> None:
        if self.current_path is None:
            return
        if self.dirty and not messagebox.askyesno(
            APP_TITLE,
            "Discard unsaved field changes and reload the file from disk?",
        ):
            return

        self.dirty = False
        self.load_path(self.current_path)

    def _refresh_metadata(self) -> None:
        assert self.data is not None
        summary = get_save_summary(self.data)
        self.meta_var.set(
            f"Team: {summary.team_name}    "
            f"Level: {summary.level}    "
            f"Date: {summary.date}    "
            f"Played: {format_duration(summary.time_played_seconds)}"
        )

    def _refresh_players(self) -> None:
        values = [player.display_name for player in self.players]
        self.player_combo["values"] = values

        if values:
            self.player_var.set(values[0])
            self._refresh_upgrade_fields()
            self._refresh_player_status_fields()
        else:
            self.player_var.set("")

    def _rebuild_upgrade_tab(self) -> None:
        build_player_upgrade_tab(
            self.player_tab,
            self.player_upgrades,
            self.upgrade_vars,
            self._mark_dirty,
        )

    def _refresh_upgrade_fields(self) -> None:
        if self.data is None:
            return
        player = self._selected_player()
        if player is None:
            return

        for upgrade in self.player_upgrades:
            self.upgrade_vars[upgrade.key].set(
                str(get_player_upgrade(self.data, player.player_id, upgrade.key))
            )
        self.dirty = False

    def _refresh_player_status_fields(self) -> None:
        if self.data is None:
            return
        player = self._selected_player()
        if player is None:
            return

        self.health_var.set(str(get_player_health(self.data, player.player_id)))
        self.dirty = False

    def _refresh_run_fields(self) -> None:
        if self.data is None:
            return

        for _label, key in RUN_STATS:
            self.run_vars[key].set(str(get_run_stat_for_display(self.data, key)))

        resume_label = get_resume_location_label(self.data)
        resume_options = list(RESUME_LOCATION_OPTIONS)
        if resume_label not in resume_options:
            resume_options.append(resume_label)
        self.resume_combo["values"] = tuple(resume_options)
        self.resume_var.set(resume_label)
        self.dirty = False

    def _on_player_changed(self, _event: tk.Event | None = None) -> None:
        if self.dirty and not self._apply_player_fields_only(show_errors=True):
            return
        self._refresh_upgrade_fields()
        self._refresh_player_status_fields()

    def _selected_player(self) -> Player | None:
        return self.player_by_display.get(self.player_var.get())

    @staticmethod
    def _parse_int(value: str, label: str) -> int:
        try:
            return int(value.strip())
        except ValueError as exc:
            raise ValueError(f"{label} must be a whole number.") from exc

    def _apply_player_fields_only(self, *, show_errors: bool) -> bool:
        if self.data is None:
            return False
        player = self._selected_player()
        if player is None:
            return False

        try:
            for upgrade in self.player_upgrades:
                value = self._parse_int(self.upgrade_vars[upgrade.key].get(), upgrade.label)
                if value < 0:
                    raise ValueError(f"{upgrade.label} cannot be negative.")
                set_player_upgrade(self.data, player.player_id, upgrade.key, value)

            current_health = self._parse_int(self.health_var.get(), "Current Health")
            set_player_health(self.data, player.player_id, current_health)
        except (ValueError, SaveSchemaError) as exc:
            if show_errors:
                messagebox.showerror(APP_TITLE, str(exc))
            return False

        return True

    def apply_fields(self, *, show_success: bool = True) -> bool:
        if self.data is None:
            messagebox.showinfo(APP_TITLE, "Open a save first.")
            return False

        snapshot = copy.deepcopy(self.data)
        try:
            if not self._apply_player_fields_only(show_errors=False):
                raise ValueError("Unable to apply player fields.")

            for label, key in RUN_STATS:
                value = self._parse_int(self.run_vars[key].get(), label)
                set_run_stat_from_display(self.data, key, value)

            set_resume_location_from_label(self.data, self.resume_var.get())
        except (ValueError, SaveSchemaError) as exc:
            self.data = snapshot
            messagebox.showerror(APP_TITLE, str(exc))
            return False

        self.dirty = True
        self._refresh_metadata()
        self.status_var.set(
            "Changes applied to the loaded save in memory. "
            "Click Save / Overwrite to write them to disk."
        )

        if show_success:
            messagebox.showinfo(
                APP_TITLE,
                "Changes applied successfully.\n\n"
                "They are not on disk yet. Click Save / Overwrite to save them.",
            )
        return True

    def save_overwrite(self) -> None:
        if self.current_path is None or self.data is None:
            messagebox.showinfo(APP_TITLE, "Open a save first.")
            return
        if not self.apply_fields(show_success=False):
            return

        try:
            backup = self.repository.overwrite(self.current_path, self.data)
        except OSError as exc:
            messagebox.showerror(APP_TITLE, f"Could not save file:\n{exc}")
            return

        self.dirty = False
        self.status_var.set(f"Saved. Backup: {backup.name}")
        messagebox.showinfo(
            APP_TITLE,
            f"Save updated successfully.\n\nBackup created:\n{backup}",
        )
        self.scan_default_saves()

    def save_as(self) -> None:
        if self.data is None:
            messagebox.showinfo(APP_TITLE, "Open a save first.")
            return
        if not self.apply_fields(show_success=False):
            return

        initial_name = self.current_path.name if self.current_path else "REPO_SAVE_EDITED.es3"
        filename = filedialog.asksaveasfilename(
            title="Save edited R.E.P.O. save",
            defaultextension=".es3",
            initialfile=initial_name,
            filetypes=[("R.E.P.O. ES3 save", "*.es3"), ("All files", "*.*")],
        )
        if not filename:
            return

        target = Path(filename)
        try:
            self.repository.save_as(target, self.data)
        except OSError as exc:
            messagebox.showerror(APP_TITLE, f"Could not save file:\n{exc}")
            return

        self.current_path = target
        self.path_var.set(str(target))
        self.dirty = False
        self.status_var.set(f"Saved as {target.name}")

    def _mark_dirty(self, *_args: object) -> None:
        if self.data is not None:
            self.dirty = True

    def _set_editor_enabled(self, enabled: bool) -> None:
        state = "readonly" if enabled else "disabled"
        self.player_combo.configure(state=state)


def run_gui() -> None:
    """Start the Tkinter development interface."""
    app = RepoSaveEditor()
    app.mainloop()
