import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type TestInfo } from "@playwright/test";
import {
  createRunSaveFixture,
  DESKTOP_ROOT,
  E2E_SAVE_ID,
  getPythonExecutable,
  PYTHON_ROOT,
} from "./support/fixtureEnvironment";
import { createGameFixture } from "./support/harness";
import { close, launch, native, stageFrozenBackend } from "./support/tauriHarness";

interface Transaction {
  operationId: string;
  status: "rejected" | "uncertain" | "applied" | "unchanged" | "conflict" | "busy";
  fingerprint: string | null;
  backupAvailable: boolean;
  reason: string | null;
}
const OP = "a".repeat(32);
const NEXT = "b".repeat(32);
const FEATURE = process.env["REPODITOR_RECOVERY_EXECUTABLE"];

async function fixture(info: TestInfo, phase = "") {
  if (!FEATURE) throw new Error("REPODITOR_RECOVERY_EXECUTABLE must name the synthetic-only host");
  const home = info.outputPath("isolated");
  await mkdir(home, { recursive: true });
  const source = await createRunSaveFixture(home);
  await createGameFixture(home);
  const executable = path.join(home, "repoditor-preview.exe");
  await cp(path.resolve(DESKTOP_ROOT, FEATURE), executable);
  await stageFrozenBackend(
    home,
    process.env["REPODITOR_RECOVERY_BACKEND"] ??
      "build/recovery-checkpoint/fault-backend/repoditor-backend",
  );
  const before = await readFile(source);
  const environment = {
    REPODITOR_RECOVERY_PHASE: phase,
    REPODITOR_RECOVERY_PHASE_FILE: path.join(home, "phase.json"),
  };
  return { home, source, executable, before, environment };
}

async function opened(page: Awaited<ReturnType<typeof launch>>["page"]) {
  const result = await native<{ ok: true; data: { session: { fingerprint: string } } }>(
    page,
    "saves_open",
    { saveId: E2E_SAVE_ID },
  );
  expect(result.ok).toBe(true);
  return result.data.session.fingerprint;
}

function request(fingerprint: string, operationId = OP) {
  return {
    request: { saveId: E2E_SAVE_ID, fingerprint, playerId: "111", health: 17, operationId },
  };
}

function recovery(operationId = OP) {
  return { request: { saveId: E2E_SAVE_ID, operationId } };
}

async function started(home: string, phase: string) {
  let pid = 0;
  await expect
    .poll(async () => {
      try {
        const event = JSON.parse(await readFile(path.join(home, "phase.json"), "utf8")) as {
          phase: string;
          pid: number;
        };
        pid = event.pid;
        return event.phase;
      } catch {
        return "";
      }
    })
    .toBe(phase);
  return pid;
}

async function reaped(pid: number) {
  await expect
    .poll(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
        throw error;
      }
    })
    .toBe(true);
}

async function backups(source: string) {
  return (await readdir(path.dirname(source))).filter((name) => name.includes(".bak-health-"));
}

