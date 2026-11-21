import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

import {
  createMetaSaveFixture,
  createRunSaveFixture,
  DESKTOP_ROOT,
  E2E_SAVE_ID,
  EXPECTED_DESKTOP_VERSION,
} from "../support/fixtureEnvironment";
import {
  close,
  launch,
  native,
  openRunWorkspace,
  verifyPackagedProductionAuthority,
  verifyPackagedProductionLaunch,
} from "../support/tauriHarness";
import { windowsProbeShell } from "../support/tauriStartup";

const hosted =
  process.platform === "win32" &&
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.RUNNER_ENVIRONMENT === "github-hosted";
const legacyHash = "d013a02d7136943c1f19ddcd946b0d9511865afae62028ac43cb73377b2253ea";
const product = "RepoDitor Desktop";
const publisher = "Hans Valerie";

async function sha256(file: string) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

function registered(name: "RepoDitor" | typeof product) {
  const output = execFileSync(
    windowsProbeShell(),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `if (Test-Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall') { Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object DisplayName -eq '${name}' | Select-Object DisplayVersion,Publisher,UninstallString | ConvertTo-Json -Compress }`,
    ],
    { encoding: "utf8", timeout: 15_000 },
  ).trim();
  if (!output) return null;
  const entry: { DisplayVersion: string; Publisher: string; UninstallString: string } =
    JSON.parse(output);
  expect(Array.isArray(entry)).toBe(false);
  return entry;
}

function runInstaller(exe: string, args = "/S") {
  execFileSync(
    windowsProbeShell(),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference = 'Stop'; $p = Start-Process -FilePath $env:REPODITOR_TEST_SETUP -ArgumentList $env:REPODITOR_TEST_SETUP_ARGS -Wait -PassThru; exit $p.ExitCode",
    ],
    {
      env: { ...process.env, REPODITOR_TEST_SETUP: exe, REPODITOR_TEST_SETUP_ARGS: args },
      timeout: 120_000,
    },
  );
}

async function uninstall(name: "RepoDitor" | typeof product, localAppData: string) {
  const entry = registered(name);
  expect(entry).not.toBeNull();
  const pattern = name === "RepoDitor" ? /^"([^"]+\.exe)" \/currentuser$/i : /^"([^"]+\.exe)"$/i;
  const exe = pattern.exec(entry!.UninstallString)?.[1] ?? "";
  const local = path.relative(localAppData, path.resolve(exe));
  expect(local.toLowerCase()).toBe(
    (name === "RepoDitor"
      ? "Programs\\RepoDitor\\Uninstall RepoDitor.exe"
      : `${product}\\uninstall.exe`
    ).toLowerCase(),
  );
  runInstaller(exe, name === "RepoDitor" ? "/currentuser /S" : "/S");
  await expect.poll(() => registered(name), { timeout: 30_000 }).toBeNull();
  await expect.poll(() => existsSync(exe), { timeout: 30_000 }).toBe(false);
}

test("packaged production commands are scoped and reject an unapproved fixture", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const profile = info.outputPath("profile");
  await mkdir(profile, { recursive: true });
  const run = await createRunSaveFixture(profile);
  const meta = createMetaSaveFixture(profile);
  const before = await Promise.all([run, meta].map(sha256));
  const productionExecutable = path.resolve(
    DESKTOP_ROOT,
    process.env.REPODITOR_E2E_EXECUTABLE ?? "build/tauri-release/RepoDitor.exe",
  );
  const prodProfile = info.outputPath("profile-production");
  await mkdir(prodProfile, { recursive: true });
  const prodEnv = {
    REPODITOR_E2E_LOCAL_APP_DATA_LOW: path.join(profile, "AppData", "LocalLow"),
  };
  await verifyPackagedProductionAuthority(productionExecutable, prodProfile, {
    expectedAuthority: "public-editing",
    runSavePath: run,
    metaSavePath: meta,
    extraEnvironment: prodEnv,
  });
  await verifyPackagedProductionLaunch(productionExecutable, prodProfile, prodEnv);
  expect(await Promise.all([run, meta].map(sha256))).toEqual(before);

  const uiExecutable = path.resolve(
    DESKTOP_ROOT,
    process.env.REPODITOR_E2E_UI_EXECUTABLE ??
      process.env.REPODITOR_E2E_EXECUTABLE ??
      "build/tauri-release/RepoDitor.exe",
  );
  const app = await launch(uiExecutable, profile);
  try {
    const notice = app.page.getByRole("dialog", { name: "RepoDitor v0.2.1 is still installed" });
    if (await native(app.page, "legacy_install_registered")) {
      await expect(notice).toBeVisible();
      await app.page.keyboard.press("Escape");
    }
    await openRunWorkspace(app.page);
    expect(
      await native(app.page, "production_health_state", { saveId: E2E_SAVE_ID }),
    ).toMatchObject({
      enabled: false,
      state: "disabled",
    });
    expect(await native(app.page, "production_meta_state", { request: {} })).toMatchObject({
      state: "disabled",
      session: null,
      admission: null,
    });
    expect(await Promise.all([run, meta].map(sha256))).toEqual(before);
  } finally {
    await close(app.child, app.browser);
  }
});

