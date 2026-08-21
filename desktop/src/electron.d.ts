/** Renderer view of the single typed API intentionally exposed by preload. */
import type { RepoDitorApi } from "@electron/contracts";

export {};

declare global {
  const __APP_VERSION__: string;

  interface Window {
    repoditor: RepoDitorApi;
  }
}
