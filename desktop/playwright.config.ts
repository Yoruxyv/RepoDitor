import { defineConfig } from "@playwright/test";

const packagedExecutable = process.env.REPODITOR_E2E_EXECUTABLE;

export default defineConfig({
  outputDir: "test-results",
  testDir: "./e2e",
  timeout: 45_000,
  workers: 1,
  reporter: "line",
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: packagedExecutable
    ? undefined
    : {
        command: "npm run dev:renderer -- --host 127.0.0.1",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: false,
        timeout: 30_000,
      },
});
