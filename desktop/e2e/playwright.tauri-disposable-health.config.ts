import { randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";

// This opt-in journey uses a private encrypted snapshot. Keep browser recordings off.
export default defineConfig({
  testDir: "./tauri",
  testMatch: "tauri-disposable-health.spec.ts",
  outputDir: `../build/recovery-checkpoint/disposable-health-${randomUUID()}`,
  timeout: 75_000,
  retries: 0,
  workers: 1,
  reporter: "line",
  use: { trace: "off", screenshot: "off", video: "off" },
});
