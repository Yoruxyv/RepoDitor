import path from "node:path";
import { spawn } from "node:child_process";
import { app } from "electron";

const PYTHON_TIMEOUT_MS = 30_000;
const UPGRADE_TEXTURE_TIMEOUT_MS = 60_000;
const ASSET_PREPARATION_TIMEOUT_MS = 90_000;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_UPGRADE_TEXTURE_STDOUT_BYTES = 3 * 1024 * 1024;
const MAX_ASSET_RECORD_BYTES = 3 * 1024 * 1024;
const MAX_ASSET_PREPARATION_STDIN_BYTES = 64 * 1024;
const MAX_ASSET_PREPARATION_KEYS = 64;
const MAX_ASSET_PREPARATION_KEY_BYTES = 512;
const MAX_ASSET_PREPARATION_STDOUT_BYTES = 24 * 1024 * 1024;

export type PythonCommand =
  | "environment"
  | "game-status"
  | "saves-open"
  | "saves-write"
  | "players-list"
  | "players-avatar"
  | "upgrades-list"
  | "upgrade-texture"
  | "assets-prepare"
  | "run-get"
  | "advanced-get"
  | "cosmetics-get"
  | "cosmetics-write"
  | "icons-roots"
  | "maps-list";

export type PythonClientErrorCode =
  | "python_unavailable"
  | "process_failed"
  | "process_timeout"
  | "empty_response"
  | "malformed_response";

export class PythonClientError extends Error {
  readonly code: PythonClientErrorCode;

  constructor(
    code: PythonClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PythonClientError";
    this.code = code;
  }
}

export interface PythonClient {
  run(
    command: PythonCommand,
    arguments_?: readonly string[],
  ): Promise<unknown>;
  dispose(): void;
}

export interface PythonRecordClient extends PythonClient {
  runRecords(
    command: "assets-prepare",
    request: readonly string[],
    onRecord: (record: unknown) => void | Promise<void>,
  ): Promise<unknown>;
}

function getRepoRoot(): string {
  return path.resolve(
    __dirname,
    "..",
    "..",
    "..",
  );
}

function getDevelopmentPythonExecutable(): string {
  const executable =
    process.platform === "win32"
      ? path.join(
          getRepoRoot(),
          ".venv",
          "Scripts",
          "python.exe",
        )
      : path.join(
          getRepoRoot(),
          ".venv",
          "bin",
          "python",
        );
  return executable;
}

interface PythonInvocation {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
}

export function buildPythonArguments(
  command: PythonCommand,
  arguments_: readonly string[],
  packaged: boolean,
): readonly string[] {
  if (command === "assets-prepare" && arguments_.length !== 0) {
    throw new Error("Asset preparation requests must use stdin, not process arguments.");
  }
  return packaged
    ? [command, ...arguments_]
    : ["-m", "repo_save_editor.desktop_api", command, ...arguments_];
}

function getPythonInvocation(
  command: PythonCommand,
  arguments_: readonly string[],
): PythonInvocation {
  if (app.isPackaged) {
    const executable = path.join(
      process.resourcesPath,
      "backend",
      "repoditor-backend.exe",
    );
    return {
      executable,
      arguments: buildPythonArguments(command, arguments_, true),
      cwd: path.dirname(executable),
    };
  }

  return {
    executable: getDevelopmentPythonExecutable(),
    arguments: buildPythonArguments(command, arguments_, false),
    cwd: getRepoRoot(),
  };
}

class SpawnPythonClient implements PythonClient {
  private readonly activeChildren = new Set<
    ReturnType<typeof spawn>
  >();

  private disposed = false;

