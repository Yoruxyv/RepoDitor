"""Tkinter GUI for R.E.P.O. Save Editor."""

from __future__ import annotations

import copy
import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from typing import Any

from .crypto import SaveCryptoError, decrypt_save, encrypt_save
from .model import (
    PLAYER_UPGRADES,
    RUN_STATS,
    Player,
    SaveSchemaError,
    format_duration,
    get_date,
    get_player_health,
    get_player_upgrade,
    get_players,
    get_run_stat,
    get_team_name,
    get_time_played_seconds,
    set_player_health,
    set_player_upgrade,
    set_run_stat,
    validate_save,
)


APP_TITLE = "R.E.P.O. Save Editor"
DEFAULT_SAVE_ROOT = (
    Path(os.environ.get("USERPROFILE", "~")).expanduser()
    / "AppData"
    / "LocalLow"
    / "semiwork"
    / "Repo"
)


class RepoSaveEditor(tk.Tk):
    def __init__(self) -> None:
        super().__init__()

        self.title(APP_TITLE)
        self.minsize(940, 650)
        self.geometry("1080x720")

        self.current_path: Path | None = None
        self.data: dict[str, Any] | None = None
        self.players: list[Player] = []
        self.player_by_display: dict[str, Player] = {}
        self.dirty = False

        self.path_var = tk.StringVar(value="No save loaded")
        self.status_var = tk.StringVar(value="Ready.")
        self.player_var = tk.StringVar()
        self.meta_var = tk.StringVar(value="Open a save to begin.")

        self.upgrade_vars: dict[str, tk.StringVar] = {}
        self.run_vars: dict[str, tk.StringVar] = {}
        self.health_var = tk.StringVar(value="0")
        self.health_var.trace_add("write", self._mark_dirty)

        self._build_ui()
        self._set_editor_enabled(False)

        if DEFAULT_SAVE_ROOT.exists():
            self.after(150, self.scan_default_saves)

    # ---------- UI ----------

    def _build_ui(self) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        toolbar = ttk.Frame(self, padding=(10, 10, 10, 6))
        toolbar.grid(row=0, column=0, sticky="ew")
        toolbar.columnconfigure(5, weight=1)

        ttk.Button(toolbar, text="Open .es3", command=self.open_file).grid(
            row=0, column=0, padx=(0, 6)
        )
        ttk.Button(toolbar, text="Scan Default Saves", command=self.scan_default_saves).grid(
            row=0, column=1, padx=(0, 6)
        )
        ttk.Button(toolbar, text="Save / Overwrite", command=self.save_overwrite).grid(
            row=0, column=2, padx=(0, 6)
        )
        ttk.Button(toolbar, text="Save As…", command=self.save_as).grid(
            row=0, column=3, padx=(0, 6)
        )
        ttk.Button(toolbar, text="Reload", command=self.reload_current).grid(
            row=0, column=4, padx=(0, 10)
        )

        path_label = ttk.Label(toolbar, textvariable=self.path_var)
        path_label.grid(row=0, column=5, sticky="ew")

        content = ttk.Panedwindow(self, orient=tk.HORIZONTAL)
        content.grid(row=1, column=0, sticky="nsew", padx=10, pady=(0, 8))

        self.left = ttk.Frame(content, padding=8)
        self.right = ttk.Frame(content, padding=8)
        content.add(self.left, weight=1)
        content.add(self.right, weight=3)

        self._build_slot_panel(self.left)
        self._build_editor_panel(self.right)

        status = ttk.Label(
            self,
            textvariable=self.status_var,
            relief=tk.SUNKEN,
            anchor=tk.W,
            padding=(8, 4),
        )
        status.grid(row=2, column=0, sticky="ew")

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
            list_frame, orient=tk.VERTICAL, command=self.slot_list.yview
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

        ttk.Label(meta_frame, textvariable=self.meta_var).grid(
            row=0, column=0, sticky="w"
        )

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

        player_tab = ttk.Frame(notebook, padding=12)
        run_tab = ttk.Frame(notebook, padding=12)
        notebook.add(player_tab, text="Player Upgrades")
        notebook.add(run_tab, text="Run Stats")

        self._build_upgrade_grid(player_tab)
        self._build_run_grid(run_tab)

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

    def _build_upgrade_grid(self, parent: ttk.Frame) -> None:
        for col in (0, 2):
            parent.columnconfigure(col, weight=1)

        for index, (label, key) in enumerate(PLAYER_UPGRADES):
            row = index // 2
            pair = index % 2
            label_col = pair * 2
            input_col = label_col + 1

            var = tk.StringVar(value="0")
            var.trace_add("write", self._mark_dirty)
            self.upgrade_vars[key] = var

            ttk.Label(parent, text=label).grid(
                row=row, column=label_col, sticky="w", padx=(0, 8), pady=6
            )
            spin = ttk.Spinbox(
                parent,
                from_=0,
                to=9999,
                textvariable=var,
                width=10,
            )
            spin.grid(
                row=row,
                column=input_col,
                sticky="ew",
                padx=(0 if pair else 0, 18 if not pair else 0),
                pady=6,
            )

    def _build_run_grid(self, parent: ttk.Frame) -> None:
        parent.columnconfigure(1, weight=1)

        for row, (label, key) in enumerate(RUN_STATS):
            var = tk.StringVar(value="0")
            var.trace_add("write", self._mark_dirty)
            self.run_vars[key] = var

            ttk.Label(parent, text=label).grid(
                row=row, column=0, sticky="w", padx=(0, 10), pady=7
            )
            ttk.Spinbox(
                parent,
                from_=-999999999,
                to=999999999,
                textvariable=var,
                width=18,
            ).grid(row=row, column=1, sticky="ew", pady=7)

    # ---------- Save discovery ----------

    def scan_default_saves(self) -> None:
        self.slot_list.delete(0, tk.END)
        self.slot_paths = []

        if not DEFAULT_SAVE_ROOT.exists():
            self.status_var.set(f"Default save directory not found: {DEFAULT_SAVE_ROOT}")
            return

        paths = sorted(
            (
                path
                for path in DEFAULT_SAVE_ROOT.rglob("REPO_SAVE_*.es3")
                if "BACKUP" not in path.name.upper()
            ),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )

        for path in paths:
            label = self._slot_label(path)
            self.slot_paths.append(path)
            self.slot_list.insert(tk.END, label)

        self.status_var.set(
            f"Found {len(paths)} main save file(s) under {DEFAULT_SAVE_ROOT}"
        )

    def _slot_label(self, path: Path) -> str:
        try:
            data = decrypt_save(path.read_bytes())
            validate_save(data)
            run = data["dictionaryOfDictionaries"]["value"]["runStats"]
            raw_level = run.get("level", 0)
            try:
                level = int(raw_level) + 1
            except (TypeError, ValueError):
                level = "?"
            team = get_team_name(data)
            date = get_date(data)
            return f"Lv {level} | {team} | {date} | {path.name}"
        except Exception:
            return f"Unreadable | {path.name}"

    def open_selected_slot(self) -> None:
        selection = self.slot_list.curselection()
        if not selection:
            messagebox.showinfo(APP_TITLE, "Select a save slot first.")
            return

        self.load_path(self.slot_paths[selection[0]])

    # ---------- Load ----------

    def open_file(self) -> None:
        filename = filedialog.askopenfilename(
            title="Open R.E.P.O. save",
            initialdir=DEFAULT_SAVE_ROOT if DEFAULT_SAVE_ROOT.exists() else None,
            filetypes=[("R.E.P.O. ES3 save", "*.es3"), ("All files", "*.*")],
        )
        if filename:
            self.load_path(Path(filename))

    def load_path(self, path: Path) -> None:
        if self.dirty and self.data is not None:
            if not messagebox.askyesno(
                APP_TITLE,
                "Discard unsaved field changes and open another save?",
            ):
                return

        try:
            data = decrypt_save(path.read_bytes())
            validate_save(data)
        except (OSError, SaveCryptoError, SaveSchemaError) as exc:
            messagebox.showerror(APP_TITLE, str(exc))
            self.status_var.set("Failed to load save.")
            return

        self.current_path = path
        self.data = data
        self.players = get_players(data)
        self.player_by_display = {p.display_name: p for p in self.players}

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

    # ---------- View refresh ----------

    def _refresh_metadata(self) -> None:
        assert self.data is not None

        run = self.data["dictionaryOfDictionaries"]["value"]["runStats"]
        raw_level = run.get("level", 0)
        try:
            display_level = int(raw_level) + 1
        except (TypeError, ValueError):
            display_level = "?"

        metadata = (
            f"Team: {get_team_name(self.data)}    "
            f"Level: {display_level}    "
            f"Date: {get_date(self.data)}    "
            f"Played: {format_duration(get_time_played_seconds(self.data))}"
        )
        self.meta_var.set(metadata)

    def _refresh_players(self) -> None:
        values = [player.display_name for player in self.players]
        self.player_combo["values"] = values

        if values:
            self.player_var.set(values[0])
            self._refresh_upgrade_fields()
            self._refresh_player_status_fields()
        else:
            self.player_var.set("")

    def _refresh_upgrade_fields(self) -> None:
        if self.data is None:
            return

        player = self._selected_player()
        if player is None:
            return

        for _label, key in PLAYER_UPGRADES:
            self.upgrade_vars[key].set(
                str(get_player_upgrade(self.data, player.player_id, key))
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
            value = get_run_stat(self.data, key)
            if key == "level":
                value += 1
            self.run_vars[key].set(str(value))

        self.dirty = False

    def _on_player_changed(self, _event: tk.Event | None = None) -> None:
        if self.dirty:
            if not self._apply_player_fields_only(show_errors=True):
                return
        self._refresh_upgrade_fields()
        self._refresh_player_status_fields()

    # ---------- Editing ----------

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
            for label, key in PLAYER_UPGRADES:
                value = self._parse_int(self.upgrade_vars[key].get(), label)
                if value < 0:
                    raise ValueError(f"{label} cannot be negative.")
                set_player_upgrade(self.data, player.player_id, key, value)

            current_health = self._parse_int(
                self.health_var.get(),
                "Current Health",
            )
            if current_health < 0:
                raise ValueError("Current Health cannot be negative.")
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

                # R.E.P.O. stores the run level zero-based internally.
                # The GUI shows the same one-based level the game displays.
                if key == "level":
                    if value < 1:
                        raise ValueError("Level must be at least 1.")
                    value -= 1

                set_run_stat(self.data, key, value)
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

    # ---------- Writing ----------

    def save_overwrite(self) -> None:
        if self.current_path is None or self.data is None:
            messagebox.showinfo(APP_TITLE, "Open a save first.")
            return

        if not self.apply_fields(show_success=False):
            return

        target = self.current_path
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = target.with_name(f"{target.name}.bak-{timestamp}")

        try:
            shutil.copy2(target, backup)
            self._write_atomic(target, encrypt_save(self.data))
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

        initial_name = (
            self.current_path.name if self.current_path else "REPO_SAVE_EDITED.es3"
        )
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
            self._write_atomic(target, encrypt_save(self.data))
        except OSError as exc:
            messagebox.showerror(APP_TITLE, f"Could not save file:\n{exc}")
            return

        self.current_path = target
        self.path_var.set(str(target))
        self.dirty = False
        self.status_var.set(f"Saved as {target.name}")

    @staticmethod
    def _write_atomic(path: Path, blob: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)

        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                prefix=f".{path.name}.",
                suffix=".tmp",
                dir=path.parent,
                delete=False,
            ) as temp:
                temp.write(blob)
                temp.flush()
                os.fsync(temp.fileno())
                temp_path = Path(temp.name)

            os.replace(temp_path, path)
        finally:
            if temp_path is not None and temp_path.exists():
                temp_path.unlink(missing_ok=True)

    # ---------- State ----------

    def _mark_dirty(self, *_args: object) -> None:
        if self.data is not None:
            self.dirty = True

    def _set_editor_enabled(self, enabled: bool) -> None:
        state = "readonly" if enabled else "disabled"
        self.player_combo.configure(state=state)


def run_gui() -> None:
    app = RepoSaveEditor()
    app.mainloop()
