import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const desktop = path.resolve(import.meta.dirname, "../..");
const build = path.join(desktop, "build", "release-installer");
await mkdir(build, { recursive: true });
const pkg = JSON.parse(await readFile(path.join(desktop, "package.json"), "utf8"));
const version = pkg.devDependencies["@tauri-apps/cli"];
const templates = {
  "2.12.4": "d00089d3b1a2c4a30d7b6e098079100cb8f25e980f84d4515aca4597b95e967d",
};
const pinned = templates[version];
if (!pinned) throw new Error("Review the NSIS handoff against the pinned Tauri CLI version.");
const upstream = path.join(build, "upstream.nsi");
let source = await readFile(upstream).catch((error) => {
  if (error.code !== "ENOENT") throw error;
  return null;
});
if (!source) {
  const response = await fetch(
    "https://raw.githubusercontent.com/tauri-apps/tauri/tauri-cli-v" +
      version +
      "/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi",
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw new Error("Unable to obtain the pinned Tauri NSIS template.");
  source = Buffer.from(await response.arrayBuffer());
}
if (createHash("sha256").update(source).digest("hex") !== pinned)
  throw new Error("Tauri NSIS template fingerprint does not match the reviewed version.");
await writeFile(upstream, source);

let template = source.toString("utf8");
function insert(anchor, replacement) {
  if (template.split(anchor).length !== 2)
    throw new Error("The NSIS template handoff anchor changed.");
  template = template.replace(anchor, () => replacement);
}

const host = path.join(desktop, "build", "installer-host");
await readFile(path.join(host, "RepoDitorInstallerHost.exe"));
insert("{{#if installer_hooks}}", '!define REPODITOR_HOST "' + host + '"\n{{#if installer_hooks}}');
insert(
  "FunctionEnd\n\nSection WebView2",
  "  !insertmacro RepoDitorSelectHost\nFunctionEnd\n\nSection WebView2",
);

template = template.replaceAll(
  '          Abort "$(webview2AbortError)"',
  '          ${If} $RepoDitorInteractive == 1\n' +
    '            MessageBox MB_ICONSTOP "$(webview2AbortError)"\n' +
    '          ${EndIf}\n' +
    '          Abort "$(webview2AbortError)"',
);
insert(
  "Section Install\n",
  "Section Install\n  !insertmacro RepoDitorShowHost\n  !insertmacro RepoDitorCheckDestination\n",
);
insert(
  "FunctionEnd\n\nSection Uninstall",
  "  !insertmacro RepoDitorUninstallHost\nFunctionEnd\n\nSection Uninstall",
);
const templatePath = path.join(build, "installer.nsi");
await writeFile(templatePath, template);

const base = JSON.parse(await readFile(path.join(desktop, "src-tauri", "tauri.conf.json"), "utf8"));
const commands = [
  "health-state",
  "health-write",
  "health-recover",
  "meta-state",
  "meta-write",
  "meta-recover",
  "meta-close",
];
const capabilities = base.app.security.capabilities.concat({
  identifier: "public-editing",
  windows: ["main"],
  permissions: commands.map((command) => "allow-production-" + command),
});
await writeFile(
  path.join(build, "public-editing.json"),
  JSON.stringify({ app: { security: { capabilities } } }, null, 2),
);
