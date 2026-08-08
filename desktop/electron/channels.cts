import type { IpcChannelMap } from "./contracts.cjs";

export const IPC_CHANNELS: IpcChannelMap = {
  appPing: "app:ping",
  environmentDetect: "environment:detect",
  savesList: "saves:list",
} as const;
