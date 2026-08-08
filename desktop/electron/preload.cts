import {
  contextBridge,
  ipcRenderer,
} from "electron";

import {
  type DesktopOperationResult,
  type EnvironmentDiscovery,
  type InstalledMapsDto,
  type IpcChannelMap,
  type PlayerAvatar,
  type PlayerDto,
  type PlayerUpgradeDto,
  type RepoDitorApi,
  type RunStateDto,
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
  upgradesList: "upgrades:list",
  runGet: "run:get",
  mapsList: "maps:list",
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
  upgrades: {
    list: (saveId) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.upgradesList,
        saveId,
      ) as Promise<
        DesktopOperationResult<PlayerUpgradeDto[]>
      >,
  },
  run: {
    get: (saveId) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.runGet,
        saveId,
      ) as Promise<
        DesktopOperationResult<RunStateDto>
      >,
  },
  maps: {
    list: () =>
      ipcRenderer.invoke(
        IPC_CHANNELS.mapsList,
      ) as Promise<
        DesktopOperationResult<InstalledMapsDto>
      >,
  },
};

contextBridge.exposeInMainWorld(
  "repoditor",
  repoditorApi,
);
