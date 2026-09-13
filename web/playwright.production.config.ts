import { defineConfig } from "@playwright/test";

import config from "./playwright.config";

const { webServer: _webServer, ...productionConfig } = config;

export default defineConfig({
  ...productionConfig,
  testMatch: "public-launch.spec.ts",
  use: { ...config.use, baseURL: "https://repoditor.vercel.app/" },
});
