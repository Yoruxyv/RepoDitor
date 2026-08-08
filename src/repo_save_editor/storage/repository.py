"""Save-file loading, backup, and atomic persistence."""

from __future__ import annotations

import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

from repo_save_editor.core.crypto import decrypt_save, encrypt_save
from repo_save_editor.core.schema import validate_run_save
from repo_save_editor.core.types import SaveData


class SaveRepository:
    """Read and write local R.E.P.O. run saves."""

    def __init__(self, root: Path) -> None:
        self.root = root

    @staticmethod
    def load(path: Path) -> SaveData:
        """Decrypt and validate one run save."""
        data = decrypt_save(path.read_bytes())
        validate_run_save(data)
        return data

    def overwrite(self, path: Path, data: SaveData) -> Path:
        """Back up ``path`` and atomically replace it with edited save data."""
        timestamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")
        backup = path.with_name(f"{path.name}.bak-{timestamp}")
        shutil.copy2(path, backup)
        self._write_atomic(path, encrypt_save(data))
        return backup

    def save_as(self, path: Path, data: SaveData) -> None:
        """Write edited save data to a separate path atomically."""
        self._write_atomic(path, encrypt_save(data))

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
