import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getMakeNsisPath, getNsisPluginsPath } from "app-builder-lib/out/toolsets/windows.js";
import { getPath7za } from "app-builder-lib/out/toolsets/7zip.js";
import {
  validateExtractionSizes,
  validateExtractionTemplate,
} from "./check-extraction-override.mjs";

const desktop = fileURLToPath(new URL("../", import.meta.url));

test("extraction override rejects upstream drift and native counter overflow", async () => {
  const source = await readFile(
    path.join(desktop, "node_modules/app-builder-lib/templates/nsis/include/extractAppPackage.nsh"),
    "utf8",
  );
  validateExtractionTemplate("26.15.3", source);
  assert.throws(() => validateExtractionTemplate("26.15.4", source));
  assert.throws(() =>
    validateExtractionTemplate("26.15.3", source.replace("Sleep 1000", "Sleep 2000")),
  );
  assert.equal(validateExtractionSizes("Size = 17\nSize = 13\n"), 30n);
  assert.equal(validateExtractionSizes("Size = 4294967295\n"), 4294967295n);
  for (const listing of ["", "Size = 0\n", "Size = 4294967296\n", "Size = 4294967295\nSize = 1\n"])
    assert.throws(() => validateExtractionSizes(listing));
});

test("the owned extraction override preserves lifecycle and one-way security boundaries", async () => {
  const read = (file) => readFile(path.join(desktop, file), "utf8");
  const [macro, callback, section, extractor, channel, engine, bridge, ui, css] = await Promise.all(
    [
      read("installer/nsis/extractUsing7za.nsh"),
      read("installer/nsis/extractionProgress.nsh"),
      read("installer/nsis/installSection.nsh"),
      read("installer/nsis/extractAppPackage.nsh"),
      read("installer/host/ExtractionProgressChannel.cs"),
      read("installer/host/InstallerEngine.cs"),
      read("installer/ui/src/bridge/webview.ts"),
      read("installer/ui/src/InstallerApp.tsx"),
      read("installer/ui/src/styles/installer.css"),
    ],
  );
  assert.equal([...macro.matchAll(/Nsis7z::ExtractWithCallback/g)].length, 2);
  assert.doesNotMatch(macro, /Nsis7z::Extract\s|registryAddInstallInfo|uninstallOldVersion/);
  assert.match(macro, /CopyFiles \/SILENT/);
  assert.match(macro, /Sleep 1000/); // Existing upstream copy retry, never percentage synthesis.
  assert.match(section, /node_modules\\app-builder-lib\\templates\\nsis\\installSection.nsh/);
  assert.match(section, /!cd/);
  assert.match(extractor, /!macroundef extractUsing7za/);
  assert.match(callback, /Pop \$RepoDitor.CompletedBytes\s+Pop \$RepoDitor.TotalBytes/);
  assert.match(callback, /GetNamedPipeServerProcessId/);
  assert.match(callback, /0x00100082/);
  assert.match(callback, /i 0x00100000/); // Anonymous SQOS: elevated client cannot be impersonated.
  assert.match(channel, /D:P\(A;;0x00100082;;;/);
  assert.match(channel, /clientPid != expectedPid/);
  assert.match(channel, /0x40080001, 0x8, 1/); // First instance, inbound, local only.
  assert.match(channel, /record.Length >= MaximumRecordBytes/);
  assert.match(channel, /ExtractionComplete/);
  assert.doesNotMatch(
    channel,
    /PipeDirection.Out|HttpListener|;;;WD\)|;;;AN\)|StreamWriter|Task.Delay/,
  );
  assert.match(engine, /Guid.NewGuid\(\).ToString\("N"\)/);
  assert.match(engine, /progress.BindEngine\(process.Id\)/);
  assert.match(engine, /await progress.FinishAsync\(\)/);
  assert.match(bridge, /Number.isFinite\(value.percentage\)/);
  assert.match(
    bridge,
    /Object.keys\(value\).every\(\(key\) => \["type", "session", "attempt", "percentage"\].includes\(key\)\)/,
  );
  assert.doesNotMatch(
    ui,
    /completedBytes|totalBytes|setInterval|setTimeout|Date.now|performance.now/,
  );
  assert.match(css, /\.progress-bar.determinate\s*\{[^}]*animation:\s*none/);
});

test(
  "real silent Nsis7z callback, copy fallback and authenticated native transport",
  { skip: process.platform !== "win32" },
  async () => {
    const build = path.join(desktop, "build");
    await mkdir(build, { recursive: true });
    const root = await mkdtemp(path.join(build, "extraction-checks-"));
    assert.ok(path.resolve(root).startsWith(path.resolve(build) + path.sep));
    try {
      const input = path.join(root, "input");
      await mkdir(input);
      for (let index = 0; index < 8; index++) {
        const bytes = Buffer.alloc(4 * 1024 * 1024);
        for (let offset = 0; offset < bytes.length; offset++)
          bytes[offset] = (offset * 31 + index) & 255;
        await writeFile(path.join(input, `synthetic-${index}.bin`), bytes);
      }
      const archive = path.join(root, "payload.7z");
      execFileSync(await getPath7za(), ["a", "-t7z", "-ms=off", archive, path.join(input, "*")]);
      const executable = path.join(root, "ExtractionProbe.exe");
      const script = `Unicode true
!define PROJECT_DIR "${desktop}"
!define PRODUCT_NAME "Synthetic extraction fixture"
!addincludedir "${path.join(desktop, "node_modules/app-builder-lib/templates/nsis/include")}"
!include LogicLib.nsh
!include FileFunc.nsh
!include "${path.join(desktop, "installer/nsis/extractionProgress.nsh")}"
!cd "${path.join(desktop, "installer/nsis")}"
!include "${path.join(desktop, "node_modules/app-builder-lib/templates/nsis/include/installer.nsh")}"
Name "Synthetic extraction fixture"
OutFile "${executable}"
RequestExecutionLevel user
SilentInstall silent
LangString appCannotBeClosed 1033 "Synthetic copy refusal"
Section
  InitPluginsDir
  File /oname=$PLUGINSDIR\\payload.7z "${archive}"
  SetOutPath $INSTDIR
  StrCpy $R2 "preserved"
  !insertmacro extractUsing7za "$PLUGINSDIR\\payload.7z"
  FileOpen $0 "$INSTDIR\\registers.txt" w
  FileWrite $0 $R2
  FileClose $0
SectionEnd
`;
      const scriptPath = path.join(root, "probe.nsi");
      await writeFile(scriptPath, script);
      const [compiler, plugins] = await Promise.all([getMakeNsisPath(), getNsisPluginsPath()]);
      execFileSync(compiler.path, [
        "/V2",
        `/X!addplugindir /x86-unicode "${path.join(plugins, "x86-unicode")}"`,
        scriptPath,
      ]);
      const checker = path.join(root, "ExtractionChecks.exe");
      const sources = [
        "host/ExtractionProgress.cs",
        "host/ExtractionProgressChannel.cs",
        "host/Arguments.cs",
        "host/InstallerEngine.cs",
        "host/ParentProcessSynchronizer.cs",
        "tests/ExtractionChecks.cs",
      ].map((file) => path.join(desktop, "installer", file));
      execFileSync(path.join(process.env.WINDIR, "Microsoft.NET/Framework64/v4.0.30319/csc.exe"), [
        "/nologo",
        "/target:exe",
        "/platform:x64",
        `/out:${checker}`,
        ...sources,
      ]);
      console.log(execFileSync(checker, [executable, root], { encoding: "utf8", timeout: 60000 }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
