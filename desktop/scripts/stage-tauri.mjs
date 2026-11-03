/** Stage an opt-in portable preview; production release output is never touched. */
import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = path.join(desktop, "build");
const destination = path.join(build, "tauri-preview");
const host = path.join(desktop, "src-tauri/target/release/repoditor-preview.exe");
const backend = path.join(build, "backend/repoditor-backend");
await access(host);
await access(path.join(backend, "repoditor-backend.exe"));
await access(path.join(backend, "_internal/python313.dll"));
if (!path.resolve(destination).startsWith(`${path.resolve(build)}${path.sep}`))
  throw new Error("Invalid preview output directory.");
await rm(destination, { recursive: true, force: true });
await mkdir(path.join(destination, "licenses"), { recursive: true });
await cp(host, path.join(destination, "repoditor-preview.exe"));
await cp(backend, path.join(destination, "backend"), { recursive: true });
await cp(path.join(desktop, "../LICENSE"), path.join(destination, "licenses/RepoDitor-MIT.txt"));
await cp(
  path.join(desktop, "src/assets/fonts/teko/OFL.txt"),
  path.join(destination, "licenses/Teko-OFL.txt"),
);
console.log(`Portable discovery preview staged in ${destination}`);