  async run(
    command: PythonCommand,
    arguments_: readonly string[] = [],
  ): Promise<unknown> {
    if (this.disposed) {
      throw new PythonClientError(
        "process_failed",
        "Python client is no longer available.",
      );
    }

    const invocation = getPythonInvocation(
      command,
      arguments_,
    );

    return new Promise((resolve, reject) => {
      const child = spawn(
        invocation.executable,
        invocation.arguments,
        {
          cwd: invocation.cwd,
          windowsHide: true,
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
        },
      );
      this.activeChildren.add(child);

      let settled = false;
      let stdout = "";
      let stdoutBytes = 0;
      const stdoutLimit = command === "upgrade-texture"
        ? MAX_UPGRADE_TEXTURE_STDOUT_BYTES
        : MAX_STDOUT_BYTES;

      const timeoutMs = command === "upgrade-texture"
        ? UPGRADE_TEXTURE_TIMEOUT_MS
        : PYTHON_TIMEOUT_MS;
      const timer = setTimeout(() => {
        child.kill();
        fail(
          new PythonClientError(
            "process_timeout",
            "Python command timed out.",
          ),
        );
      }, timeoutMs);

      function finish(value: unknown): void {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }

      function fail(error: PythonClientError): void {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      }

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on(
        "data",
        (chunk: string) => {
          stdoutBytes += Buffer.byteLength(
            chunk,
            "utf8",
          );
          if (
            stdoutBytes > stdoutLimit
          ) {
            child.kill();
            fail(
              new PythonClientError(
                "malformed_response",
                "Python response exceeded the protocol limit.",
              ),
            );
            return;
          }
          stdout += chunk;
        },
      );

      child.stderr.on(
        "data",
        (chunk: string) => {
          console.error(
            `[python:${command}] ${chunk.trimEnd()}`,
          );
        },
      );

      child.on("error", (error) => {
        this.activeChildren.delete(child);
        const code =
          "code" in error &&
          typeof error.code === "string"
            ? error.code
            : undefined;
        fail(
          new PythonClientError(
            code === "ENOENT"
              ? "python_unavailable"
              : "process_failed",
            code === "ENOENT"
              ? "Python executable is unavailable."
              : "Python process could not be started.",
          ),
        );
      });

      child.on("close", (code) => {
        this.activeChildren.delete(child);
        if (settled) {
          return;
        }
        if (code !== 0) {
          fail(
            new PythonClientError(
              "process_failed",
              "Python command failed.",
            ),
          );
          return;
        }

        const output = stdout.trim();
        if (!output) {
          fail(
            new PythonClientError(
              "empty_response",
              "Python returned no response.",
            ),
          );
          return;
        }

        try {
          finish(JSON.parse(output));
        } catch {
          fail(
            new PythonClientError(
              "malformed_response",
              "Python returned malformed JSON.",
            ),
          );
        }
      });
    });
  }

