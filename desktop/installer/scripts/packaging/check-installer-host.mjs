/** Verifies the staged Windows installer host and its production UI. */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const hostRoot = path.join(desktopRoot, "build", "installer-host");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(entryPath)));
    else files.push(entryPath);
  }
  return files;
}

const hostFiles = await collectFiles(hostRoot);
const relativeHostFiles = hostFiles.map((file) =>
  path.relative(hostRoot, file).replaceAll("\\", "/"),
);
for (const required of [
  "RepoDitorInstallerHost.exe",
  "Microsoft.Web.WebView2.Core.dll",
  "Microsoft.Web.WebView2.WinForms.dll",
  "WebView2Loader.dll",
  "Microsoft.Web.WebView2.LICENSE.txt",
  "Microsoft.Web.WebView2.NOTICE.txt",
  "icon.ico",
  "index.html",
]) {
  if (!relativeHostFiles.includes(required))
    throw new Error(`Installer host is missing ${required}.`);
}
if (!relativeHostFiles.some((file) => /^assets\/.+\.js$/.test(file))) {
  throw new Error("Installer host is missing the compiled installer JavaScript.");
}
if (!relativeHostFiles.some((file) => /^assets\/.+\.css$/.test(file))) {
  throw new Error("Installer host is missing the compiled installer CSS.");
}
if (relativeHostFiles.some((file) => /\.(?:map|ts|tsx)$/.test(file))) {
  throw new Error("Installer host contains development source or source maps.");
}

const [artwork, stagedIndex, ...stagedFiles] = await Promise.all([
  readFile(path.join(desktopRoot, "installer", "assets", "ArtWork.png")),
  readFile(path.join(hostRoot, "index.html"), "utf8"),
  ...hostFiles.map((file) => readFile(file)),
]);
if (!new Set(stagedFiles.map(sha256)).has(sha256(artwork))) {
  throw new Error("Installer host does not contain the approved artwork.");
}
if (/\/src\/main\.tsx|@vite\/client|localhost:5173/.test(stagedIndex)) {
  throw new Error("Installer host contains a development UI entry point.");
}

console.log("Verified staged installer host, WebView2 dependencies, artwork and production UI.");
