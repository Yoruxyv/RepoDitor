"""Retire only executable copies made by the current Windows safety run."""

import ctypes
import hashlib
import json
import msvcrt
import os
import re
import shutil
import stat
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from windows_test_job import TestJob

from repo_save_editor.storage.windows_save_directory import IoStatus, SaveDirectory

DESKTOP = Path(__file__).resolve().parents[2]
RUN_VARIABLES = (
    "REPODITOR_NATIVE_RUN_ID",
    "REPODITOR_NATIVE_RUN_OUTPUT",
    "REPODITOR_NATIVE_RUN_FIXTURES",
)
GIB = 1024**3
JOURNAL_LIMIT = 1024 * 1024
HOSTS = {"default", "production", "protocol", "no-acl", "ui"}
SHA256 = re.compile(r"[0-9a-f]{64}")
RUN_ID = re.compile(r"[0-9a-f]{32}")


def file_record(stream):
    info = os.fstat(stream.fileno())
    return {
        "identity": [info.st_dev, info.st_ino, info.st_ctime_ns],
        "size": info.st_size,
        "links": info.st_nlink,
        "sha256": hashlib.file_digest(stream, "sha256").hexdigest(),
    }


def canonical_handle_path(folder, stream):
    kernel = folder.kernel
    kernel.GetFinalPathNameByHandleW.argtypes = [
        ctypes.c_void_p,
        ctypes.c_wchar_p,
        ctypes.c_ulong,
        ctypes.c_ulong,
    ]
    kernel.GetFinalPathNameByHandleW.restype = ctypes.c_ulong
    output = ctypes.create_unicode_buffer(32768)
    length = kernel.GetFinalPathNameByHandleW(
        msvcrt.get_osfhandle(stream.fileno()), output, len(output), 0
    )
    if not 0 < length < len(output) or not output.value.startswith("\\\\?\\"):
        raise OSError("Cannot identify the canonical native artifact path")
    return Path(output.value[4:])


class ArtifactDirectory(SaveDirectory):
    def create_file(self, path):
        # FILE_CREATE, with no write/delete sharing, keeps the created identity pinned.
        handle = self._open(self.handles[-1], self._leaf(path), 0xC0100000, 2, 0x200062, 1)
        return self.stream(handle, "w+b", os.O_RDWR)

    def open_for_retirement(self, path):
        handle = self._open(self.handles[-1], self._leaf(path), 0x80110000, 1, 0x200062, 0)
        return self.stream(handle, "rb", os.O_RDONLY)

    def stream(self, handle, mode, flags):
        try:
            descriptor = msvcrt.open_osfhandle(handle, os.O_BINARY | flags)
        except BaseException:
            self.kernel.CloseHandle(handle)
            raise
        try:
            return os.fdopen(descriptor, mode)
        except BaseException:
            os.close(descriptor)
            raise

    def delete_checked(self, stream):
        # Ordinary Windows deletion semantics keep mapped images protected.
        delete, status = ctypes.c_ubyte(1), IoStatus()
        self._check(
            self.native.NtSetInformationFile(
                msvcrt.get_osfhandle(stream.fileno()),
                ctypes.byref(status),
                ctypes.byref(delete),
                1,
                13,
            )
        )

    def create_directory(self):
        handle = self._open(self.handles[-1], self.path.name, 0x1000A1, 2, 0x200021, 3)
        self.kernel.CloseHandle(handle)


