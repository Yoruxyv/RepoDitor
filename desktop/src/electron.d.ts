import type { RepoDitorApi } from "../electron/contracts.cts";

export {};

declare global {
  interface Window {
    repoditor: RepoDitorApi;
  }
}
