/** Verifies the configured assisted x64 NSIS installer and its exact output artifact. */
import { readFile, stat } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const nsisTarget = packageJson.build.win.target.find(({ target }) => target === "nsis");
const nsis = packageJson.build.nsis;

if (!nsisTarget?.arch.includes("x64")) {
  throw new Error("The Windows NSIS target must include x64.");
}

const requiredOptions = {
  oneClick: false,
  allowToChangeInstallationDirectory: true,
  perMachine: false,
  selectPerMachineByDefault: false,
  packElevateHelper: false,
  differentialPackage: false,
  createStartMenuShortcut: true,
  shortcutName: "RepoDitor",
  installerIcon: "public/icon.ico",
  uninstallerIcon: "public/icon.ico",
  uninstallDisplayName: "RepoDitor",
};

for (const [option, expected] of Object.entries(requiredOptions)) {
  if (nsis[option] !== expected) {
    throw new Error(`NSIS option ${option} must be ${JSON.stringify(expected)}.`);
  }
}

if (nsis.include || nsis.script || nsis.deleteAppDataOnUninstall === true) {
  throw new Error("Custom NSIS scripts and application-data deletion are not allowed.");
}

const installerName = nsis.artifactName
  .replace("${version}", packageJson.version)
  .replace("${arch}", "x64")
  .replace("${ext}", "exe");
const installer = await stat(new URL(`../release/${installerName}`, import.meta.url));

if (!installer.isFile() || installer.size === 0) {
  throw new Error(`${installerName} is not a non-empty installer file.`);
}

console.log(`${installerName} verified (${(installer.size / 1024 / 1024).toFixed(2)} MiB).`);