  async runRecords(
    command: "assets-prepare",
    request: readonly string[],
    onRecord: (record: unknown) => void | Promise<void>,
  ): Promise<unknown> {
    if (this.disposed) {
      throw new PythonClientError(
        "process_failed",
        "Python client is no longer available.",
      );
    }

    if (
      request.length > MAX_ASSET_PREPARATION_KEYS
      || request.some((key) => Buffer.byteLength(key, "utf8") > MAX_ASSET_PREPARATION_KEY_BYTES)
    ) {
      throw new PythonClientError(
        "process_failed",
        "Python asset preparation request exceeded the protocol limit.",
      );
    }
    const requestJson = JSON.stringify(request);
    if (Buffer.byteLength(requestJson, "utf8") > MAX_ASSET_PREPARATION_STDIN_BYTES) {
      throw new PythonClientError(
        "process_failed",
        "Python asset preparation request exceeded the protocol limit.",
      );
    }
    const invocation = getPythonInvocation(command, []);
    return new Promise((resolve, reject) => {
      const child = spawn(
        invocation.executable,
        invocation.arguments,
        {
          cwd: invocation.cwd,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      this.activeChildren.add(child);

      let settled = false;
      let stdoutBytes = 0;
      let pending = "";
      let finalRecord: unknown;
      let recordTail = Promise.resolve();
      const timer = setTimeout(() => {
        child.kill();
        fail(
          new PythonClientError(
            "process_timeout",
            "Python asset preparation timed out.",
          ),
        );
      }, ASSET_PREPARATION_TIMEOUT_MS);

      function finish(value: unknown): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }

      function fail(error: PythonClientError): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }

      function consume(line: string): void {
        if (settled || !line.trim()) return;
        if (Buffer.byteLength(line, "utf8") > MAX_ASSET_RECORD_BYTES) {
          child.kill();
          fail(
            new PythonClientError(
              "malformed_response",
              "Python asset preparation record exceeded the protocol limit.",
            ),
          );
          return;
        }
        let record: unknown;
        try {
          record = JSON.parse(line);
        } catch {
          child.kill();
          fail(
            new PythonClientError(
              "malformed_response",
              "Python asset preparation returned malformed JSON.",
            ),
          );
          return;
        }
        if (
          typeof record === "object"
          && record !== null
          && !Array.isArray(record)
          && (record as Record<string, unknown>).type === "final"
        ) {
          if (finalRecord !== undefined) {
            child.kill();
            fail(
              new PythonClientError(
                "malformed_response",
                "Python asset preparation returned multiple final records.",
              ),
            );
            return;
          }
          finalRecord = record;
          return;
        }
        if (finalRecord !== undefined) {
          child.kill();
          fail(
            new PythonClientError(
              "malformed_response",
              "Python asset preparation returned data after its final record.",
            ),
          );
          return;
        }
        recordTail = recordTail.then(() => onRecord(record));
        recordTail.catch(() => {
          child.kill();
          fail(
            new PythonClientError(
              "malformed_response",
              "Python asset preparation record was rejected.",
            ),
          );
        });
      }

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdoutBytes += Buffer.byteLength(chunk, "utf8");
        if (stdoutBytes > MAX_ASSET_PREPARATION_STDOUT_BYTES) {
          child.kill();
          fail(
            new PythonClientError(
              "malformed_response",
              "Python asset preparation exceeded the protocol limit.",
            ),
          );
          return;
        }
        pending += chunk;
        let newline = pending.indexOf("\n");
        while (newline >= 0) {
          const line = pending.slice(0, newline).replace(/\r$/, "");
          pending = pending.slice(newline + 1);
          consume(line);
          newline = pending.indexOf("\n");
        }
      });
      child.stderr.on("data", (chunk: string) => {
        console.error(`[python:${command}] ${chunk.trimEnd()}`);
      });
      child.stdin.on("error", () => {
        fail(
          new PythonClientError(
            "process_failed",
            "Python asset preparation request could not be written.",
          ),
        );
      });
      child.stdin.end(requestJson, "utf8");
      child.on("error", (error) => {
        this.activeChildren.delete(child);
        const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
        fail(
          new PythonClientError(
            code === "ENOENT" ? "python_unavailable" : "process_failed",
            code === "ENOENT"
              ? "Python executable is unavailable."
              : "Python process could not be started.",
          ),
        );
      });
      child.on("close", (code) => {
        this.activeChildren.delete(child);
        if (settled) return;
        if (code !== 0) {
          fail(new PythonClientError("process_failed", "Python command failed."));
          return;
        }
        consume(pending.replace(/\r$/, ""));
        void recordTail.then(
          () => {
            if (settled) return;
            if (finalRecord === undefined) {
              fail(
                new PythonClientError(
                  stdoutBytes === 0 ? "empty_response" : "malformed_response",
                  stdoutBytes === 0
                    ? "Python returned no response."
                    : "Python asset preparation returned no final record.",
                ),
              );
              return;
            }
            finish(finalRecord);
          },
          () => undefined,
        );
      });
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (const child of this.activeChildren) {
      child.kill();
    }
  }
}

export const pythonClient: PythonClient & PythonRecordClient =
  new SpawnPythonClient();
