import {
  contextBridge,
  ipcRenderer,
} from "electron";

import {
  type AppPing,
  type DesktopOperationResult,
  type EnvironmentDiscovery,
  type IpcChannelMap,
  type RepoDitorApi,
  type SaveSummary,
} from "./contracts.cjs";

// Sandboxed preload scripts cannot require local runtime modules.
// The literal map type keeps these approved channels aligned with main.
const IPC_CHANNELS: IpcChannelMap = {
  appPing: "app:ping",
  environmentDetect: "environment:detect",
  savesList: "saves:list",
};

const repoditorApi: RepoDitorApi = {
  app: {
    ping: () =>
      ipcRenderer.invoke(
        IPC_CHANNELS.appPing,
      ) as Promise<AppPing>,
  },
  environment: {
    detect: () =>
      ipcRenderer.invoke(
        IPC_CHANNELS.environmentDetect,
      ) as Promise<
        DesktopOperationResult<EnvironmentDiscovery>
      >,
  },
  saves: {
    list: () =>
      ipcRenderer.invoke(
        IPC_CHANNELS.savesList,
      ) as Promise<
        DesktopOperationResult<SaveSummary[]>
      >,
  },
};

contextBridge.exposeInMainWorld(
  "repoditor",
  repoditorApi,
);
