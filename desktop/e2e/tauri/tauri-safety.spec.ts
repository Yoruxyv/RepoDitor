import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { expect, test, type TestInfo } from "@playwright/test";
import {
  createMetaSaveFixture,
  createRunSaveFixture,
  DESKTOP_ROOT,
  E2E_SAVE_ID,
  getPythonExecutable,
  isolatedApplicationEnvironment,
  PYTHON_ROOT,
} from "../support/fixtureEnvironment";
import { createGameFixture } from "../support/harness";
import {
  close,
  launch,
  native,
  stageFrozenBackend,
  stageSyntheticBackend,
} from "../support/tauriHarness";

interface Transaction {
  status: string;
  reason: string | null;
  backupAvailable: boolean;
}
interface Opened {
  ok: true;
  data: { session: { fingerprint: string } };
}
const OP = "a".repeat(32);
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must name a prepared safety artifact`);
  return path.resolve(DESKTOP_ROOT, value);
}
async function fixture(info: TestInfo, host = "REPODITOR_RECOVERY_EXECUTABLE", production = false) {
  const home = info.outputPath("isolated");
  await mkdir(home, { recursive: true });
  const source = await createRunSaveFixture(home);
  await createGameFixture(home);
  const executable = path.join(home, "repoditor-preview.exe");
  await copyFile(required(host), executable);
  await stageFrozenBackend(
    home,
    required(production ? "REPODITOR_ARTIFACT_BACKEND" : "REPODITOR_RECOVERY_BACKEND"),
  );
  return { home, source, executable, before: await readFile(source) };
}
function request(fingerprint: string, operationId = OP, health = 17) {
  return { request: { saveId: E2E_SAVE_ID, fingerprint, playerId: "111", health, operationId } };
}
function recovery() {
  return { request: { saveId: E2E_SAVE_ID, operationId: OP } };
}
async function pending(source: string) {
  return JSON.parse(
    await readFile(
      path.join(path.dirname(source), `.${path.basename(source)}.health-pending.json`),
      "utf8",
    ),
  ) as { phase: string; version: number };
}
async function exactBackup(source: string, before: Buffer) {
  const name = (await readdir(path.dirname(source))).find((entry) =>
    entry.includes(".bak-health-"),
  );
  expect(name).toBeTruthy();
  expect(await readFile(path.join(path.dirname(source), name!))).toEqual(before);
}

test("ordinary packaged workspace preserves keyboard focus across navigation", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, "REPODITOR_RECOVERY_DEFAULT_EXECUTABLE", true);
  const app = await launch(f.executable, f.home);
  try {
    const { page } = app;
    await page.setViewportSize({ width: 960, height: 640 });
    const open = page.getByRole("button", { name: /Open workspace/ });
    await open.focus();
    await page.keyboard.press("Enter");
    const overview = page.getByRole("tab", { name: "Overview", selected: true });
    await expect(overview).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tabpanel", { name: "Overview" })).toBeFocused();

    for (const section of ["Players", "Upgrades", "Run", "Items"]) {
      await page.getByRole("button", { name: `Open ${section}`, exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("tab", { name: section, selected: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("tabpanel", { name: section })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Home");
      await expect(overview).toBeFocused();
    }
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Maps", selected: true })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(overview).toBeFocused();

    const change = page.getByRole("button", { name: "Change save" });
    await change.focus();
    await page.keyboard.press("Enter");
    await expect(open).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(overview).toBeFocused();
    await rename(f.source, `${f.source}.hidden`);
    try {
      await change.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "No valid saves yet" })).toBeVisible();
      await expect(page.locator("#discovery-title")).toBeFocused();
    } finally {
      await rename(`${f.source}.hidden`, f.source);
    }
    expect(await readFile(f.source)).toEqual(f.before);
  } finally {
    await close(app.child, app.browser);
  }
});

test("ordinary packaged read-only states explain pending safety and recover Maps in place", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("isolated");
  const f = await stageSyntheticBackend(home, required("REPODITOR_RECOVERY_DEFAULT_EXECUTABLE"));
  const run = await createRunSaveFixture(home);
  const meta = createMetaSaveFixture(home);
  const runBefore = await readFile(run);
  const metaBefore = await readFile(meta);
  const mapsResponse = path.join(home, "maps-list.json");
  await writeFile(
    mapsResponse,
    JSON.stringify({ ok: true, available: false, catalogPath: null, maps: [] }),
  );
  await writeFile(
    path.join(home, "cosmetics-get.json"),
    JSON.stringify({
      ok: false,
      error: { code: "meta_missing", message: "C:/private/MetaSave.es3" },
    }),
  );
  const app = await launch(f.executable, home, f.environment);
  try {
    const { page } = app;
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      const firstStatus = new Promise<void>((resolve) => {
        window.addEventListener("repoditor-test-release-status", () => resolve(), { once: true });
      });
      const saveOpen = new Promise<void>((resolve) => {
        window.addEventListener("repoditor-test-release-save-open", () => resolve(), {
          once: true,
        });
      });
      // Hold responses at the renderer IPC boundary while retaining the packaged bridge.
      window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        if (url.hostname === "ipc.localhost" && url.pathname === "/game_status") {
          await firstStatus;
        }
        if (url.hostname === "ipc.localhost" && url.pathname === "/saves_open") await saveOpen;
        return originalFetch(input, init);
      };
    });
    await page.reload();
    await page.getByRole("button", { name: /Open workspace/ }).click();
    const content = page.getByTestId("editor-content");
    const check = page
      .getByRole("status")
      .filter({ hasText: "Checking whether R.E.P.O. is closed…" });
    await expect(check).toBeVisible();
    await expect(content).toHaveAttribute("inert", "");
    await expect(content).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event("repoditor-test-release-status")));
    await expect(check).toHaveCount(0);
    await expect(content).not.toHaveAttribute("inert");
    const opening = page.getByRole("region", { name: "Opening save" });
    await expect(opening.getByRole("status")).toHaveText("Reading and validating save data…");
    await expect(opening.getByRole("progressbar")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event("repoditor-test-release-save-open")));
    await expect(opening).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Overview", selected: true })).toBeFocused();
    await expect(page.getByRole("heading", { name: "Browse this save" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Edit this save" })).toHaveCount(0);
    const previewUrl = page.url();
    await expect(page.getByRole("link", { name: "Project source" })).toHaveAttribute(
      "href",
      "https://github.com/Yoruxyv/RepoDitor",
    );
    const unsafeUrl = "https://github.com/Yoruxyv/RepoDitor?unexpected=1";
    expect(await page.evaluate((url) => window.open(url, "_blank") === null, unsafeUrl)).toBe(true);
    await page.evaluate((url) => {
      location.href = url;
    }, unsafeUrl);
    await expect(page.getByRole("heading", { name: "Run snapshot" })).toBeVisible();
    expect(page.url()).toBe(previewUrl);
    expect(page.context().pages()).toEqual([page]);

    await page.getByRole("tab", { name: "Maps", exact: true }).click();
    const unavailable = page.getByText(/No validated R\.E\.P\.O\. installation was found/);
    const empty = page.getByText("No maps were found in the installed catalog.");
    const refresh = page.getByRole("button", { name: "Refresh", exact: true });
    const alert = page.getByRole("alert");
    await expect(unavailable).toBeVisible();
    await expect(refresh).toBeEnabled();
    await expect(empty).toHaveCount(0);
    await writeFile(
      mapsResponse,
      JSON.stringify({
        ok: false,
        error: { code: "process_failed", message: "C:/private/catalog.json" },
      }),
    );
    await refresh.click();
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText("C:/private");
    await expect(unavailable).toBeVisible();
    await writeFile(mapsResponse, JSON.stringify({ ok: true, ...f.maps, maps: [] }));
    await refresh.click();
    await expect(empty).toBeVisible();
    await expect(unavailable).toHaveCount(0);
    await expect(alert).toHaveCount(0);
    await writeFile(mapsResponse, JSON.stringify({ ok: true, ...f.maps }));
    await refresh.click();
    await expect(page.getByRole("heading", { name: "McJannek Station" })).toBeVisible();
    await expect(empty).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Maps", selected: true })).toBeVisible();

    await page.getByRole("button", { name: "Cosmetics", exact: true }).click();
    await expect(alert).toHaveText("MetaSave.es3 could not be found.");
    expect(await readFile(run)).toEqual(runBefore);
    expect(await readFile(meta)).toEqual(metaBefore);
  } finally {
    await close(app.child, app.browser);
  }
});

test("ordinary packaged avatars validate save membership and retain read-only fallback", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, "REPODITOR_RECOVERY_DEFAULT_EXECUTABLE", true);
  const app = await launch(f.executable, f.home);
  try {
    const { page } = app;
    expect(await native(page, "players_avatar", { saveId: E2E_SAVE_ID, playerId: "111" })).toEqual({
      ok: true,
      data: { playerId: "111", avatarUrl: null, status: "unavailable", retryAfterMs: null },
    });
    expect(
      await native(page, "players_avatar", { saveId: E2E_SAVE_ID, playerId: "999" }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    for (const args of [
      { saveId: "../save", playerId: "111" },
      { saveId: E2E_SAVE_ID, playerId: "https://example.com" },
      { saveId: E2E_SAVE_ID, playerId: 111 },
      {},
    ]) {
      expect(await native(page, "players_avatar", args)).toMatchObject({
        ok: false,
        error: { code: "invalid_request" },
      });
    }
    // Synthetic pixels exercise the real packaged CSP without any external service.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4UCH3HwAGaAKGQO0ErgAAAABJRU5ErkJggg==",
      "base64",
    );
    let forbiddenRequests = 0;
    await page.route("https://example.com/blocked.png", async (route) => {
      forbiddenRequests++;
      await route.fulfill({ contentType: "image/png", body: png });
    });
    for (const host of ["avatars.akamai.steamstatic.com", "avatars.fastly.steamstatic.com"]) {
      await page.route(`https://${host}/synthetic.png`, (route) =>
        route.fulfill({ contentType: "image/png", body: png }),
      );
    }
    const imageLoads = await page.evaluate(async () => {
      async function loaded(url: string) {
        return new Promise<boolean>((resolve) => {
          const image = new Image();
          const done = (ok: boolean) => {
            clearTimeout(timer);
            resolve(ok);
          };
          const timer = setTimeout(() => done(false), 2000);
          image.onload = () => done(image.naturalWidth > 0);
          image.onerror = () => done(false);
          image.src = url;
        });
      }
      return Promise.all([
        loaded("https://avatars.akamai.steamstatic.com/synthetic.png"),
        loaded("https://avatars.fastly.steamstatic.com/synthetic.png"),
        loaded("https://example.com/blocked.png"),
      ]);
    });
    expect(imageLoads).toEqual([true, true, false]);
    expect(forbiddenRequests).toBe(0);
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await page.getByRole("tab", { name: "Players", exact: true }).click();
    await expect(page.getByTestId("avatar-fallback")).toHaveText("A");
    await expect(
      page.getByRole("spinbutton", { name: "Current health", exact: true }),
    ).toHaveAttribute("readonly", "");
    await expect(page.getByRole("button", { name: "Save Changes", exact: true })).toHaveCount(0);
    expect(await readFile(f.source)).toEqual(f.before);
    expect((await readdir(path.dirname(f.source))).some((name) => name.includes(".bak-"))).toBe(
      false,
    );
  } finally {
    await close(app.child, app.browser);
  }
});

