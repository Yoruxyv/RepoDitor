import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installerRoot = path.join(desktopRoot, "installer");
const uiSourceRoot = path.join(installerRoot, "ui");
const uiBuildRoot = path.join(desktopRoot, "build", "installer-ui");
const builderRoot = path.dirname(require.resolve("app-builder-lib/package.json"));
const builderTemplate = (...segments) => path.join(builderRoot, "templates", "nsis", ...segments);
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

async function readHostSources() {
  const files = (await collectFiles(path.join(installerRoot, "host")))
    .filter((file) => file.endsWith(".cs"))
    .sort();
  assert.ok(files.length > 0, "The native host source set is empty");
  return Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")]));
}

function classSource(sources, name) {
  const matches = sources.filter(([, source]) => new RegExp(`\\bclass ${name}\\b`).test(source));
  assert.equal(matches.length, 1, `Expected one owner of ${name}`);
  return matches[0][1];
}

test("native responsibilities remain cohesive and the bridge allowlist matches the UI", async () => {
  const [sources, uiBridge] = await Promise.all([
    readHostSources(),
    readFile(path.join(uiSourceRoot, "src", "bridge", "webview.ts"), "utf8"),
  ]);
  const program = classSource(sources, "Program");
  assert.equal([...program.matchAll(/\bclass \w+/g)].length, 1);
  assert.match(program, /Arguments\.Parse\(args\)/);
  assert.match(program, /Application\.Run\(window\)/);
  assert.doesNotMatch(program, /ProcessStartInfo|CoreWebView2|Registry\.|Task\.Delay/);

  const window = classSource(sources, "InstallerWindow");
  assert.match(window, /Controls\.Add\(_bridge\.View\)/);
  assert.match(window, /await _bridge\.InitializeAsync\(\)/);
  assert.match(window, /await _engine\.RunAsync\(_scope, _selectedPath\)/);
  assert.match(window, /_engine\.Dispose\(\)/);
  assert.doesNotMatch(window, /CoreWebView2|WaitForExit|Registry\.|"runas"/);
  assert.doesNotMatch(classSource(sources, "InstallerEngine"), /WebView2|MessageBox|\bForm\b/);
  assert.doesNotMatch(classSource(sources, "Arguments"), /internal (?:string|bool|int) \w+\s*[=;]/);

  const bridge = classSource(sources, "WebViewBridge");
  const nativeCommands = [...bridge.matchAll(/case "([^"]+)":/g)].map((match) => match[1]);
  const uiCommands = uiBridge.match(/installerCommands = \[(?<commands>[\s\S]*?)\] as const/)
    ?.groups?.commands;
  assert.ok(uiCommands);
  assert.deepEqual(
    nativeCommands.sort(),
    [...uiCommands.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort(),
  );
  assert.match(bridge, /TryGetWebMessageAsString\(\)/);
  assert.match(bridge, /catch \(ArgumentException\) \{ return; \}/);
  assert.match(bridge, /if \(_ready && _webView\.CoreWebView2 != null\)/);
  assert.match(bridge, /PostWebMessageAsJson\(_json\.Serialize\(message\)\)/);

  const cleanup = classSource(sources, "Cleanup");
  assert.match(program, /Cleanup\.Schedule\(AppDomain\.CurrentDomain\.BaseDirectory\)/);
  assert.match(cleanup, /MoveFileEx/);
  assert.doesNotMatch(
    cleanup,
    /ApplicationData|LocalApplicationData|LocalLow|semiwork|Directory\.Delete/,
  );
});

test("electron-builder keeps ownership of the x64 NSIS lifecycle", () => {
  const nsisTarget = packageJson.build.win.target.find(({ target }) => target === "nsis");
  const nsis = packageJson.build.nsis;

  assert.deepEqual(nsisTarget?.arch, ["x64"]);
  assert.equal(nsis.oneClick, false);
  assert.equal(nsis.allowToChangeInstallationDirectory, false);
  assert.equal(nsis.perMachine, false);
  assert.equal(nsis.packElevateHelper, false);
  assert.equal(nsis.include, "installer/installer.nsh");
  assert.equal(nsis.installerIcon, "public/icon.ico");
  assert.equal(nsis.uninstallerIcon, "public/icon.ico");
  assert.equal(nsis.installerHeader, undefined);
  assert.equal(nsis.installerSidebar, undefined);
  assert.equal(nsis.uninstallerSidebar, undefined);
  assert.notEqual(nsis.deleteAppDataOnUninstall, true);
  assert.equal(nsis.script, undefined);
  assert.match(packageJson.scripts["installer:ui:build"], /tsc.*vite build/s);
  assert.match(packageJson.scripts["package:installer"], /npm run installer:host/);
  assert.match(packageJson.scripts["package:installer:signed"], /npm run installer:host:signed/);
});

test("native stages and terminal events remain authoritative and explicitly validated", async () => {
  const [sources, uiBridge, include, css] = await Promise.all([
    readHostSources(),
    readFile(path.join(uiSourceRoot, "src", "bridge", "webview.ts"), "utf8"),
    readFile(path.join(installerRoot, "installer.nsh"), "utf8"),
    readFile(path.join(uiSourceRoot, "src", "styles", "installer.css"), "utf8"),
  ]);
  const engine = classSource(sources, "InstallerEngine");
  const window = classSource(sources, "InstallerWindow");
  const bridge = classSource(sources, "WebViewBridge");
  const states = engine.match(/enum InstallerState\s*\{(?<states>[\s\S]*?)\}/)?.groups?.states;
  const uiStates = uiBridge.match(/installerStates = \[(?<states>[\s\S]*?)\] as const/)?.groups
    ?.states;
  assert.ok(states && uiStates);
  assert.deepEqual(
    states.split(",").map((state) => state.trim().toLowerCase()),
    [...uiStates.matchAll(/"([^"]+)"/g)].map((match) => match[1]),
  );
  assert.match(bridge, /SendState\(InstallerState state, string message\)/);
  assert.match(bridge, /Enum\.IsDefined\(typeof\(InstallerState\), state\)/);
  assert.match(uiBridge, /Object\.keys\(value\)\.every/);
  assert.match(engine, /InstallerState\.Preparing[\s\S]*await _parent\.WaitAsync/);
  assert.match(
    engine,
    /Process\.Start[\s\S]*InstallerState\.Installing[\s\S]*process\.WaitForExit/,
  );
  assert.match(engine, /process\.ExitCode != 0[\s\S]*throw[\s\S]*InstallerState\.Finalizing/);
  assert.match(engine, /VerifyInstallCompletion\(scope, selectedPath\)/);
  assert.match(engine, /GetValue\("InstallLocation"\)/);
  assert.match(
    include,
    /--mode install --engine "\$EXEPATH" --registry-key "\$\{INSTALL_REGISTRY_KEY\}"/,
  );
  assert.match(
    window,
    /await _engine\.RunAsync\(_scope, _selectedPath\);[\s\S]*SendState\(InstallerState\.Success/,
  );
  assert.match(window, /command == "launch"[^\n]*_state == InstallerState\.Success/);
  assert.match(window, /LogFailure\(error\)/);
  const uiSources = await Promise.all(
    (await collectFiles(path.join(uiSourceRoot, "src")))
      .filter((file) => !file.includes(".test."))
      .map((file) => readFile(file, "utf8")),
  );
  assert.doesNotMatch(
    uiSources.join("\n"),
    /setInterval|setTimeout|Downloading RepoDitor|progressPercent/i,
  );
  const reducedMotion = css.match(/@media \(prefers-reduced-motion: reduce\)(?<body>[\s\S]*)/)
    ?.groups?.body;
  assert.ok(reducedMotion);
  assert.doesNotMatch(reducedMotion, /width:\s*100%/);
});

test("approved composition and assets remain installer-owned source", async () => {
  const [artwork, icon, css, chrome, states] = await Promise.all([
    readFile(path.join(installerRoot, "assets", "ArtWork.png")),
    readFile(path.join(desktopRoot, "public", "icon.ico")),
    readFile(path.join(uiSourceRoot, "src", "styles", "installer.css"), "utf8"),
    readFile(path.join(uiSourceRoot, "src", "InstallerChrome.tsx"), "utf8"),
    readFile(path.join(uiSourceRoot, "src", "InstallerStates.tsx"), "utf8"),
  ]);

  assert.equal(artwork.toString("hex", 0, 8), "89504e470d0a1a0a");
  assert.equal(artwork.readUInt32BE(16), 1672);
  assert.equal(artwork.readUInt32BE(20), 941);
  assert.equal(sha256(artwork), "d72487503d259d659900df058114f6d30a6e1ed5bf7a9cfea5bc0597ac254a04");
  assert.ok(icon.length > 0);

  assert.match(css, /linear-gradient\([\s\S]*90deg[\s\S]*48%[\s\S]*64%/);
  assert.match(css, /\.panel\s*\{[\s\S]*?width:\s*42%/);
  assert.match(css, /ArtWork\.png["')]?\)\s*center\s*\/\s*cover\s+no-repeat/);
  assert.match(chrome, /RepoDitor icon/);
  assert.match(states, /Current user[\s\S]*All users/);
  assert.match(states, /INSTALL LOCATION[\s\S]*readOnly/);
  assert.match(states, /Change/);
  assert.match(states, /Install/);
});

test("the typed bridge is the only raw WebView2 access point", async () => {
  const sourceRoot = path.join(uiSourceRoot, "src");
  const files = (await collectFiles(sourceRoot)).filter(
    (file) => /\.(?:ts|tsx)$/.test(file) && !file.endsWith(".test.tsx"),
  );
  const sources = await Promise.all(
    files.map(async (file) => [file, await readFile(file, "utf8")]),
  );
  const rawAccess = sources
    .filter(([, source]) => /chrome\??\.webview/.test(source))
    .map(([file]) => path.relative(sourceRoot, file).replaceAll("\\", "/"));
  assert.deepEqual(rawAccess, ["bridge/webview.ts"]);

  const bridge = await readFile(path.join(sourceRoot, "bridge", "webview.ts"), "utf8");
  for (const command of [
    "ready",
    "choose-path",
    "scope:current",
    "scope:all",
    "start",
    "retry",
    "launch",
    "cancel",
    "close",
    "window:drag",
    "window:minimize",
    "window:maximize",
    "window:close",
  ]) {
    assert.ok(bridge.includes(`"${command}"`), `Missing WebView2 command: ${command}`);
  }
  assert.match(bridge, /type:\s*"initialize"/);
  assert.match(bridge, /type:\s*"path"/);
  assert.match(bridge, /type:\s*"state"/);
  assert.match(bridge, /postMessage\(command\)/);
  assert.match(bridge, /addEventListener\("message"/);
});

test("the Vite build contains only local production UI and approved assets", async () => {
  const outputFiles = await collectFiles(uiBuildRoot);
  const relativeFiles = outputFiles.map((file) =>
    path.relative(uiBuildRoot, file).replaceAll("\\", "/"),
  );
  assert.ok(relativeFiles.includes("index.html"));
  assert.ok(relativeFiles.some((file) => /^assets\/.+\.js$/.test(file)));
  assert.ok(relativeFiles.some((file) => /^assets\/.+\.css$/.test(file)));
  assert.equal(
    relativeFiles.some((file) => /\.(?:map|ts|tsx)$/.test(file)),
    false,
  );

  const [html, artwork, icon, ...output] = await Promise.all([
    readFile(path.join(uiBuildRoot, "index.html"), "utf8"),
    readFile(path.join(installerRoot, "assets", "ArtWork.png")),
    readFile(path.join(desktopRoot, "public", "icon.ico")),
    ...outputFiles.map((file) => readFile(file)),
  ]);
  const outputHashes = new Set(output.map(sha256));
  assert.ok(outputHashes.has(sha256(artwork)), "Approved artwork is absent from Vite output");
  assert.ok(outputHashes.has(sha256(icon)), "RepoDitor icon is absent from Vite output");

  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(
    html,
    /(?:src|href)=["']https?:|localhost:5173|@vite\/client|\/src\/main\.tsx/,
  );
  assert.match(html, /(?:src|href)=["']\.\/assets\//);
});

test("long paths stay semantic, single-line, and cannot displace Change", async () => {
  const [states, css, scrollbar] = await Promise.all([
    readFile(path.join(uiSourceRoot, "src", "InstallerStates.tsx"), "utf8"),
    readFile(path.join(uiSourceRoot, "src", "styles", "installer.css"), "utf8"),
    readFile(path.join(uiSourceRoot, "src", "styles", "scrollbar.css"), "utf8"),
  ]);

  assert.match(states, /<input[\s\S]*?id="pathField"[\s\S]*?value=\{path\}[\s\S]*?readOnly/);
  assert.match(states, /title=\{path\}/);
  assert.match(css, /\.location-row\s*\{[\s\S]*?height:\s*44px[\s\S]*?minmax\(0,\s*1fr\)\s+auto/);
  assert.match(css, /\.path\s*\{[\s\S]*?white-space:\s*nowrap[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /\.change\s*\{[\s\S]*?height:\s*44px[\s\S]*?flex:\s*0 0 auto/);
  assert.match(css, /#root\s*\{[\s\S]*?width:\s*100%[\s\S]*?min-width:\s*0/);
  assert.match(css, /\.stage\s*\{[\s\S]*?width:\s*min\(1160px,\s*100%\)/);
  assert.match(scrollbar, /::-webkit-scrollbar[\s\S]*?6px/);
  assert.match(scrollbar, /\.path:hover[\s\S]*?\.path:focus/);

  const allSource = `${states}\n${css}\n${scrollbar}`;
  assert.doesNotMatch(allSource, /setInterval|setTimeout|fake.?progress|progressPercent/i);
});

test("host building refreshes and stages Vite output before NSIS", async () => {
  const [sources, build, include] = await Promise.all([
    readHostSources(),
    readFile(path.join(installerRoot, "build-host.ps1"), "utf8"),
    readFile(path.join(installerRoot, "installer.nsh"), "utf8"),
  ]);

  assert.match(build, /npm\.cmd run installer:ui:build/);
  assert.match(build, /Remove-Item -LiteralPath \$resolvedBuildRoot -Recurse -Force/);
  assert.match(build, /Get-ChildItem -LiteralPath \$uiBuildRoot[\s\S]*Copy-Item/);
  assert.doesNotMatch(build, /installer[\\/]ui[\\/]index\.html|assets[\\/]ArtWork\.png/);
  assert.match(build, /\$sdkVersion = "1\.0\.4191\.47"/);
  assert.match(
    build,
    /\$sdkSha256 = "F492BBF547D0DA329553B6727435B677579B1E9F91CC9E4A1AD029366D5F23D0"/,
  );
  assert.match(build, /Microsoft\.Web\.WebView2\.Core\.dll/);
  assert.match(build, /Microsoft\.Web\.WebView2\.WinForms\.dll/);
  assert.match(build, /WebView2Loader\.dll/);
  assert.match(build, /Invoke-TrustedSigning/);
  assert.match(build, /-Files \$hostPath/);
  assert.match(build, /Get-ChildItem[^\n]*-Filter "\*\.cs"[^\n]*-Recurse/);
  assert.match(build, /Sort-Object FullName/);
  assert.match(build, /\$sources\.Count -eq 0/);
  assert.match(build, /\$sources\s*\r?\nif \(\$LASTEXITCODE -ne 0\)/);
  assert.doesNotMatch(build, /host[\\/]Program\.cs/);

  assert.match(include, /!macro RepoDitorStageWebViewHost/);
  assert.match(include, /File \/r "\$\{REPODITOR_HOST_DIR\}\\\*"/);
  assert.doesNotMatch(include, /PROJECT_DIR\}\\installer\\ui|PROJECT_DIR\}\\installer\\assets/);
  assert.doesNotMatch(
    include,
    /\b(?:Uninst)?Page custom\b|nsDialogs|MUI_PAGE_WELCOME|MUI_PAGE_DIRECTORY/,
  );

  const host = classSource(sources, "WebViewBridge");
  const rawAccess = sources.filter(([, source]) => /CoreWebView2|\bnew WebView2\(/.test(source));
  assert.equal(rawAccess.length, 1, "Raw native WebView2 access must have one owner");
  assert.equal(rawAccess[0][1], host);
  assert.match(host, /private const string AppOrigin = "https:\/\/repoditor-installer\.local"/);
  assert.match(host, /SetVirtualHostNameToFolderMapping[\s\S]*DenyCors/);
  assert.match(host, /eventArgs\.Source\.Equals\(AppOrigin \+ "\/index\.html"/);
  assert.match(host, /AreDevToolsEnabled = false/);
  assert.match(host, /AreHostObjectsAllowed = false/);
  assert.match(host, /PermissionRequested[\s\S]*CoreWebView2PermissionState\.Deny/);
  assert.match(host, /DownloadStarting[\s\S]*args\.Cancel = true/);
  assert.doesNotMatch(
    sources.map(([, source]) => source).join("\n"),
    /AddHostObjectToScript|ExecuteScriptAsync/,
  );
});

test("native install, update, elevation, and uninstall contracts remain unchanged", async () => {
  const [sources, include] = await Promise.all([
    readHostSources(),
    readFile(path.join(installerRoot, "installer.nsh"), "utf8"),
  ]);
  const host = sources.map(([, source]) => source).join("\n");
  const engine = classSource(sources, "InstallerEngine");
  const parentWait = classSource(sources, "ParentProcessSynchronizer");

  assert.match(host, /command == "choose-path"/);
  assert.match(host, /command == "scope:current"/);
  assert.match(host, /command == "scope:all"/);
  assert.match(host, /command == "start" \|\| command == "retry"/);
  assert.match(
    host,
    /var arguments = "\/" \+ \(scope == "all" \? "allusers" : "currentuser"\) \+ " \/S"/,
  );
  assert.match(host, /if \(_options\.Updated\)[\s\S]*arguments \+= " --updated"/);
  assert.match(host, /arguments \+= " \/D=" \+ selectedPath/);
  assert.match(host, /startInfo\.Verb = "runas"/);
  assert.match(engine, /await _parent\.WaitAsync\(\)/);
  assert.match(
    engine,
    /if \(scope == "all"\)\s*\{\s*startInfo\.UseShellExecute = true;\s*startInfo\.Verb = "runas";\s*\}\s*else\s*\{\s*startInfo\.UseShellExecute = false;\s*startInfo\.CreateNoWindow = true;/,
  );
  assert.doesNotMatch(host, /DirectEngine|direct-engine| _\?=/);
  assert.doesNotMatch(host, /attempt <|for \(var attempt/);
  assert.match(host, /await WaitForUninstallCompletionAsync\(scope, selectedPath\)/);
  assert.match(host, /Registry\.LocalMachine : Registry\.CurrentUser/);
  assert.match(host, /registry\.OpenSubKey\(_options\.RegistryKey\)/);
  assert.match(host, /!File\.Exists\(_options\.Engine\)/);
  assert.match(host, /!File\.Exists\(Path\.Combine\(selectedPath, "RepoDitor\.exe"\)\)/);
  assert.match(host, /The uninstaller did not complete\./);
  assert.doesNotMatch(host, /\.HasExited/);
  assert.match(parentWait, /await Task\.Run\(delegate \{ _parentProcess\.WaitForExit\(\); }\)/);
  assert.match(parentWait, /NativeErrorCode != 5/);
  assert.match(parentWait, /Process\.GetProcessById\(_parentProcessId\)/);
  assert.doesNotMatch(parentWait, /return Task\.Delay/);

  assert.match(include, /!macro customInit[\s\S]*\$\{If\} \$\{Silent\}/);
  assert.match(include, /--mode install --engine "\$EXEPATH"/);
  assert.match(include, /Exec '"\$RepoDitor\.StageDirectory\\RepoDitorInstallerHost\.exe"/);
  assert.match(include, /!macro customUnInit[\s\S]*\$\{StdUtils\.ExecShellAsUser\}/);
  assert.match(
    include,
    /\$\{If\} \$\{UAC_IsAdmin\}[\s\S]*ExecShellAsUser[\s\S]*\$\{Else\}[\s\S]*Exec '/,
  );
  assert.match(include, /--mode uninstall --engine "\$INSTDIR\\\$\{UNINSTALL_FILENAME\}"/);
  assert.doesNotMatch(include, /RepoDitor\.DirectEngine|--direct-engine/);
  assert.match(include, /--registry-key "\$\{UNINSTALL_REGISTRY_KEY\}"/);
  assert.match(
    include,
    /\$\{GetProcessInfo\} 0 \$0 \$1 \$2 \$3 \$4[\s\S]*StrCpy \$RepoDitor\.ParentProcessId "\$1"/,
  );
  assert.doesNotMatch(
    include.match(/!macro customUnInit[\s\S]*?!macroend/)?.[0] ?? "",
    /--mode uninstall --engine "\$EXEPATH"/,
  );
  assert.match(include, /PathIsNetworkPathW/);
  assert.match(include, /PathIsRootW/);
  assert.match(include, /PathIsPrefixW\(w "\$PROFILE\\AppData\\LocalLow\\semiwork\\Repo"/);
  assert.match(include, /RepoDitor\.AllowExistingPath[\s\S]*Return/);
  assert.match(
    include,
    /GetFileAttributesW[\s\S]*0x400[\s\S]*RepoDitor\.AllowExistingPath[\s\S]*SetOutPath "\$TEMP"[\s\S]*RMDir "\$1"[\s\S]*\$\{If\} \$\{Errors\}[\s\S]*Return/,
  );
  assert.match(
    include,
    /perMachineInstallationFolder[\s\S]*lstrcmpiW\(w "\$INSTDIR", w "\$perMachineInstallationFolder"\)[\s\S]*perUserInstallationFolder[\s\S]*lstrcmpiW\(w "\$INSTDIR", w "\$perUserInstallationFolder"\)/,
  );
});

test("uninstall cleanup is exact, upgrade-guarded, and reparse-aware", async () => {
  const include = await readFile(path.join(installerRoot, "installer.nsh"), "utf8");
  const cleanup = include.match(/!macro customUnInstall(?<body>[\s\S]*?)!macroend/)?.groups?.body;
  assert.ok(cleanup);
  assert.deepEqual(
    [...cleanup.matchAll(/Push "([^"]+)"/g)].map((match) => match[1]),
    ["$APPDATA\\repoditor-desktop", "$LOCALAPPDATA\\RepoDitor"],
  );
  assert.match(
    cleanup,
    /\$\{IfNot\} \$\{isUpdated\}[\s\S]*\$APPDATA[\s\S]*\$LOCALAPPDATA[\s\S]*\$\{EndIf\}/,
  );
  assert.match(include, /System::Call 'kernel32::GetFileAttributes/);
  assert.doesNotMatch(cleanup, /RMDir\s+\/r|\b(?:Exec|ExecWait|nsExec::Exec)\b|LocalLow|semiwork/);
  assert.doesNotMatch(cleanup, /Push "\$(?:APPDATA|LOCALAPPDATA|PROFILE|USERPROFILE)"/);
});

test("electron-builder keeps payload, upgrade, rollback, and registration ownership", async () => {
  const [assisted, installSection, installer, installUtil] = await Promise.all([
    readFile(builderTemplate("assistedInstaller.nsh"), "utf8"),
    readFile(builderTemplate("installSection.nsh"), "utf8"),
    readFile(builderTemplate("include", "installer.nsh"), "utf8"),
    readFile(builderTemplate("include", "installUtil.nsh"), "utf8"),
  ]);

  assert.match(assisted, /!insertmacro MUI_PAGE_INSTFILES/);
  assert.match(installSection, /uninstallOldVersion[\s\S]*handleUninstallResult/);
  assert.match(installSection, /registryAddInstallInfo/);
  assert.match(installer, /extractEmbeddedAppPackage/);
  assert.match(installer, /WriteRegStr SHELL_CONTEXT[\s\S]*UninstallString/);
  assert.match(installer, /WriteRegStr SHELL_CONTEXT[\s\S]*QuietUninstallString/);
  assert.match(installUtil, /always pass --updated flag[\s\S]*StrCpy \$0 "\$0 --updated"/);
  assert.match(installUtil, /Function handleUninstallResult[\s\S]*SetErrorLevel 2[\s\S]*Quit/);
});