test("internal health transport applies only one field, keeps UI readonly and rejects other authority", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, f.environment);
  try {
    const fingerprint = await opened(app.page);
    for (const [key, value] of [
      ["health", true],
      ["health", 1.5],
      ["playerId", "../file"],
      ["operationId", "../file"],
      ["saveId", "../file"],
    ] as const) {
      const raw = request(fingerprint);
      const bad = { ...raw.request, [key]: value };
      expect(
        await native<Transaction>(app.page, "test_health_write", { request: bad }),
      ).toMatchObject({ status: "rejected", reason: "invalid_request" });
    }
    expect(await readFile(f.source)).toEqual(f.before);
    const result = await native<Transaction>(app.page, "test_health_write", request(fingerprint));
    expect(result).toMatchObject({ status: "applied", backupAvailable: true });
    expect(result.fingerprint).not.toBe(fingerprint);
    expect(await opened(app.page)).toBe(result.fingerprint);
    const decoded = execFileSync(
      getPythonExecutable(),
      [
        "-c",
        "import json,sys; from pathlib import Path; from repo_save_editor.storage.repository import SaveRepository; print(json.dumps(SaveRepository.load(Path(sys.argv[1]))))",
        f.source,
      ],
      { cwd: PYTHON_ROOT, env: { ...process.env, PYTHONPATH: PYTHON_ROOT }, windowsHide: true },
    );
    const original = JSON.parse(
      await readFile(path.join(DESKTOP_ROOT, "e2e/fixtures/save.json"), "utf8"),
    );
    original.dictionaryOfDictionaries.value.playerHealth["111"] = 17;
    expect(JSON.parse(decoded.toString())).toEqual(original);
    const names = await backups(f.source);
    expect(names).toHaveLength(1);
    expect(await readFile(path.join(path.dirname(f.source), names[0]))).toEqual(f.before);
    expect(
      await native<Transaction>(app.page, "test_health_write", request(result.fingerprint!)),
    ).toMatchObject({ status: "rejected", reason: "write_recovery_required" });
    expect(await native<Transaction>(app.page, "test_health_recover", recovery())).toEqual(result);
    expect(
      await native<Transaction>(app.page, "test_health_write", request(result.fingerprint!)),
    ).toMatchObject({ status: "rejected", reason: "write_duplicate" });
    for (const command of [
      "saves_write",
      "cosmetics_write",
      "backend_run",
      "plugin:fs|write_file",
      "plugin:shell|execute",
    ]) {
      const denied = await native(app.page, command, {}).catch((error: unknown) => String(error));
      expect(denied).toMatch(/not found|not allowed|not permitted|denied/i);
    }
    await expect(app.page.getByRole("button", { name: /Save Changes|Revert All/ })).toHaveCount(0);
    await writeFile(info.outputPath("applied.json"), JSON.stringify(result, null, 2));
  } finally {
    await close(app.child, app.browser);
  }
});

test("lost response after replacement remains uncertain until explicit recovery", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, "response_error");
  const app = await launch(f.executable, f.home, f.environment);
  try {
    const fingerprint = await opened(app.page);
    const result = await native<Transaction>(app.page, "test_health_write", request(fingerprint));
    expect(result).toMatchObject({ status: "uncertain", reason: "save_validation_failed" });
    expect(await readFile(f.source)).not.toEqual(f.before);
    expect(
      await native<Transaction>(app.page, "test_health_write", request(fingerprint, NEXT)),
    ).toMatchObject({ status: "rejected", reason: "write_recovery_required" });
    expect(await native<Transaction>(app.page, "test_health_recover", recovery())).toMatchObject({
      status: "applied",
      backupAvailable: true,
    });
    await writeFile(info.outputPath("lost-response.json"), JSON.stringify(result, null, 2));
  } finally {
    await close(app.child, app.browser);
  }
});

test("a real native write deadline keeps status independent and recovers a replaced save", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, "after_replace");
  const app = await launch(f.executable, f.home, f.environment);
  try {
    const fingerprint = await opened(app.page);
    const start = performance.now();
    let writeFinished = false;
    const pending = native<Transaction>(app.page, "test_health_write", request(fingerprint)).then(
      (result) => {
        writeFinished = true;
        return result;
      },
    );
    const pid = await started(f.home, "after_replace");
    expect(
      await native<Transaction>(app.page, "test_health_write", request(fingerprint, NEXT)),
    ).toMatchObject({ status: "rejected", reason: "process_failed" });
    const statusStart = performance.now();
    expect(await native(app.page, "game_status")).toMatchObject({
      ok: true,
      data: { status: "not_running" },
    });
    const statusMs = performance.now() - statusStart;
    expect(writeFinished).toBe(false);
    const result = await pending;
    const timeoutMs = performance.now() - start;
    expect(timeoutMs).toBeGreaterThanOrEqual(29000);
    expect(result).toMatchObject({ status: "uncertain", reason: "write_uncertain" });
    await reaped(pid);
    expect(await native<Transaction>(app.page, "test_health_recover", recovery())).toMatchObject({
      status: "applied",
    });
    await writeFile(
      info.outputPath("timeout.json"),
      JSON.stringify({ result, timeoutMs, statusMs, pid, childReaped: true }, null, 2),
    );
  } finally {
    await close(app.child, app.browser);
  }
});

