import { defineConfig } from "@playwright/test";
import safety from "./playwright.tauri-safety.config.ts";

export default defineConfig(safety, { testMatch: "tauri-startup-comparison.spec.ts" });