test("ordinary frozen reads reject oversized Run and MetaSave inputs", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, "REPODITOR_RECOVERY_DEFAULT_EXECUTABLE", true);
  const meta = path.join(path.dirname(path.dirname(path.dirname(f.source))), "MetaSave.es3");
  await writeFile(meta, "");
  const size = 32 * 1024 * 1024 + 1;
  await truncate(f.source, size);
  await truncate(meta, size);
  const app = await launch(f.executable, f.home);
  try {
    for (const [command, args] of [
      ["saves_open", { saveId: E2E_SAVE_ID }],
      ["cosmetics_get", {}],
    ] as const) {
      expect(await native(app.page, command, args)).toMatchObject({
        ok: false,
        error: {
          code: "save_unsupported",
          message: expect.stringMatching(/size.*resource limits/),
        },
      });
    }
    expect((await stat(f.source)).size).toBe(size);
    expect((await stat(meta)).size).toBe(size);
    expect(await readdir(path.dirname(f.source))).toEqual([path.basename(f.source)]);
  } finally {
    await close(app.child, app.browser);
  }
});

test("frozen recovery preserves oversized backup and pending evidence", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    expect(await native(app.page, "test_health_write", request(digest(f.before)))).toMatchObject({
      status: "applied",
    });
    const parent = path.dirname(f.source);
    const names = await readdir(parent);
    const backup = path.join(
      parent,
      names.find((name) => name.includes(".bak-health-"))!,
    );
    const receipt = path.join(parent, `.${path.basename(f.source)}.health-pending.json`);
    const originalReceipt = await readFile(receipt);
    const applied = await readFile(f.source);
    await truncate(backup, 32 * 1024 * 1024 + 1);
    expect(await native(app.page, "test_health_recover", recovery())).toMatchObject({
      status: "conflict",
      reason: "save_unsupported",
    });
    expect(await readFile(receipt)).toEqual(originalReceipt);
    expect(await readFile(f.source)).toEqual(applied);
    expect((await stat(backup)).size).toBe(32 * 1024 * 1024 + 1);
    expect(await readdir(parent)).toEqual(names);
  } finally {
    await close(app.child, app.browser);
  }
});

