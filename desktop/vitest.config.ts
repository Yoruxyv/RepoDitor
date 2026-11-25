import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  cacheDir: ".vite-cache",
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./renderer", import.meta.url)),
    },
  },
  test: {
    // Limit Windows filesystem contention between jsdom and native I/O tests.
    maxWorkers: process.platform === "win32" ? 2 : undefined,
    environment: "jsdom",
    setupFiles: ["./renderer/test/setup.ts"],
    include: [
      "renderer/**/*.test.{ts,tsx}",
      "e2e/support/**/*.test.ts",
      "installer/ui/src/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "html", "lcov"],
    },
  },
});
