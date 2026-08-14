import {
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent,
} from "electron";

import {
  type AdvancedSaveDto,
  type AssetPreparationState,
  type CosmeticChange,
  type CosmeticsViewDto,
  type CosmeticsWriteResult,
  type DesktopOperationResult,
  type EnvironmentDiscovery,
  type GameProcessState,
  type InstalledMapsDto,
  type IpcChannelMap,
  type PlayerAvatar,
  type PlayerDto,
  type PlayerUpgradeDto,
  type ProjectMetadata,
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
  projectMetadata: "project:metadata",
  gameStatus: "game:status",
  assetPreparationState: "assets:state",
  assetPreparationProgress: "assets:progress",
  savesList: "saves:list",
  savesOpen: "saves:open",
  savesWrite: "saves:write",
  playersList: "players:list",
  playersAvatar: "players:avatar",
  upgradesList: "upgrades:list",
  runGet: "run:get",
  advancedGet: "advanced:get",
  cosmeticsGet: "cosmetics:get",
  cosmeticsWrite: "cosmetics:write",
  mapsList: "maps:list",
};

const repoditorApi: RepoDitorApi = {
  project: {
    metadata: () =>
      ipcRenderer.invoke(
        IPC_CHANNELS.projectMetadata,
      ) as Promise<
        DesktopOperationResult<ProjectMetadata>
      >,
  },
  environment: {
    detect: () =>
      ipcRenderer.invoke(
        IPC_CHANNELS.environmentDetect,
      ) as Promise<
        DesktopOperationResult<EnvironmentDiscovery>
      >,
  },
  game: {
    status: () =>
      ipcRenderer.invoke(
        IPC_CHANNELS.gameStatus,
      ) as Promise<
        DesktopOperationResult<GameProcessState>
      >,
  },
  assets: {
    state: () =>
      ipcRenderer.invoke(IPC_CHANNELS.assetPreparationState) as Promise<AssetPreparationState>,
    onState: (listener) => {
      const handler = (_event: IpcRendererEvent, state: AssetPreparationState) => {
        listener(state);
      };
      ipcRenderer.on(IPC_CHANNELS.assetPreparationProgress, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.assetPreparationProgress, handler);
      };
    },
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
  cosmetics: {
    get: () =>
      ipcRenderer.invoke(
        IPC_CHANNELS.cosmeticsGet,
      ) as Promise<
        DesktopOperationResult<CosmeticsViewDto>
      >,
    write: (fingerprint, changes: CosmeticChange[]) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.cosmeticsWrite,
        fingerprint,
        changes,
      ) as Promise<
        DesktopOperationResult<CosmeticsWriteResult>
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