for (const final of ["not_running", "running", "unknown", "query_error"]) {
  test(`final ${final}: frozen Python blocks unsafe replacement`, async ({ browserName }, info) => {
    expect(browserName).toBe("chromium");
    const f = await fixture(info);
    const app = await launch(f.executable, f.home, {
      REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
      REPODITOR_RECOVERY_FINAL_GAME_STATUS: final,
    });
    try {
      const opened = await native<Opened>(app.page, "saves_open", { saveId: E2E_SAVE_ID });
      const applied = final === "not_running";
      const rejectedReason = final === "running" ? "game_running" : "game_status_unknown";
      const expectedReason = applied ? null : rejectedReason;
      const result = await native<Transaction>(
        app.page,
        "test_health_write",
        request(opened.data.session.fingerprint),
      );
      expect(result).toMatchObject({
        status: applied ? "applied" : "uncertain",
        reason: expectedReason,
      });
      if (!applied) expect(await readFile(f.source)).toEqual(f.before);
      await exactBackup(f.source, f.before);
      expect(await pending(f.source)).toMatchObject({ version: 3, phase: "verified" });
      expect(await native(app.page, "test_health_recover", recovery())).toMatchObject({
        status: applied ? "applied" : "unchanged",
        backupAvailable: true,
      });
    } finally {
      await close(app.child, app.browser);
    }
  });
}

