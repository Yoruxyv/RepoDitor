import {
  contextBridge,
  ipcRenderer,
} from "electron";

import {
  type DesktopOperationResult,
  type EnvironmentDiscovery,
  type IpcChannelMap,
  type PlayerAvatar,
  type PlayerDto,
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
  playersList: "players:list",
  playersAvatar: "players:avatar",
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
  players: {
    list: (saveId) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.playersList,
        saveId,
      ) as Promise<
        DesktopOperationResult<PlayerDto[]>
      >,
    avatar: (saveId, playerId) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.playersAvatar,
        saveId,
        playerId,
      ) as Promise<
        DesktopOperationResult<PlayerAvatar>
      >,
  },
};

contextBridge.exposeInMainWorld(
  "repoditor",
  repoditorApi,
);
