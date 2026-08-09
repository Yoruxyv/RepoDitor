import {
  contextBridge,
  ipcRenderer,
} from "electron";

import {
  type AdvancedSaveDto,
  type DesktopOperationResult,
  type EnvironmentDiscovery,
  type InstalledMapsDto,
  type IpcChannelMap,
  type PlayerAvatar,
  type PlayerDto,
  type PlayerUpgradeDto,
  type RepoDitorApi,
  type RunStateDto,
  type SaveChange,
  type SaveSession,
  type SaveSummary,
  type SaveWriteResult,
} from "./contracts.cjs";

// Sandboxed preload scripts cannot require local runtime modules.
// The literal map type keeps these approved channels aligned with main.
const IPC_CHANNELS: IpcChannelMap = {
  environmentDetect: "environment:detect",
  savesList: "saves:list",
  savesOpen: "saves:open",
  savesWrite: "saves:write",
  playersList: "players:list",
  playersAvatar: "players:avatar",
  upgradesList: "upgrades:list",
  runGet: "run:get",
  advancedGet: "advanced:get",
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
    write: (saveId, fingerprint, changes: SaveChange[]) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.savesWrite,
        saveId,
        fingerprint,
        changes,
      ) as Promise<
        DesktopOperationResult<SaveWriteResult>
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
  advanced: {
    get: (saveId) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.advancedGet,
        saveId,
      ) as Promise<
        DesktopOperationResult<AdvancedSaveDto>
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
