import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@electron": fileURLToPath(new URL("./electron", import.meta.url)),
    },
  },
});
