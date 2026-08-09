import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  Menu,
  shell,
} from "electron";

import { registerEnvironmentIpc } from "./ipc/environment.cjs";
import { registerEditorIpc } from "./ipc/editor.cjs";
import { registerPlayerIpc } from "./ipc/players.cjs";
import { registerSaveIpc } from "./ipc/saves.cjs";
import { pythonClient } from "./python/client.cjs";

const developmentRendererUrl =
  process.env.VITE_DEV_SERVER_URL;
const projectUrl = "https://github.com/Dendroculus/RepoDitor";

function getRendererUrl(): string {
  if (developmentRendererUrl) {
    return developmentRendererUrl;
  }

  return pathToFileURL(
    path.join(
      __dirname,
      "..",
      "dist",
      "index.html",
    ),
  ).href;
}

function normalizeNavigationUrl(url: string): string {
  const normalized = new URL(url);
  normalized.hash = "";
  return normalized.href;
}

function secureRendererNavigation(
  window: BrowserWindow,
  rendererUrl: string,
): void {
  const allowedUrl = normalizeNavigationUrl(
    rendererUrl,
  );

  window.webContents.setWindowOpenHandler(
    ({ url }) => {
      if (url === projectUrl) {
        void shell.openExternal(url).catch((error: unknown) => {
          console.error("Unable to open the RepoDitor project page.", error);
        });
      }
      return { action: "deny" };
    },
  );
  window.webContents.on(
    "will-navigate",
    (event, navigationUrl) => {
      if (
        normalizeNavigationUrl(
          navigationUrl,
        ) !== allowedUrl
      ) {
        event.preventDefault();
      }
    },
  );
}

function createWindow(): void {
  const rendererUrl = getRendererUrl();
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "RepoDitor",

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
  secureRendererNavigation(
    window,
    rendererUrl,
  );

  window.once("ready-to-show", () => {
    window.show();
  });

  void window.loadURL(rendererUrl);
}

registerEnvironmentIpc();
registerSaveIpc();
registerPlayerIpc();
registerEditorIpc();

void app.whenReady().then(() => {
  if (app.isPackaged) {
    Menu.setApplicationMenu(null);
  }
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

app.on("before-quit", () => {
  pythonClient.dispose();
});
