import { defineConfig } from "@playwright/test";

if (!process.env.REPODITOR_NATIVE_OUTPUT || !process.env.REPODITOR_NATIVE_REPORT) {
  throw new Error(
    "Use npm run test:tauri-safety to prepare the native artifacts and isolated outputs.",
  );
}

export default defineConfig({
  testDir: "./e2e/tauri",
  testMatch: [
    "tauri-startup.spec.ts",
    "tauri-recovery.spec.ts",
    "tauri-safety.spec.ts",
    "tauri-upgrade-drafts.spec.ts",
    "tauri-run-editing.spec.ts",
    "tauri-health-batches.spec.ts",
    "tauri-items-refill.spec.ts",
  ],
  outputDir: process.env.REPODITOR_NATIVE_OUTPUT,
  timeout: 75_000,
  retries: 0,
  workers: 1,
  reporter: [["line"], ["json", { outputFile: process.env.REPODITOR_NATIVE_REPORT }]],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
});
