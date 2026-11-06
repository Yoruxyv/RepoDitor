/** Stage an opt-in portable preview; production release output is never touched. */
import { execFile } from "node:child_process";
import { access, cp, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const build = path.join(desktop, "build");
const run = promisify(execFile);

export async function checkArtifact(host, backend) {
  const { stdout } = await run(
    "uv",
    [
      "run",
      "--python",
      "3.13",
      "--locked",
      "--group",
      "package",
      "--project",
      path.dirname(desktop),
      "python",
      path.join(desktop, "scripts/tauri/check-tauri-artifact.py"),
      host,
      path.join(backend, "repoditor-backend.exe"),
    ],
    { cwd: desktop, windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 },
  );
  return JSON.parse(stdout);
}

export async function stagePreview(host, backend, destination) {
  destination = path.resolve(destination);
  if (!destination.startsWith(`${build}${path.sep}`))
    throw new Error("Invalid preview output directory.");
  await access(path.join(backend, "_internal/python313.dll"));
  await checkArtifact(host, backend);
  await mkdir(path.dirname(destination), { recursive: true });
  const parent = await realpath(path.dirname(destination));
  const root = await realpath(build);
  if (parent !== root && !parent.startsWith(`${root}${path.sep}`))
    throw new Error("Preview output escapes the build directory.");
  const previous = await lstat(destination).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (previous?.isSymbolicLink()) throw new Error("Preview output cannot be a link.");
  const temporary = await mkdtemp(path.join(path.dirname(destination), ".tauri-stage-"));
  await cp(host, path.join(temporary, "repoditor-preview.exe"), { dereference: true });
  await mkdir(path.join(temporary, "backend"));
  await cp(
    path.join(backend, "repoditor-backend.exe"),
    path.join(temporary, "backend/repoditor-backend.exe"),
    { dereference: true },
  );
  const authority = await checkArtifact(
    path.join(temporary, "repoditor-preview.exe"),
    path.join(temporary, "backend"),
  );
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.join(destination, "licenses"), { recursive: true });
  await cp(backend, path.join(destination, "backend"), { recursive: true, dereference: true });
  await cp(
    path.join(temporary, "repoditor-preview.exe"),
    path.join(destination, "repoditor-preview.exe"),
  );
  await cp(
    path.join(temporary, "backend/repoditor-backend.exe"),
    path.join(destination, "backend/repoditor-backend.exe"),
  );
  const published = await checkArtifact(
    path.join(destination, "repoditor-preview.exe"),
    path.join(destination, "backend"),
  );
  if (
    published.hostSha256 !== authority.hostSha256 ||
    published.backendSha256 !== authority.backendSha256
  )
    throw new Error("Staged executable bytes changed during publication.");
  await cp(path.join(desktop, "../LICENSE"), path.join(destination, "licenses/RepoDitor-MIT.txt"));
  await cp(
    path.join(desktop, "src/assets/fonts/teko/OFL.txt"),
    path.join(destination, "licenses/Teko-OFL.txt"),
  );
  await writeFile(
    path.join(destination, "artifact-check.json"),
    JSON.stringify(published, null, 2),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = path.join(build, "tauri-preview");
  await stagePreview(
    path.join(desktop, "src-tauri/target/release/repoditor-preview.exe"),
    path.join(build, "backend/repoditor-backend"),
    destination,
  );
  console.log(`Read-only portable discovery preview staged in ${destination}`);
}
