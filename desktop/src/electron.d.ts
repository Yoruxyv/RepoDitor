import type { RepoDitorApi } from "@electron/contracts";

export {};

declare global {
  const __APP_VERSION__: string;

  interface Window {
    repoditor: RepoDitorApi;
  }
}
