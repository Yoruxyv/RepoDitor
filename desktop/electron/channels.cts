import type { IpcChannelMap } from "./contracts.cjs";

export const IPC_CHANNELS: IpcChannelMap = {
  environmentDetect: "environment:detect",
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
} as const;
