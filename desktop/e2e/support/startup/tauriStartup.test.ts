// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "@playwright/test";
import { waitForPreviewPage, windowsStartup } from "./tauriStartup";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawnSync: vi.fn(original.spawnSync) };
});
afterEach(() => {
  vi.mocked(spawnSync).mockReset();
  vi.unstubAllEnvs();
});

describe("bounded preview page readiness", () => {
  const page = {} as Page;

  function browser(pages: Page[]) {
    const waitForEvent = vi.fn<(event: string, options: { timeout: number }) => Promise<Page>>();
    const context = { pages: () => pages, waitForEvent } as unknown as BrowserContext;
    return { browser: { contexts: () => [context] }, waitForEvent };
  }

  it("uses the attached page when CDP already exposes it", async () => {
    const fixture = browser([page]);
    await expect(waitForPreviewPage(fixture.browser, 20_000, 10_000)).resolves.toBe(page);
    expect(fixture.waitForEvent).not.toHaveBeenCalled();
  });

  it("keeps a near-deadline CDP connection's page budget after the clock crosses the deadline", async () => {
    const fixture = browser([]);
    let attach!: (page: Page) => void;
    fixture.waitForEvent.mockReturnValue(
      new Promise<Page>((resolve) => {
        attach = resolve;
      }),
    );
    const clock = vi.spyOn(performance, "now").mockReturnValueOnce(20_001);
    const ready = waitForPreviewPage(fixture.browser, 20_000, 19_999);
    clock.mockRestore();
    expect(fixture.waitForEvent).toHaveBeenCalledExactlyOnceWith("page", {
      timeout: 4998,
    });
    attach(page);
    await expect(ready).resolves.toBe(page);
  });

  it("fails when no page arrives or the launch deadline has elapsed", async () => {
    const fixture = browser([]);
    fixture.waitForEvent.mockRejectedValue(new Error("Page event timed out"));
    const clock = vi.spyOn(performance, "now").mockReturnValueOnce(20_001);
    const waiting = waitForPreviewPage(fixture.browser, 20_000, 20_001);
    clock.mockRestore();
    await expect(waiting).rejects.toThrow("Page event timed out");
    expect(fixture.waitForEvent).toHaveBeenCalledExactlyOnceWith("page", { timeout: 4999 });
    fixture.waitForEvent.mockClear();
    const expired = vi.spyOn(performance, "now").mockReturnValueOnce(25_000);
    const failed = waitForPreviewPage(fixture.browser, 20_000, 20_001);
    expired.mockRestore();
    await expect(failed).rejects.toThrow("Preview page deadline expired");
    expect(fixture.waitForEvent).not.toHaveBeenCalled();
  });

  it("reports a missing CDP context immediately", async () => {
    await expect(waitForPreviewPage({ contexts: () => [] }, 20_000, 19_999)).rejects.toThrow(
      "Preview CDP connection has no browser context",
    );
  });
});

