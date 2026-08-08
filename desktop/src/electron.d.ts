import type { RepoDitorApi } from "@electron/contracts";

export {};

declare global {
  interface Window {
    repoditor: RepoDitorApi;
  }
}