class RunArtifacts:
    def __init__(self, run_id, output, fixtures):
        if not RUN_ID.fullmatch(run_id) or not output.is_absolute() or not fixtures.is_absolute():
            raise ValueError("Invalid native safety run identity")
        self.run_id, self.output, self.fixtures = run_id, output, fixtures
        self.manifest = output / "executable-manifest.jsonl"
        self.receipt = output / "validation-passed.json"
        self.header = {"run_id": run_id, "output": str(output), "fixtures": str(fixtures)}

    def initialize(self):
        with SaveDirectory(self.manifest) as folder, folder.open(self.manifest, "xb") as stream:
            stream.write(encode(self.header))

    def candidate(self, path):
        if path.is_relative_to(self.fixtures):
            relative = path.relative_to(self.fixtures)
            parts = relative.parts
            if len(parts) >= 2 and (
                path.name in {"repoditor-preview.exe", "repoditor-preview-ordinary.exe"}
                or parts[-2:] == ("backend", "repoditor-backend.exe")
                or (path.name == "REPO.exe" and "SteamLibrary" in parts[:-1])
            ):
                return "fixture", relative.as_posix()
        if path.is_relative_to(self.output):
            relative = path.relative_to(self.output)
            parts = relative.parts
            if (
                len(parts) == 3
                and parts[0] == "hosts"
                and parts[1] in HOSTS
                and parts[2] == "repoditor-preview.exe"
            ):
                return "runner", relative.as_posix()
        raise ValueError("Executable copy is outside the owned output or has an unsupported name")

    def copy(self, source, destination):
        owner, relative = self.candidate(destination)
        if ".." in destination.parts:
            raise ValueError("Invalid native artifact path")
        with (
            SaveDirectory(self.manifest) as journal,
            journal.open(self.manifest, "a+b") as manifest,
        ):
            manifest.seek(0)
            if manifest.readline(JOURNAL_LIMIT) != encode(self.header):
                raise ValueError("The executable manifest belongs to a different run")
            with (
                source.open("rb") as original,
                ArtifactDirectory(destination) as folder,
                folder.create_file(destination) as copy,
            ):
                shutil.copyfileobj(original, copy, 1024 * 1024)
                copy.flush()
                os.fsync(copy.fileno())
                copy.seek(0)
                canonical = canonical_handle_path(folder, copy)
                if canonical != destination:
                    raise OSError("Native artifact path differs from its opened name")
                record = {
                    **file_record(copy),
                    "parent_identity": folder.identity,
                    "run_id": self.run_id,
                    "path": str(canonical),
                    "relative_path": relative,
                    "owner": owner,
                    "eligible": True,
                }
            # A CRT descriptor obtained from a Windows handle does not inherit Python's append flag.
            manifest.seek(0, os.SEEK_END)
            manifest.write(encode(record))
            manifest.flush()
            os.fsync(manifest.fileno())

    def seal(self):
        receipt = self.receipt_for(*self.read_manifest())
        with SaveDirectory(self.receipt) as folder, folder.open(self.receipt, "xb") as stream:
            stream.write(receipt)

    def receipt_for(self, data, records):
        return encode(
            {
                "run_id": self.run_id,
                "records": len(records),
                "manifest_sha256": hashlib.sha256(data).hexdigest(),
            }
        )

    def read_seal(self):
        with SaveDirectory(self.receipt) as folder, folder.open(self.receipt) as stream:
            return stream.read(512)

    def read_manifest(self):
        with SaveDirectory(self.manifest) as folder, folder.open(self.manifest) as stream:
            data = stream.read(JOURNAL_LIMIT + 1)
        if len(data) > JOURNAL_LIMIT or not data.endswith(b"\n"):
            raise ValueError("Executable manifest is incomplete or too large")
        header, *records = (json.loads(line) for line in data.splitlines())
        if header != self.header:
            raise ValueError("The executable manifest belongs to a different run")
        seen = set()
        for record in records:
            path = Path(record["path"])
            owner, relative = self.candidate(path)
            identity = record["identity"]
            if (
                str(path) != record["path"]
                or ".." in path.parts
                or path in seen
                or record["run_id"] != self.run_id
                or record["eligible"] is not True
                or (record["owner"], record["relative_path"]) != (owner, relative)
                or not isinstance(identity, list)
                or len(identity) != 3
                or any(type(value) is not int or value < 0 for value in identity)
                or record["links"] != 1
                or not SHA256.fullmatch(record["parent_identity"])
                or type(record["size"]) is not int
                or record["size"] <= 0
                or not SHA256.fullmatch(record["sha256"])
            ):
                raise ValueError("Invalid executable ownership record")
            seen.add(path)
        return data, records

    def finish(self, *, passed, keep, job, seal=None, build_uploaders=(), timeout=5):
        report = {
            "run_id": self.run_id,
            "state": "retained",
            "generated_bytes": None,
            "retired_bytes": 0,
            "retained_bytes": None,
            "files": [],
            "error": None,
            "processes_exited": False,
            "remaining_processes": None,
        }
        try:
            data, records = self.read_manifest()
            if passed and seal is not None and seal != self.receipt_for(data, records):
                raise ValueError("The executable manifest changed after validation")
            if passed and not records:
                raise ValueError("The executable manifest has no creation records")
        except (OSError, ValueError, TypeError, KeyError) as error:
            report.update(state="error", error=str(error))
            return report
        report["generated_bytes"] = sum(record["size"] for record in records)
        report["retained_bytes"] = 0
        self.record_process_exit(report, job, passed, timeout, build_uploaders)
        if not passed or keep or not report["processes_exited"]:
            report.update(retained_bytes=report["generated_bytes"])
            if not passed or keep:
                report["reason"] = "run did not pass" if not passed else "explicit retention"
            return report

        report["state"] = "cleaned"
        for record in records:
            result = {key: record[key] for key in ("owner", "relative_path", "size")}
            try:
                retire(record)
            except FileNotFoundError:
                result["status"] = "missing"
                report["missing_bytes"] = report.get("missing_bytes", 0) + record["size"]
            except OSError as error:
                result.update(status="retained", error=error.strerror or str(error))
                report["state"] = "error"
                report["retained_bytes"] += record["size"]
            else:
                result["status"] = "deleted"
                report["retired_bytes"] += record["size"]
            report["files"].append(result)
        return report

    @staticmethod
    def record_process_exit(report, job, passed, timeout, build_uploaders):
        try:
            job.wait_until_idle(
                timeout if passed else 0, build_uploaders=build_uploaders if passed else ()
            )
            report["remaining_processes"] = job.remaining_images()
            if report["remaining_processes"]:
                raise OSError("Native job diagnostic snapshot is nonempty at retirement")
            if job.active_processes():
                raise OSError("Native job accounting is nonzero at retirement")
        except OSError as error:
            report["process_check_error"] = str(error)
            if report["remaining_processes"] is None:
                try:
                    report["remaining_processes"] = job.remaining_images()
                except OSError as diagnostic_error:
                    report["process_diagnostic_error"] = str(diagnostic_error)
            if passed:
                report.update(state="error", error=str(error))
        else:
            report["processes_exited"] = True


