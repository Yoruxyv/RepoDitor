import path from "node:path";
import { spawn } from "node:child_process";
import {
  app,
  BrowserWindow,
  ipcMain,
} from "electron";

interface PythonResponse {
  ok: boolean;
  message: string;
  source: string;
}

const isDevelopment =
  Boolean(process.env.VITE_DEV_SERVER_URL);

function getRepoRoot(): string {
  return path.resolve(
    __dirname,
    "..",
    "..",
  );
}

function getPythonExecutable(): string {
  if (!isDevelopment) {
    throw new Error(
      "Packaged Python runtime is not configured yet.",
    );
  }

  return path.join(
    getRepoRoot(),
    ".venv",
    "Scripts",
    "python.exe",
  );
}

function runPython(
  args: string[],
): Promise<PythonResponse> {
  return new Promise((resolve, reject) => {
    const repoRoot = getRepoRoot();

    const child = spawn(
      getPythonExecutable(),
      [
        "-m",
        "repo_save_editor.desktop_api",
        ...args,
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

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              `Python exited with code ${code}.`,
          ),
        );

        return;
      }

      const lines = stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);

      const output = lines.at(-1);

      if (!output) {
        reject(
          new Error(
            "Python returned no response.",
          ),
        );

        return;
      }

      try {
        resolve(
          JSON.parse(output) as PythonResponse,
        );
      } catch {
        reject(
          new Error(
            `Invalid Python response: ${output}`,
          ),
        );
      }
    });
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,

    webPreferences: {
      preload: path.join(
        __dirname,
        "preload.cjs",
      ),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  if (
    isDevelopment &&
    process.env.VITE_DEV_SERVER_URL
  ) {
    void window.loadURL(
      process.env.VITE_DEV_SERVER_URL,
    );

    return;
  }

  void window.loadFile(
    path.join(
      __dirname,
      "..",
      "dist",
      "index.html",
    ),
  );
}

ipcMain.handle("app:ping", () => ({
  ok: true,
  message: "pong",
}));

ipcMain.handle(
  "python:ping",
  async () => {
    return runPython(["ping"]);
  },
);

void app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (
      BrowserWindow.getAllWindows().length === 0
    ) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});