test("close before replacement cancels the child; restart recovery is idempotent", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, "before_replace");
  let app = await launch(f.executable, f.home, f.environment);
  let closed = false;
  try {
    const fingerprint = await opened(app.page);
    const pending = native(app.page, "test_health_write", request(fingerprint)).catch(() => null);
    const pid = await started(f.home, "before_replace");
    await close(app.child, app.browser);
    closed = true;
    await pending;
    await reaped(pid);
    expect(await readFile(f.source)).toEqual(f.before);
    app = await launch(f.executable, f.home);
    closed = false;
    expect(
      await native<Transaction>(app.page, "test_health_write", request(fingerprint, NEXT)),
    ).toMatchObject({ status: "rejected", reason: "write_recovery_required" });
    const result = await native<Transaction>(app.page, "test_health_recover", recovery());
    expect(result).toMatchObject({ status: "unchanged", backupAvailable: true });
    expect(await native<Transaction>(app.page, "test_health_recover", recovery())).toEqual(result);
    expect((await readdir(path.dirname(f.source))).filter((name) => name.endsWith(".tmp"))).toEqual(
      [],
    );
    expect(await readFile(f.source)).toEqual(f.before);
    await writeFile(
      info.outputPath("close-restart.json"),
      JSON.stringify({ result, pid, childReaped: true }, null, 2),
    );
  } finally {
    if (!closed) await close(app.child, app.browser);
  }
});

test("an external save change before reconciliation is a conflict", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, "response_error");
  const app = await launch(f.executable, f.home, f.environment);
  try {
    const fingerprint = await opened(app.page);
    expect(
      await native<Transaction>(app.page, "test_health_write", request(fingerprint)),
    ).toMatchObject({ status: "uncertain" });
    execFileSync(
      getPythonExecutable(),
      [
        "-c",
        "import sys; from pathlib import Path; from repo_save_editor.storage.repository import SaveRepository; p=Path(sys.argv[1]); d=SaveRepository.load(p); d['futureField']={'value':'external'}; SaveRepository(p.parent).save_as(p,d)",
        f.source,
      ],
      { cwd: PYTHON_ROOT, env: { ...process.env, PYTHONPATH: PYTHON_ROOT }, windowsHide: true },
    );
    const external = await readFile(f.source);
    expect(await native<Transaction>(app.page, "test_health_recover", recovery())).toMatchObject({
      status: "conflict",
      reason: "write_conflict",
    });
    expect(
      await native<Transaction>(app.page, "test_health_write", request(fingerprint, NEXT)),
    ).toMatchObject({ status: "rejected", reason: "write_recovery_required" });
    expect(await readFile(f.source)).toEqual(external);
  } finally {
    await close(app.child, app.browser);
  }
});

test("the synthetic host rejects a LocalLow root outside its compiled fixture boundary", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, {
    REPODITOR_E2E_LOCAL_APP_DATA_LOW: path.join(
      DESKTOP_ROOT,
      "build/recovery-unfenced/nonexistent",
    ),
  });
  try {
    expect(
      await native<Transaction>(app.page, "test_health_write", request("a".repeat(64))),
    ).toMatchObject({ status: "rejected", reason: "invalid_request" });
    expect(await readFile(f.source)).toEqual(f.before);
    expect(await backups(f.source)).toEqual([]);
  } finally {
    await close(app.child, app.browser);
  }
});

test("close during recovery leaves a durable classification that resumes after restart", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, "response_error");
  let app = await launch(f.executable, f.home, f.environment);
  let closed = false;
  try {
    const fingerprint = await opened(app.page);
    expect(
      await native<Transaction>(app.page, "test_health_write", request(fingerprint)),
    ).toMatchObject({ status: "uncertain" });
    await close(app.child, app.browser);
    closed = true;
    app = await launch(f.executable, f.home, {
      ...f.environment,
      REPODITOR_RECOVERY_PHASE: "recovery_archive",
    });
    closed = false;
    const pending = native(app.page, "test_health_recover", recovery()).catch(() => null);
    const pid = await started(f.home, "recovery_archive");
    await close(app.child, app.browser);
    closed = true;
    await pending;
    await reaped(pid);
    app = await launch(f.executable, f.home);
    closed = false;
    const result = await native<Transaction>(app.page, "test_health_recover", recovery());
    expect(result).toMatchObject({ status: "applied", backupAvailable: true });
    expect(await native<Transaction>(app.page, "test_health_recover", recovery())).toEqual(result);
    expect(
      await native<Transaction>(app.page, "test_health_write", request(result.fingerprint!)),
    ).toMatchObject({ status: "rejected", reason: "write_duplicate" });
    await writeFile(
      info.outputPath("recovery-restart.json"),
      JSON.stringify({ result, pid, childReaped: true }, null, 2),
    );
  } finally {
    if (!closed) await close(app.child, app.browser);
  }
});

