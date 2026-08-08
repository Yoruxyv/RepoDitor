import type { IpcChannelMap } from "./contracts.cjs";

export const IPC_CHANNELS: IpcChannelMap = {
  environmentDetect: "environment:detect",
  savesList: "saves:list",
  savesOpen: "saves:open",
  playersList: "players:list",
  playersAvatar: "players:avatar",
} as const;