describe("bounded Windows diagnostic transport", () => {
  it("uses PowerShell on PATH when no diagnostic shell is configured", () => {
    vi.stubEnv("REPODITOR_WINDOWS_PROBE_SHELL", undefined);
    vi.mocked(spawnSync).mockReturnValue({
      pid: 42,
      status: 0,
      signal: null,
      output: [],
      stdout: JSON.stringify({ hostAlive: true }),
      stderr: "",
    });
    expect(windowsStartup(123, "synthetic", "fixture-interop")).toMatchObject({ hostAlive: true });
    expect(spawnSync).toHaveBeenCalledExactlyOnceWith(
      "pwsh.exe",
      expect.arrayContaining(["-HostProcessId", "123"]),
      expect.objectContaining({ timeout: 5000 }),
    );
  });

  it("uses the configured shell and preserves the deadline, output cap and numeric timings", () => {
    const executable = "C:\\PowerShell\\pwsh.exe";
    vi.stubEnv("REPODITOR_WINDOWS_PROBE_SHELL", executable);
    vi.mocked(spawnSync).mockReturnValue({
      pid: 42,
      status: 0,
      signal: null,
      output: [],
      stdout: JSON.stringify({ hostAlive: true }),
      stderr: `REPODITOR_PROBE_TIMING entry|1|${Date.now()}\nREPODITOR_PROBE_TIMING emitted|20|${Date.now()}\nSECRET_SENTINEL=private\nREPODITOR_PROBE_TIMING C:/Users/Private/data|1|2`,
    });
    const result = windowsStartup(123, "synthetic", "fixture-interop") as {
      hostAlive: boolean;
      timings: { checkpoints: unknown[] };
    };
    expect(result.hostAlive).toBe(true);
    expect(result.timings.checkpoints).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/SECRET_SENTINEL|private|Users/);
    expect(spawnSync).toHaveBeenCalledWith(
      executable,
      expect.arrayContaining(["-HostProcessId", "123", "-Interop", "fixture-interop"]),
      expect.objectContaining({
        timeout: 5000,
        killSignal: "SIGKILL",
        maxBuffer: 16_384,
        windowsHide: true,
      }),
    );
  });

  it("rejects a relative diagnostic shell without spawning a child", () => {
    vi.stubEnv("REPODITOR_WINDOWS_PROBE_SHELL", "pwsh.exe");
    expect(windowsStartup(123, "synthetic", "fixture-interop")).toMatchObject({
      probeError: expect.stringContaining("absolute path"),
    });
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it.each(["[]", "true", "{broken"])("rejects malformed diagnostic output %s", (stdout) => {
    vi.mocked(spawnSync).mockReturnValue({
      pid: 42,
      status: 0,
      signal: null,
      output: [],
      stdout,
      stderr: "",
    });
    expect(windowsStartup(123, "synthetic", "fixture-interop")).toMatchObject({
      probeError: expect.any(String),
    });
  });

  it("reports a transport exception as a failed probe", () => {
    vi.mocked(spawnSync).mockImplementation(() => {
      throw new Error("authorization=private-error");
    });
    const result = windowsStartup(123, "synthetic", "fixture-interop");
    expect(result).toMatchObject({
      probeError: expect.stringContaining("authorization=<redacted>"),
    });
    expect(JSON.stringify(result)).not.toContain("private-error");
  });

  it.each(["timeout", "output limit", "access denied", "exit failure"])(
    "never admits partial success after %s",
    (kind) => {
      vi.mocked(spawnSync).mockReturnValue({
        pid: 42,
        status: kind === "exit failure" ? 1 : null,
        signal: null,
        output: [],
        stdout: JSON.stringify({ hostAlive: true }),
        stderr: `REPODITOR_PROBE_TIMING entry|1|${Date.now()}\nREPODITOR_PROBE_WIN32_ERROR 5\nauthorization=private-error`,
        ...(kind === "exit failure" ? {} : { error: new Error(kind) }),
      });
      const result = windowsStartup(123, "synthetic", "fixture-interop") as {
        probeError: string;
        hostAlive?: boolean;
        probeErrorCode: number;
      };
      expect(result.probeError).toBeTruthy();
      expect(result.hostAlive).toBeUndefined();
      expect(result.probeErrorCode).toBe(5);
      expect(JSON.stringify(result)).not.toContain("private-error");
    },
  );

  it("a slow probe is killed at the unchanged deadline and retains partial measurements", async () => {
    const original =
      await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const directory = mkdtempSync(path.join(os.tmpdir(), "repoditor-probe-timeout-"));
    const marker = path.join(directory, "pid.txt");
    const fixture = path.join(directory, "slow.cjs");
    writeFileSync(
      fixture,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));process.stderr.write('REPODITOR_PROBE_TIMING entry|1|'+Date.now()+'\\n');process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),7000);setInterval(()=>{},1000);`,
    );
    try {
      vi.mocked(spawnSync).mockImplementation((_executable, _args, options) => {
        const result = original.spawnSync(process.execPath, [fixture], options);
        expect(result.signal).toBe("SIGKILL");
        return result;
      });
      const result = windowsStartup(123, directory, "fixture-interop") as {
        probeError: string;
        timings: { probeProcessId: number; checkpoints: { stage: string }[] };
      };
      const pid = Number(readFileSync(marker, "utf8"));
      expect(result.probeError).toContain("ETIMEDOUT");
      expect(result.timings.probeProcessId).toBe(pid);
      expect(result.timings.checkpoints.map((mark) => mark.stage)).toEqual(["entry"]);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      unlinkSync(fixture);
      unlinkSync(marker);
      rmdirSync(directory);
    }
  }, 10_000);
});
