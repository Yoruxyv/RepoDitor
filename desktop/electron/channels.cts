/**
 * Canonical IPC channel allowlist shared by Electron main and preload.
 *
 * Adding a capability still requires a narrow contract, main-process runtime
 * validation, and an explicit preload method; renderers never receive generic invoke.
 */
import type { IpcChannelMap } from "./contracts.cjs";

export const IPC_CHANNELS: IpcChannelMap = {
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
  upgradesPrepareEntry: "upgrades:prepare-entry",
  runGet: "run:get",
  advancedGet: "advanced:get",
  cosmeticsGet: "cosmetics:get",
  cosmeticsWrite: "cosmetics:write",
  mapsList: "maps:list",
} as const;