test("the normal build denies both internal recovery commands", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const normal = process.env["REPODITOR_RECOVERY_DEFAULT_EXECUTABLE"];
  if (!normal) throw new Error("REPODITOR_RECOVERY_DEFAULT_EXECUTABLE must name the normal host");
  const f = await fixture(info);
  await cp(path.resolve(DESKTOP_ROOT, normal), f.executable);
  const app = await launch(f.executable, f.home);
  try {
    for (const command of ["test_health_write", "test_health_recover"]) {
      const denied = await native(app.page, command, request("a".repeat(64))).catch(
        (error: unknown) => String(error),
      );
      expect(denied).toMatch(/not found|not allowed|not permitted|denied/i);
    }
    expect(await readFile(f.source)).toEqual(f.before);
    expect(await backups(f.source)).toEqual([]);
  } finally {
    await close(app.child, app.browser);
  }
});

test("a completed receipt cannot bypass recovery when the final response is lost", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, "after_completion");
  let app = await launch(f.executable, f.home, f.environment);
  let closed = false;
  try {
    const fingerprint = await opened(app.page);
    const pending = native(app.page, "test_health_write", request(fingerprint)).catch(() => null);
    const pid = await started(f.home, "after_completion");
    const hostPid = app.child.pid;
    const exited = once(app.child, "exit");
    expect(app.child.kill()).toBe(true);
    await exited;
    await app.browser.close();
    closed = true;
    await pending;
    await reaped(pid);
    expect(await readFile(f.source)).not.toEqual(f.before);
    app = await launch(f.executable, f.home);
    closed = false;
    expect(
      await native<Transaction>(app.page, "test_health_write", request(fingerprint, NEXT)),
    ).toMatchObject({ status: "rejected", reason: "write_recovery_required" });
    const result = await native<Transaction>(app.page, "test_health_recover", recovery());
    expect(result).toMatchObject({ status: "applied", backupAvailable: true });
    expect(
      await native<Transaction>(app.page, "test_health_write", request(result.fingerprint!)),
    ).toMatchObject({ status: "rejected", reason: "write_duplicate" });
    await writeFile(
      info.outputPath("completion-response-loss.json"),
      JSON.stringify({ result, pid, hostPid, hostCrash: true, childReaped: true }, null, 2),
    );
  } finally {
    if (!closed) await close(app.child, app.browser);
  }
});

for (const phase of ["reservation_response", "before_execution"]) {
  test(`a crash at ${phase} still requires recovery after restart`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe("chromium");
    const f = await fixture(info, phase);
    let app = await launch(f.executable, f.home, f.environment);
    let closed = false;
    try {
      const fingerprint = await opened(app.page);
      const pending = native(app.page, "test_health_write", request(fingerprint)).catch(() => null);
      const pid = await started(f.home, phase);
      const exited = once(app.child, "exit");
      expect(app.child.kill()).toBe(true);
      await exited;
      await app.browser.close();
      closed = true;
      await pending;
      await reaped(pid);
      expect(await readFile(f.source)).toEqual(f.before);
      expect(await backups(f.source)).toEqual([]);
      app = await launch(f.executable, f.home);
      closed = false;
      expect(
        await native<Transaction>(app.page, "test_health_write", request(fingerprint, NEXT)),
      ).toMatchObject({ status: "rejected", reason: "write_recovery_required" });
      const result = await native<Transaction>(app.page, "test_health_recover", recovery());
      expect(result).toMatchObject({ status: "unchanged", backupAvailable: false });
      expect(
        await native<Transaction>(app.page, "test_health_write", request(fingerprint)),
      ).toMatchObject({ status: "rejected", reason: "write_duplicate" });
      await writeFile(
        info.outputPath("before-execution-restart.json"),
        JSON.stringify({ result, pid, childReaped: true, backupCount: 0 }, null, 2),
      );
    } finally {
      if (!closed) await close(app.child, app.browser);
    }
  });
}