for (const host of ["REPODITOR_RECOVERY_DEFAULT_EXECUTABLE", "REPODITOR_SAFETY_NO_ACL_HOST"]) {
  test(`${host}: full synthetic environment cannot grant missing authority`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe("chromium");
    const f = await fixture(info, host, true);
    const app = await launch(f.executable, f.home);
    try {
      for (const command of [
        "test_health_state",
        "test_health_write",
        "test_upgrades_write",
        "test_run_write",
        "test_health_recover",
        "saves_write",
        "backend_exec",
        "plugin:fs|write_text_file",
        "plugin:shell|execute",
      ]) {
        const args =
          command === "test_health_state" ? { saveId: E2E_SAVE_ID } : request(digest(f.before));
        const result = await native(app.page, command, args).catch((error: unknown) =>
          String(error),
        );
        expect(result).toMatch(/not found|not allowed|not permitted|denied/i);
      }
      expect(await readFile(f.source)).toEqual(f.before);
      expect(
        (await readdir(path.dirname(f.source))).filter(
          (name) => name.includes("health") || name.includes(".bak"),
        ),
      ).toEqual([]);
    } finally {
      await close(app.child, app.browser);
    }
  });
}

test("explicit synthetic UI retains its authorized health and recovery behavior", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, "REPODITOR_SAFETY_UI_HOST");
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    expect(await native(app.page, "test_health_state", { saveId: E2E_SAVE_ID })).toMatchObject({
      enabled: true,
      state: "idle",
    });
    await app.page.getByRole("button", { name: /Open workspace/ }).click();
    const playersTab = app.page.getByRole("tab", { name: "Players", exact: true });
    await playersTab.click();
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "editing");
    const health = app.page.getByRole("spinbutton", { name: "Current health" });
    await health.fill("29");
    await health.press("Tab");
    await expect(playersTab).toHaveAttribute("aria-describedby", "native-players-pending");
    await expect(app.page.locator("#native-players-pending")).toHaveText("1 pending change");
    await playersTab.focus();
    await playersTab.press("ArrowRight");
    await expect(playersTab).toHaveAttribute("aria-describedby", "native-players-pending");
    await app.page.getByRole("button", { name: "Revert all", exact: true }).click();
    await expect(app.page.locator("#native-players-pending")).toHaveCount(0);
    expect(await playersTab.getAttribute("aria-describedby")).toBeNull();
    expect(await readFile(f.source)).toEqual(f.before);
    expect(await native(app.page, "test_health_write", request(digest(f.before)))).toMatchObject({
      status: "applied",
      backupAvailable: true,
    });
    await exactBackup(f.source, f.before);
    expect(await native(app.page, "test_health_recover", recovery())).toMatchObject({
      status: "applied",
      canonical: {
        players: expect.arrayContaining([expect.objectContaining({ id: "111", health: 17 })]),
      },
    });
  } finally {
    await close(app.child, app.browser);
  }
});

