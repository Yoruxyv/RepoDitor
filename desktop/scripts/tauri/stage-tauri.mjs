/** Stage the verified portable Windows package. */
import { execFile } from "node:child_process";
import { access, cp, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const build = path.join(desktop, "build");
const hostName = "RepoDitor.exe";
const run = promisify(execFile);

export async function checkArtifact(host, backend, expectedAuthority = "read-only") {
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
      expectedAuthority,
    ],
    { cwd: desktop, windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 },
  );
  return JSON.parse(stdout);
}

export async function stagePreview(host, backend, destination, expectedAuthority = "read-only") {
  destination = path.resolve(destination);
  if (!destination.startsWith(`${build}${path.sep}`))
    throw new Error("Invalid preview output directory.");
  await access(path.join(backend, "_internal/python313.dll"));
  await checkArtifact(host, backend, expectedAuthority);
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
  await cp(host, path.join(temporary, hostName), { dereference: true });
  await mkdir(path.join(temporary, "backend"));
  await cp(
    path.join(backend, "repoditor-backend.exe"),
    path.join(temporary, "backend/repoditor-backend.exe"),
    { dereference: true },
  );
  const authority = await checkArtifact(
    path.join(temporary, hostName),
    path.join(temporary, "backend"),
    expectedAuthority,
  );
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.join(destination, "licenses"), { recursive: true });
  await cp(backend, path.join(destination, "backend"), { recursive: true, dereference: true });
  await cp(path.join(temporary, hostName), path.join(destination, hostName));
  await cp(
    path.join(temporary, "backend/repoditor-backend.exe"),
    path.join(destination, "backend/repoditor-backend.exe"),
  );
  const published = await checkArtifact(
    path.join(destination, hostName),
    path.join(destination, "backend"),
    expectedAuthority,
  );
  if (
    published.hostSha256 !== authority.hostSha256 ||
    published.backendSha256 !== authority.backendSha256
  )
    throw new Error("Staged executable bytes changed during publication.");
  await cp(path.join(desktop, "../LICENSE"), path.join(destination, "licenses/RepoDitor-MIT.txt"));
  await cp(
    path.join(desktop, "../THIRD_PARTY_NOTICES.md"),
    path.join(destination, "licenses/THIRD_PARTY_NOTICES.md"),
  );
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
  const publicEditing = process.argv[2] === "--public-editing";
  const destination = path.join(build, publicEditing ? "tauri-release" : "tauri-portable");
  await stagePreview(
    path.join(desktop, "src-tauri/target/release", hostName),
    path.join(build, "backend/repoditor-backend"),
    destination,
    publicEditing ? "public-editing" : "read-only",
  );
  console.log(`Verified portable package staged in ${destination}`);
}
