// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { windowsStartup } from "./tauriStartup";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawnSync: vi.fn(original.spawnSync) };
});
afterEach(() => vi.mocked(spawnSync).mockReset());

describe("bounded Windows diagnostic transport", () => {
  it("preserves the deadline, output cap and numeric timings without exposing stderr", () => {
    vi.mocked(spawnSync).mockReturnValue({
      pid: 42,
      status: 0,
      signal: null,
      output: [],
      stdout: JSON.stringify({ hostAlive: true }),
      stderr: `REPODITOR_PROBE_TIMING entry|1|${Date.now()}\nREPODITOR_PROBE_TIMING emitted|20|${Date.now()}\nSECRET_SENTINEL=private\nREPODITOR_PROBE_TIMING C:/Users/Private/data|1|2`,
    });
    const result = windowsStartup(123, "synthetic") as {
      hostAlive: boolean;
      timings: { checkpoints: unknown[] };
    };
    expect(result.hostAlive).toBe(true);
    expect(result.timings.checkpoints).toHaveLength(2);
    expect(JSON.stringify(result)).not.toMatch(/SECRET_SENTINEL|private|Users/);
    expect(spawnSync).toHaveBeenCalledWith(
      expect.stringContaining("powershell.exe"),
      expect.arrayContaining(["-HostProcessId", "123"]),
      expect.objectContaining({
        timeout: 5000,
        killSignal: "SIGKILL",
        maxBuffer: 16_384,
        windowsHide: true,
      }),
    );
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
    expect(windowsStartup(123, "synthetic")).toMatchObject({ probeError: expect.any(String) });
  });

  it("reports a transport exception as a failed probe", () => {
    vi.mocked(spawnSync).mockImplementation(() => {
      throw new Error("authorization=private-error");
    });
    const result = windowsStartup(123, "synthetic");
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
      const result = windowsStartup(123, "synthetic") as {
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
      const result = windowsStartup(123, directory) as {
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
