"""Save-file loading, backup, and atomic persistence."""

from __future__ import annotations

import os
import tempfile
from collections.abc import Callable
from contextlib import suppress
from datetime import datetime
from pathlib import Path

from repo_save_editor.core.crypto import decrypt_save, encrypt_save
from repo_save_editor.core.schema import validate_run_save
from repo_save_editor.core.types import SaveData


class SaveBackupError(OSError):
    """Raised when the original save cannot be backed up safely."""


class SaveStaleError(OSError):
    """Raised when a save changes after the editor snapshot was opened."""


class SaveVerificationError(OSError):
    """Raised when staged encrypted output cannot be loaded exactly."""


class SaveWriteError(OSError):
    """Raised when staged output cannot atomically replace the source."""


class EncryptedSaveRepository:
    """Shared encrypted-save persistence with caller-owned schema validation."""

    def __init__(self, root: Path, validator: Callable[[SaveData], None]) -> None:
        self.root = root
        self.validator = validator

    def load(self, path: Path) -> SaveData:
        """Decrypt and validate one save."""
        return self.load_bytes(path.read_bytes())

    def load_bytes(self, blob: bytes) -> SaveData:
        """Decrypt and validate one in-memory save snapshot."""
        data = decrypt_save(blob)
        self.validator(data)
        return data

    def overwrite(
        self,
        path: Path,
        data: SaveData,
        *,
        expected_source: bytes | None = None,
    ) -> tuple[Path, bytes]:
        """Back up and atomically replace one encrypted save.

        Args:
            path: Existing save to replace.
            data: Validated decrypted data to persist.
            expected_source: Optional exact-byte snapshot used for stale-file checks.

        Returns:
            The backup path and final encrypted bytes.

        Raises:
            SaveStaleError: The source differs from the expected snapshot.
            SaveBackupError: An exact-byte backup cannot be created.
            SaveVerificationError: Staged output cannot be reopened exactly.
            SaveWriteError: Staging or atomic replacement fails.
        """
        self.validator(data)
        source = path.read_bytes()
        if expected_source is not None and source != expected_source:
            raise SaveStaleError("The save changed after it was opened.")

        backup = self._create_backup(path, source)
        written = encrypt_save(data)
        temp_path: Path | None = None
        try:
            temp_path = self._write_temp(path, written)
            try:
                if self.load(temp_path) != data:
                    raise SaveVerificationError("The staged save did not match the edited data.")
            except SaveVerificationError:
                raise
            except (OSError, ValueError) as exc:
                raise SaveVerificationError("The staged save could not be verified.") from exc

            if path.read_bytes() != source:
                raise SaveStaleError("The save changed while edits were being prepared.")
            try:
                os.replace(temp_path, path)
            except OSError as exc:
                raise SaveWriteError("The original save could not be replaced.") from exc
            temp_path = None
        except (SaveStaleError, SaveVerificationError, SaveWriteError):
            raise
        except OSError as exc:
            raise SaveWriteError("The edited save could not be staged.") from exc
        finally:
            if temp_path is not None:
                with suppress(OSError):
                    temp_path.unlink(missing_ok=True)
        return backup, written

    def save_as(self, path: Path, data: SaveData) -> None:
        """Write edited save data to a separate path atomically."""
        self.validator(data)
        self._write_atomic(path, encrypt_save(data))

    @staticmethod
    def _create_backup(path: Path, source: bytes) -> Path:
        timestamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")
        collision = 0
        while True:
            suffix = "" if collision == 0 else f"-{collision}"
            backup = path.with_name(f"{path.name}.bak-{timestamp}{suffix}")
            try:
                with backup.open("xb") as output:
                    output.write(source)
                    output.flush()
                    os.fsync(output.fileno())
                return backup
            except FileExistsError:
                collision += 1
            except OSError as exc:
                with suppress(OSError):
                    backup.unlink(missing_ok=True)
                raise SaveBackupError("The original save could not be backed up.") from exc

    @staticmethod
    def _write_temp(path: Path, blob: bytes) -> Path:
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
                temp_path = Path(temp.name)
                temp.write(blob)
                temp.flush()
                os.fsync(temp.fileno())
            return temp_path
        except OSError:
            if temp_path is not None:
                with suppress(OSError):
                    temp_path.unlink(missing_ok=True)
            raise

    @staticmethod
    def _write_atomic(path: Path, blob: bytes) -> None:
        temp_path = EncryptedSaveRepository._write_temp(path, blob)
        try:
            os.replace(temp_path, path)
        finally:
            with suppress(OSError):
                temp_path.unlink(missing_ok=True)


class SaveRepository(EncryptedSaveRepository):
    """Read and write local R.E.P.O. run saves."""

    def __init__(self, root: Path) -> None:
        super().__init__(root, validate_run_save)

    @staticmethod
    def load(path: Path) -> SaveData:
        """Decrypt and validate one run save."""
        return SaveRepository.load_bytes(path.read_bytes())

    @staticmethod
    def load_bytes(blob: bytes) -> SaveData:
        """Decrypt and validate one in-memory run save snapshot."""
        data = decrypt_save(blob)
        validate_run_save(data)
        return data