def encode(record):
    return (json.dumps(record, separators=(",", ":")) + "\n").encode()


def retire(record):
    path = Path(record["path"])
    with ArtifactDirectory(path) as folder, folder.open_for_retirement(path) as stream:
        attributes = os.fstat(stream.fileno()).st_file_attributes
        if (
            attributes & 0x400
            or folder.identity != record["parent_identity"]
            or canonical_handle_path(folder, stream) != path
            or any(record[key] != value for key, value in file_record(stream).items())
        ):
            raise OSError("Executable changed since staging")
        folder.delete_checked(stream)


def new_directory(path):
    with ArtifactDirectory(path) as parent:
        parent.create_directory()


def owned_bytes(root):
    total = 0
    pending = [root]
    while pending:
        folder = pending.pop()
        with SaveDirectory(folder / "unused"), os.scandir(folder) as entries:
            for entry in entries:
                info = entry.stat(follow_symlinks=False)
                if info.st_file_attributes & 0x400:
                    continue
                if stat.S_ISDIR(info.st_mode):
                    pending.append(Path(entry.path))
                elif stat.S_ISREG(info.st_mode):
                    total += info.st_size
    return total


def run_paths(output_name):
    build = DESKTOP / "build"
    output = DESKTOP / output_name
    if ".." in output.parts or output.drive != build.drive:
        raise ValueError("Use an ordinary report path inside desktop/build")
    if output == build or not output.is_relative_to(build):
        raise ValueError("Output must be inside desktop/build")
    native_parent = build / "recovery-checkpoint"
    fixtures = native_parent / "-".join(output.relative_to(build).parts)
    if output == native_parent or output.is_relative_to(native_parent):
        raise ValueError("Report output must be outside the native fixture tree")
    return build, output, fixtures


def msvc_uploaders():
    installer = Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"))
    vswhere = installer / "Microsoft Visual Studio/Installer/vswhere.exe"
    if not vswhere.is_file():
        return ()
    result = subprocess.run(  # noqa: S603 - fixed installed tool and fixed query
        [
            str(vswhere),
            "-all",
            "-products",
            "*",
            "-utf8",
            "-find",
            r"VC\Tools\MSVC\*\bin\Host*\*\vctip.exe",
        ],
        check=True,
        capture_output=True,
        encoding="utf-8",
        timeout=5,
    )
    return tuple(Path(line).resolve(strict=True) for line in result.stdout.splitlines() if line)


