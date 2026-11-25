import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { capabilitySignature } from "./scripts/capability-signature.ts";
import { localAvatarEndpoint } from "./scripts/local-avatar-endpoint.ts";

export default defineConfig({
  build: { sourcemap: false },
  cacheDir: ".vite-cache",
  plugins: [
    react(),
    tailwindcss(),
    localAvatarEndpoint(),
    {
      name: "repoditor-capability-signature",
      transformIndexHtml: () => [
        { tag: "meta", attrs: { name: "repoditor-capabilities", content: capabilitySignature } },
      ],
    },
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["api/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
