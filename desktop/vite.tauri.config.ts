import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";
import config from "./vite.config.ts";

export default mergeConfig(config, {
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  build: {
    outDir: "build/tauri-ui",
    rolldownOptions: { input: fileURLToPath(new URL("./tauri.html", import.meta.url)) },
  },
});