test("production installer and published v0.2.1 coexist, reinstall and roll back", async ({
  browserName,
}, info) => {
  if (!hosted) throw new Error("Installer lifecycle requires a disposable GitHub-hosted runner");
  expect(browserName).toBe("chromium");
  test.setTimeout(360_000);
  const profile = process.env.USERPROFILE!;
  const localAppData = process.env.LOCALAPPDATA!;
  const localLow = path.join(profile, "AppData", "LocalLow");
  const game = path.join(localLow, "semiwork", "Repo");
  const setup = process.env.REPODITOR_CI_SETUP!;
  const legacy = process.env.REPODITOR_LEGACY_SETUP!;
  const portable = path.join(DESKTOP_ROOT, "build", "tauri-release");
  const payload = ["RepoDitor.exe", "backend/repoditor-backend.exe"] as const;
  const verified = JSON.parse(await readFile(path.join(portable, "artifact-check.json"), "utf8"));
  expect(verified.authority).toBe("public-editing");
  const payloadHashes = await Promise.all(payload.map((file) => sha256(path.join(portable, file))));
  expect(path.isAbsolute(profile) && path.isAbsolute(localAppData)).toBe(true);
  expect(existsSync(game)).toBe(false);
  expect(registered("RepoDitor")).toBeNull();
  expect(registered(product)).toBeNull();
  expect(await sha256(legacy)).toBe(legacyHash);

  const run = await createRunSaveFixture(profile);
  const meta = createMetaSaveFixture(profile);
  const backup = `${run}.bak`;
  await copyFile(run, backup, constants.COPYFILE_EXCL);
  const files = [run, meta, backup];
  const original = await Promise.all(files.map(sha256));
  const verifyGameData = async () => expect(await Promise.all(files.map(sha256))).toEqual(original);

  const root = path.join(localAppData, product);
  const exe = path.join(root, payload[0]);
  const programs = path.join(process.env.APPDATA!, "Microsoft/Windows/Start Menu/Programs");
  const shortcut = path.join(programs, `${product}.lnk`);
  const legacyExe = path.join(localAppData, "Programs", "RepoDitor", "RepoDitor.exe");
  const verifyLegacy = () => {
    expect(registered("RepoDitor")?.DisplayVersion).toBe("0.2.1");
    expect(existsSync(legacyExe)).toBe(true);
  };
  const verifyTauri = async () => {
    expect(registered(product)).toMatchObject({
      DisplayVersion: EXPECTED_DESKTOP_VERSION,
      Publisher: publisher,
      UninstallString: `"${path.join(root, "uninstall.exe")}"`,
    });
    const shortcutTarget = execFileSync(
      windowsProbeShell(),
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(New-Object -ComObject WScript.Shell).CreateShortcut($env:REPODITOR_TEST_LINK).TargetPath",
      ],
      { env: { ...process.env, REPODITOR_TEST_LINK: shortcut }, encoding: "utf8", timeout: 15_000 },
    ).trim();
    expect(shortcutTarget.toLowerCase()).toBe(exe.toLowerCase());
    for (const file of [
      exe,
      path.join(root, "backend", "repoditor-backend.exe"),
      path.join(root, "backend", "_internal", "python313.dll"),
      path.join(root, "licenses", "RepoDitor-MIT.txt"),
      path.join(root, "licenses", "Teko-OFL.txt"),
      path.join(root, "licenses", "THIRD_PARTY_NOTICES.md"),
    ]) {
      expect((await stat(file)).size).toBeGreaterThan(0);
    }
    expect(await Promise.all(payload.map((file) => sha256(path.join(root, file))))).toEqual(
      payloadHashes,
    );
    await verifyGameData();
  };
  const uiHostExecutable = process.env.REPODITOR_E2E_UI_EXECUTABLE
    ? path.resolve(DESKTOP_ROOT, process.env.REPODITOR_E2E_UI_EXECUTABLE)
    : null;
  const launchApplication = async (phase: string, legacyExpected: boolean, executable = exe) => {
    const prodProfile = info.outputPath(`${phase}-production`);
    await mkdir(prodProfile, { recursive: true });
    const prodEnv = {
      REPODITOR_E2E_LOCAL_APP_DATA_LOW: localLow,
      WEBVIEW2_USER_DATA_FOLDER: path.join(prodProfile, "webview2"),
    };
    await verifyPackagedProductionAuthority(executable, prodProfile, {
      expectedAuthority: "public-editing",
      runSavePath: run,
      metaSavePath: meta,
      extraEnvironment: prodEnv,
    });
    await verifyPackagedProductionLaunch(executable, prodProfile, prodEnv);
    await verifyGameData();

    const appProfile = info.outputPath(phase);
    await mkdir(appProfile, { recursive: true });
    const app = await launch(uiHostExecutable ?? executable, appProfile, {
      REPODITOR_E2E_LOCAL_APP_DATA_LOW: localLow,
      WEBVIEW2_USER_DATA_FOLDER: path.join(appProfile, "webview2"),
    });
    try {
      expect(await native(app.page, "legacy_install_registered")).toBe(legacyExpected);
      const notice = app.page.getByRole("dialog", { name: "RepoDitor v0.2.1 is still installed" });
      if (legacyExpected) {
        await expect(notice.getByRole("button", { name: "Remind Me Later" })).toBeFocused();
        await expect(notice).toHaveAccessibleDescription(/please uninstall v0\.2\.1/i);
        await app.page.keyboard.press("Escape");
      }
      await expect(notice).toHaveCount(0);
      await openRunWorkspace(app.page);
      await expect(app.page.getByRole("heading", { name: "Run snapshot" })).toBeVisible();
      // Registered production commands must still reject the synthetic game/profile.
      expect(
        await native(app.page, "production_health_state", { saveId: E2E_SAVE_ID }),
      ).toMatchObject({ enabled: false, state: "disabled" });
      expect(await native(app.page, "production_meta_state", { request: {} })).toMatchObject({
        state: "disabled",
        session: null,
        admission: null,
      });
      await expect(
        app.page.getByText(`RepoDitor v${EXPECTED_DESKTOP_VERSION}`, { exact: true }),
      ).toBeVisible();
      await app.page.screenshot({ path: info.outputPath(`${phase}.png`) });
    } finally {
      await close(app.child, app.browser);
    }
    await verifyGameData();
  };
  const removeTauri = async () => {
    await uninstall(product, localAppData);
    expect(existsSync(exe)).toBe(false);
    expect(existsSync(path.join(root, "backend", "repoditor-backend.exe"))).toBe(false);
    expect(existsSync(shortcut)).toBe(false);
    await verifyGameData();
  };

  const occupied = info.outputPath("occupied destination");
  await mkdir(occupied, { recursive: true });
  const occupant = path.join(occupied, "unrelated.es3");
  await copyFile(run, occupant, constants.COPYFILE_EXCL);
  expect(() => runInstaller(setup, `/S /D=${occupied}`)).toThrow();
  expect(await sha256(occupant)).toBe(original[0]);
  expect(registered(product)).toBeNull();
  expect(existsSync(path.join(occupied, payload[0]))).toBe(false);

  runInstaller(setup);
  await verifyTauri();
  await launchApplication("clean", false);
  await launchApplication("portable-clean", false, path.join(portable, payload[0]));
  runInstaller(setup);
  await verifyTauri();
  await removeTauri();

  runInstaller(legacy, "/currentuser /S");
  verifyLegacy();
  await verifyGameData();
  runInstaller(setup);
  await verifyTauri();
  verifyLegacy();
  await launchApplication("side-by-side", true);
  await launchApplication("portable-with-electron", true, path.join(portable, payload[0]));
  await removeTauri();
  verifyLegacy();

  runInstaller(setup);
  await uninstall("RepoDitor", localAppData);
  expect(existsSync(legacyExe)).toBe(false);
  await verifyTauri();
  await launchApplication("after-electron-removal", false);
  await removeTauri();

  runInstaller(legacy, "/currentuser /S");
  verifyLegacy();
  expect(registered(product)).toBeNull();
  await verifyGameData();
  await uninstall("RepoDitor", localAppData);
  await verifyGameData();
});
