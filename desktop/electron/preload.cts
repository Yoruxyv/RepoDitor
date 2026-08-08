import {
  contextBridge,
  ipcRenderer,
} from "electron";

import {
  type DesktopOperationResult,
  type EnvironmentDiscovery,
  type IpcChannelMap,
  type RepoDitorApi,
  type SaveSession,
  type SaveSummary,
} from "./contracts.cjs";

// Sandboxed preload scripts cannot require local runtime modules.
// The literal map type keeps these approved channels aligned with main.
const IPC_CHANNELS: IpcChannelMap = {
  environmentDetect: "environment:detect",
  savesList: "saves:list",
  savesOpen: "saves:open",
};

const repoditorApi: RepoDitorApi = {
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
    open: (saveId) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.savesOpen,
        saveId,
      ) as Promise<
        DesktopOperationResult<SaveSession>
      >,
  },
};

contextBridge.exposeInMainWorld(
  "repoditor",
  repoditorApi,
);