test("two native hosts serialize writers and reconcile cancellation", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const secondHome = path.join(f.home, "second-host");
  await mkdir(secondHome);
  const secondExecutable = path.join(secondHome, "repoditor-preview.exe");
  await copyFile(f.executable, secondExecutable);
  await stageFrozenBackend(secondHome, required("REPODITOR_RECOVERY_BACKEND"));
  const marker = path.join(f.home, "phase.json");
  const shared = {
    REPODITOR_E2E_LOCAL_APP_DATA_LOW: path.join(f.home, "AppData/LocalLow"),
    REPODITOR_E2E_STEAM_ROOT: path.join(f.home, "SteamLibrary"),
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  };
  const first = await launch(f.executable, f.home, {
    ...shared,
    REPODITOR_RECOVERY_PHASE: "before_replace",
    REPODITOR_RECOVERY_PHASE_FILE: marker,
  });
  let second: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    second = await launch(secondExecutable, secondHome, shared);
    const writing = native<Transaction>(first.page, "test_health_write", request(digest(f.before)));
    await expect
      .poll(async () => {
        try {
          return (JSON.parse(await readFile(marker, "utf8")) as { phase: string }).phase;
        } catch {
          return "";
        }
      })
      .toBe("before_replace");
    expect(
      await native(second.page, "test_health_write", request(digest(f.before), "b".repeat(32))),
    ).toMatchObject({ status: "rejected", reason: "write_busy" });
    expect(await readFile(f.source)).toEqual(f.before);
    await close(first.child, first.browser);
    expect(await writing).toMatchObject({ status: "uncertain" });
    expect(await native(second.page, "test_health_recover", recovery())).toMatchObject({
      status: "unchanged",
      backupAvailable: true,
    });
  } finally {
    if (first.child.exitCode === null) await close(first.child, first.browser);
    if (second?.child.exitCode === null) await close(second.child, second.browser);
  }
});

