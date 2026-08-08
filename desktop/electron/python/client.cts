import path from "node:path";
import { spawn } from "node:child_process";

const PYTHON_TIMEOUT_MS = 30_000;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;

export type PythonCommand =
  "environment";

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
  run(command: PythonCommand): Promise<unknown>;
  dispose(): void;
}

function isDevelopment(): boolean {
  return Boolean(
    process.env.VITE_DEV_SERVER_URL,
  );
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

function getPackagedPythonExecutable(): never {
  throw new PythonClientError(
    "python_unavailable",
    "Packaged Python runtime is not configured yet.",
  );
}

function getPythonExecutable(): string {
  return isDevelopment()
    ? getDevelopmentPythonExecutable()
    : getPackagedPythonExecutable();
}

class SpawnPythonClient implements PythonClient {
  private readonly activeChildren = new Set<
    ReturnType<typeof spawn>
  >();

  private disposed = false;

  async run(
    command: PythonCommand,
  ): Promise<unknown> {
    if (this.disposed) {
      throw new PythonClientError(
        "process_failed",
        "Python client is no longer available.",
      );
    }

    const executable = getPythonExecutable();
    const repoRoot = getRepoRoot();

    return new Promise((resolve, reject) => {
      const child = spawn(
        executable,
        [
          "-m",
          "repo_save_editor.desktop_api",
          command,
        ],
        {
          cwd: repoRoot,
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

      const timer = setTimeout(() => {
        child.kill();
        fail(
          new PythonClientError(
            "process_timeout",
            "Python command timed out.",
          ),
        );
      }, PYTHON_TIMEOUT_MS);

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
            stdoutBytes > MAX_STDOUT_BYTES
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
          if (isDevelopment()) {
            console.error(
              `[python:${command}] ${chunk.trimEnd()}`,
            );
          }
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

export const pythonClient: PythonClient =
  new SpawnPythonClient();
