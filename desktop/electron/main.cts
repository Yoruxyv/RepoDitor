import path from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
} from "electron";

import {
  IPC_CHANNELS,
} from "./channels.cjs";
import {
  type AppPing,
} from "./contracts.cjs";
import { registerEnvironmentIpc } from "./ipc/environment.cjs";

const isDevelopment = Boolean(
  process.env.VITE_DEV_SERVER_URL,
);

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

ipcMain.handle(
  IPC_CHANNELS.appPing,
  (): AppPing => ({
    ok: true,
    message: "pong",
  }),
);
registerEnvironmentIpc();

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