test("a replaced parent remains conflicting across frozen process handoff", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const env = isolatedApplicationEnvironment(f.home, path.join(f.home, "AppData/LocalLow"));
  env.REPODITOR_E2E_STEAM_ROOT = path.join(f.home, "SteamLibrary");
  env.REPODITOR_RECOVERY_SYNTHETIC_STATUS = "not_running";
  const prepared = JSON.parse(
    execFileSync(
      path.join(required("REPODITOR_RECOVERY_BACKEND"), "repoditor-backend.exe"),
      [
        "health-prepare",
        E2E_SAVE_ID,
        digest(f.before),
        JSON.stringify([{ feature: "players", entity: "111", field: "health", after: 17 }]),
        OP,
      ],
      { cwd: f.home, env, windowsHide: true, timeout: 15_000 },
    ).toString(),
  ) as { transaction: Transaction };
  expect(prepared.transaction.status).toBe("prepared");
  const slot = path.dirname(f.source);
  const moved = `${slot}-previous`;
  await rename(slot, moved);
  await mkdir(slot);
  for (const name of await readdir(moved))
    await rename(path.join(moved, name), path.join(slot, name));
  const receipt = await pending(f.source);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    expect(await native(app.page, "test_health_recover", recovery())).toMatchObject({
      status: "conflict",
      reason: "write_conflict",
    });
    expect(await readFile(f.source)).toEqual(f.before);
    expect(await pending(f.source)).toEqual(receipt);
  } finally {
    await close(app.child, app.browser);
  }
});

test("frozen numeric rejection preserves original bytes and pending evidence", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  execFileSync(
    getPythonExecutable(),
    [
      "-B",
      "-c",
      "import json,sys; from pathlib import Path; from repo_save_editor.core.crypto import _decrypt_plaintext,_encrypt_plaintext; p=Path(sys.argv[1]); d=json.loads(_decrypt_plaintext(p.read_bytes())); d['future']={'value':'__precise__'}; p.write_bytes(_encrypt_plaintext(json.dumps(d).replace(chr(34)+'__precise__'+chr(34),'0.123456789012345678901234567890').encode()))",
      f.source,
    ],
    { cwd: PYTHON_ROOT, windowsHide: true, timeout: 15_000 },
  );
  const before = await readFile(f.source);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    expect(await native(app.page, "test_health_write", request(digest(before)))).toMatchObject({
      status: "uncertain",
      reason: "save_write_failed",
    });
    expect(await readFile(f.source)).toEqual(before);
    expect(await pending(f.source)).toMatchObject({ version: 3, phase: "prepared" });
    expect((await readdir(path.dirname(f.source))).some((name) => name.includes(".bak-"))).toBe(
      false,
    );
    const recovered = await native<Transaction>(app.page, "test_health_recover", recovery());
    expect(recovered).toMatchObject({ status: "unchanged", backupAvailable: false });
    expect(await native(app.page, "test_health_recover", recovery())).toEqual(recovered);
    expect(await native(app.page, "test_health_write", request(digest(before)))).toMatchObject({
      status: "rejected",
      reason: "write_duplicate",
    });
    expect(await readFile(f.source)).toEqual(before);
  } finally {
    await close(app.child, app.browser);
  }
});

test("known builds remain unsupported and missing provenance remains unknown", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, "REPODITOR_RECOVERY_DEFAULT_EXECUTABLE", true);
  const manifest = path.join(f.home, "SteamLibrary/steamapps/appmanifest_3241660.acf");
  const original = await readFile(manifest, "utf8");
  const app = await launch(f.executable, f.home);
  try {
    // Startup discovery owns the same bounded admission lane as these explicit queries.
    await expect(app.page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
    for (const buildId of ["23363152", "26294889", "99999999"]) {
      await writeFile(manifest, original.replace(/"buildid" "\d+"/, `"buildid" "${buildId}"`));
      const result = await native(app.page, "environment_detect");
      expect(result, JSON.stringify(result)).toMatchObject({
        ok: true,
        data: { healthWriteCompatibility: { buildId, status: "unsupported", supported: false } },
      });
    }
    await writeFile(manifest, "malformed synthetic manifest");
    expect(await native(app.page, "environment_detect")).toMatchObject({
      ok: true,
      data: { healthWriteCompatibility: { buildId: null, status: "unknown", supported: false } },
    });
    expect(await readFile(f.source)).toEqual(f.before);
  } finally {
    await close(app.child, app.browser);
  }
});

