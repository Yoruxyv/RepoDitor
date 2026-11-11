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
    await expect(waitForPreviewPage(fixture.browser, performance.now() + 1000)).resolves.toBe(page);
    expect(fixture.waitForEvent).not.toHaveBeenCalled();
  });

  it("waits for a late page target within the remaining launch deadline", async () => {
    const fixture = browser([]);
    let attach!: (page: Page) => void;
    fixture.waitForEvent.mockReturnValue(
      new Promise<Page>((resolve) => {
        attach = resolve;
      }),
    );
    const ready = waitForPreviewPage(fixture.browser, performance.now() + 2000);
    expect(fixture.waitForEvent).toHaveBeenCalledExactlyOnceWith("page", {
      timeout: expect.any(Number),
    });
    const timeout = fixture.waitForEvent.mock.calls[0]?.[1].timeout;
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(2000);
    attach(page);
    await expect(ready).resolves.toBe(page);
  });

  it("fails when no page arrives or the launch deadline has elapsed", async () => {
    const fixture = browser([]);
    fixture.waitForEvent.mockRejectedValue(new Error("Page event timed out"));
    await expect(waitForPreviewPage(fixture.browser, performance.now() + 1000)).rejects.toThrow(
      "Page event timed out",
    );
    fixture.waitForEvent.mockClear();
    await expect(waitForPreviewPage(fixture.browser, performance.now())).rejects.toThrow(
      "Preview page missing",
    );
    expect(fixture.waitForEvent).not.toHaveBeenCalled();
  });
});

describe("bounded Windows diagnostic transport", () => {
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
