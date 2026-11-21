import { defineConfig } from "@playwright/test";

const packagedExecutable = process.env.REPODITOR_E2E_EXECUTABLE;

export default defineConfig({
  outputDir: "test-results",
  testDir: "./e2e",
  timeout: packagedExecutable ? 75_000 : 45_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "line",
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