test("offline recovery preserves conflict evidence and restores exact backup bytes", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, "REPODITOR_SAFETY_UI_HOST");
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  const receiptPath = path.join(
    path.dirname(f.source),
    `.${path.basename(f.source)}.health-pending.json`,
  );
  try {
    expect(await native(app.page, "test_health_write", request(digest(f.before)))).toMatchObject({
      status: "applied",
    });
    // A fresh encryption of the fixture gives conflicting bytes; no pending intent is replayed.
    await createRunSaveFixture(f.home);
    const conflicting = await readFile(f.source);
    expect(conflicting).not.toEqual(f.before);
    const receipt = await readFile(receiptPath);
    expect(await native(app.page, "test_health_state", { saveId: E2E_SAVE_ID })).toMatchObject({
      state: "pending",
    });
    expect(await readFile(receiptPath)).toEqual(receipt);
    expect(await native(app.page, "test_health_recover", recovery())).toMatchObject({
      status: "conflict",
      reason: "write_conflict",
    });
    expect(await readFile(f.source)).toEqual(conflicting);
    expect(await readFile(receiptPath)).toEqual(receipt);
    await exactBackup(f.source, f.before);
  } finally {
    await close(app.child, app.browser);
  }
  const slot = path.dirname(f.source);
  const intake = path.join(f.home, "intake");
  await cp(slot, intake, { recursive: true });
  const backupName = `${path.basename(f.source)}.bak-health-${OP}`;
  const candidate = await readFile(path.join(intake, backupName));
  const receipt = JSON.parse(
    await readFile(path.join(intake, path.basename(receiptPath)), "utf8"),
  ) as { before: string };
  expect(digest(candidate)).toBe(receipt.before);
  expect(candidate).toEqual(f.before);
  const quarantine = path.join(f.home, "quarantine");
  await rename(slot, quarantine);
  await mkdir(slot);
  await copyFile(path.join(intake, backupName), f.source);
  expect(await readFile(f.source)).toEqual(f.before);
  expect(await readFile(path.join(quarantine, path.basename(receiptPath)))).toEqual(
    await readFile(path.join(intake, path.basename(receiptPath))),
  );
  expect(await readdir(slot)).toEqual([path.basename(f.source)]);
  await copyFile(required("REPODITOR_RECOVERY_DEFAULT_EXECUTABLE"), f.executable);
  const reopened = await launch(f.executable, f.home);
  try {
    expect(await native(reopened.page, "saves_open", { saveId: E2E_SAVE_ID })).toMatchObject({
      ok: true,
      data: { session: { fingerprint: digest(f.before) } },
    });
    expect(
      await native(reopened.page, "test_health_write", request(digest(f.before))).catch(String),
    ).toMatch(/not found|not allowed|not permitted|denied/i);
  } finally {
    await close(reopened.child, reopened.browser);
  }
});

for (const version of [1, 2]) {
  test(`legacy receipt ${version} remains blocked without rewriting namespace evidence`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe("chromium");
    const f = await fixture(info, "REPODITOR_SAFETY_UI_HOST");
    const app = await launch(f.executable, f.home, {
      REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
    });
    const receiptPath = path.join(
      path.dirname(f.source),
      `.${path.basename(f.source)}.health-pending.json`,
    );
    try {
      expect(await native(app.page, "test_health_write", request(digest(f.before)))).toMatchObject({
        status: "applied",
      });
      const raw = JSON.parse(await readFile(receiptPath, "utf8")) as Record<string, unknown>;
      raw.version = version;
      delete raw.namespace;
      if (version === 1) delete raw.intent;
      await writeFile(receiptPath, JSON.stringify(raw));
      const receipt = await readFile(receiptPath);
      const source = await readFile(f.source);
      expect(await native(app.page, "test_health_state", { saveId: E2E_SAVE_ID })).toMatchObject({
        state: "pending",
      });
      expect(await native(app.page, "test_health_recover", recovery())).toMatchObject({
        status: "conflict",
        reason: "write_conflict",
      });
      expect(await readFile(receiptPath)).toEqual(receipt);
      expect(await readFile(f.source)).toEqual(source);
      await exactBackup(f.source, f.before);
    } finally {
      await close(app.child, app.browser);
    }
  });
}
