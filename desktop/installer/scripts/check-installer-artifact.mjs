/** Verifies the WebView2-shell x64 NSIS installer and its staged production UI. */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hostRoot = path.join(desktopRoot, "build", "installer-host");
const packageJson = JSON.parse(await readFile(path.join(desktopRoot, "package.json"), "utf8"));
const nsisTarget = packageJson.build.win.target.find(({ target }) => target === "nsis");
const nsis = packageJson.build.nsis;
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

if (!nsisTarget?.arch.includes("x64")) {
  throw new Error("The Windows NSIS target must include x64.");
}

const requiredOptions = {
  oneClick: false,
  allowToChangeInstallationDirectory: false,
  perMachine: false,
  selectPerMachineByDefault: false,
  packElevateHelper: false,
  differentialPackage: false,
  createStartMenuShortcut: true,
  shortcutName: "RepoDitor",
  installerIcon: "public/icon.ico",
  uninstallerIcon: "public/icon.ico",
  include: "installer/installer.nsh",
  uninstallDisplayName: "RepoDitor",
};

for (const [option, expected] of Object.entries(requiredOptions)) {
  if (nsis[option] !== expected) {
    throw new Error(`NSIS option ${option} must be ${JSON.stringify(expected)}.`);
  }
}

if (nsis.script || nsis.deleteAppDataOnUninstall === true) {
  throw new Error(
    "The installer must use the focused include, not a replacement script or broad app-data deletion.",
  );
}

for (const option of ["installerHeader", "installerSidebar", "uninstallerSidebar"]) {
  if (nsis[option] !== undefined) {
    throw new Error(`Stock NSIS artwork option ${option} must not be configured.`);
  }
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

const installerName = nsis.artifactName
  .replace("${version}", packageJson.version)
  .replace("${arch}", "x64")
  .replace("${ext}", "exe");
const installer = await stat(path.join(desktopRoot, "release", installerName));

if (!installer.isFile() || installer.size === 0) {
  throw new Error(`${installerName} is not a non-empty installer file.`);
}

console.log(`${installerName} verified (${(installer.size / 1024 / 1024).toFixed(2)} MiB).`);