def run_gate(shell, output_name, keep, warning_gib, mode, normal, fault):
    build, output, fixtures = run_paths(output_name)
    with SaveDirectory(DESKTOP / "unused") as desktop:
        volume, directory = desktop._directory_identity(desktop.handles[-1])
    with TestJob(f"Global\\RepoDitor.NativeSafety.{volume:x}.{directory}") as job:
        build_uploaders = msvc_uploaders()
        for parent in (*reversed(output.parents), fixtures.parent):
            if parent.is_relative_to(build) and not parent.is_dir():
                new_directory(parent)
        if output.exists() or fixtures.exists():
            raise ValueError("Use a fresh output directory; previous diagnostics are preserved")
        new_directory(output)
        new_directory(fixtures)
        artifacts = RunArtifacts(uuid4().hex, output, fixtures)
        artifacts.initialize()

        free = shutil.disk_usage(output).free
        # The full run has historically made 76-77 game copies plus the startup control.
        node = shutil.which("node")
        if node is None:
            raise ValueError("Cannot estimate native artifact growth without Node")
        copies = {"full": 100, "compare": 6, "browser": 1}[mode]
        estimated = copies * Path(node).stat().st_size + 2 * GIB
        reserve = int(float(warning_gib) * GIB)
        sys.stdout.write(
            f"Native run {artifacts.run_id}: {free} bytes free; estimated growth {estimated} bytes; "
            f"warn below {reserve} bytes projected free.\nReports: {output}\nFixtures: {fixtures}\n"
        )
        if free - estimated < reserve:
            sys.stderr.write(
                "WARNING: Estimated native-test growth leaves less than the configured reserve.\n"
            )
        sys.stdout.flush()

        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
        env.update(zip(RUN_VARIABLES, (artifacts.run_id, str(output), str(fixtures)), strict=True))
        command = [
            shell,
            "-NoProfile",
            "-File",
            str(Path(__file__).with_name("test-tauri-safety.ps1")),
            "-CoordinatedRun",
            artifacts.run_id,
        ]
        if mode != "full":
            command.append("-CompareStartup" if mode == "compare" else "-TestBrowserArgs")
        for flag, value in (("-NormalBackend", normal), ("-FaultBackend", fault)):
            if value:
                command.extend((flag, value))
        started = datetime.now(UTC).isoformat()
        exit_code, passed, seal = 1, False, None
        try:
            exit_code = job.run(command, env)
            if exit_code == 0:
                seal = artifacts.read_seal()
                passed = True
        finally:
            report = artifacts.finish(
                passed=passed,
                keep=keep == "1" or mode == "compare",
                job=job,
                seal=seal,
                build_uploaders=build_uploaders,
            )
            report.update(
                free_before=free,
                free_after=shutil.disk_usage(output).free,
                estimated_bytes=estimated,
                warning_reserve_bytes=reserve,
                validation_passed=passed,
                started_utc=started,
                finished_utc=datetime.now(UTC).isoformat(),
            )
            if report["processes_exited"]:
                try:
                    report["run_output_bytes"] = owned_bytes(output) + owned_bytes(fixtures)
                    report["run_generated_bytes"] = (
                        report["run_output_bytes"] + report["retired_bytes"]
                    )
                except OSError as error:
                    report["output_measurement_error"] = str(error)
            report_path = output / "artifact-retention.json"
            with SaveDirectory(report_path) as folder, folder.open(report_path, "xb") as stream:
                stream.write(encode(report))
            sys.stdout.write(
                f"Native executable bytes: {report['generated_bytes']} generated, "
                f"{report['retired_bytes']} retired, {report['retained_bytes']} retained. "
                f"Retention state: {report['state']}. Details: {report_path}\n"
            )
        return 0 if passed and report["state"] != "error" else exit_code or 1


if __name__ == "__main__":
    try:
        verb, *arguments = sys.argv[1:]
        if verb in {"copy", "seal"}:
            run_id, output, fixtures = (os.environ[name] for name in RUN_VARIABLES)
            artifacts = RunArtifacts(run_id, Path(output), Path(fixtures))
            if verb == "copy":
                artifacts.copy(*map(Path, arguments))
            else:
                artifacts.seal()
        elif verb == "run":
            sys.exit(run_gate(*arguments))
        else:
            raise ValueError("Unknown native artifact command")
    except (OSError, ValueError, KeyError, KeyboardInterrupt, subprocess.SubprocessError) as exc:
        sys.exit(f"Native artifact lifecycle stopped: {exc or 'interrupted'}")
