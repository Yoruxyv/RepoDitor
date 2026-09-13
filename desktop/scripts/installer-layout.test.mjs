import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const buildRoot = fileURLToPath(new URL("../build/installer-ui/", import.meta.url));
const origin = "https://repoditor-installer.local";
const contentTypes = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

test("production installer stays centered and capped at minimum, normal and maximized sizes", async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  });
  try {
    for (const mode of ["install", "uninstall"]) {
      const page = await browser.newPage();
      await page.route(`${origin}/**`, async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        const file = path.resolve(buildRoot, `.${pathname === "/" ? "/index.html" : pathname}`);
        assert.ok(file.startsWith(buildRoot), "Only production installer assets may be served");
        await route.fulfill({
          body: await readFile(file),
          contentType: contentTypes[path.extname(file)] ?? "application/octet-stream",
        });
      });
      await page.addInitScript(
        ({ mode }) => {
          const messages = new EventTarget();
          window.chrome = {
            webview: {
              postMessage(command) {
                if (command === "ready") {
                  messages.dispatchEvent(
                    new MessageEvent("message", {
                      data: {
                        type: "initialize",
                        mode,
                        version: "0.2.1",
                        updated: false,
                        scope: "current",
                        scopeLocked: false,
                        showScope: true,
                        path: "C:\\A long parent folder with spaces\\RepoDitor",
                      },
                    }),
                  );
                }
              },
              addEventListener: messages.addEventListener.bind(messages),
              removeEventListener: messages.removeEventListener.bind(messages),
            },
          };
          const session = "0123456789abcdef0123456789abcdef";
          window.sendInstallerProgress = (percentage) =>
            messages.dispatchEvent(
              new MessageEvent("message", {
                data: { type: "progress", session, attempt: 1, percentage },
              }),
            );
          window.sendInstallerState = (state) =>
            messages.dispatchEvent(
              new MessageEvent("message", {
                data: {
                  type: "state",
                  state,
                  message: "",
                  ...(mode === "install" ? { session } : {}),
                },
              }),
            );
        },
        { mode },
      );
      await page.goto(`${origin}/index.html`);
      await page
        .getByRole("button", { name: mode === "install" ? "Install" : "Uninstall", exact: true })
        .waitFor();
      for (const state of ["ready", "preparing", "installing", "finalizing", "failure"]) {
        if (state !== "ready") {
          await page.evaluate((state) => window.sendInstallerState(state), state);
          await page.locator(state === "failure" ? ".state-done" : ".state-progress").waitFor();
          if (mode === "install" && state === "installing") {
            await page.evaluate(() => window.sendInstallerProgress(53));
            await page.getByText("53%", { exact: true }).waitFor();
          }
        }
        for (const [width, height] of [
          [960, 640],
          [1216, 800],
          [1600, 900],
          [1920, 1080],
          [3840, 2160],
        ]) {
          await page.setViewportSize({ width, height });
          const box = await page.locator(".window").boundingBox();
          assert.ok(box);
          assert.ok(
            Math.abs(box.x + box.width / 2 - width / 2) <= 1,
            `${mode}/${state}/${width}: horizontal center ${JSON.stringify(box)}`,
          );
          assert.ok(
            Math.abs(box.y + box.height / 2 - height / 2) <= 1,
            `${mode}/${state}/${width}: vertical center ${JSON.stringify(box)}`,
          );
          assert.equal(box.width, Math.min(1160, width - 56));
          assert.ok(
            Math.abs(box.height - Math.max(580, (box.width * 9) / 16)) <= 1,
            "Approved card proportions remain unchanged",
          );
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
          assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), height);
          if (mode === "uninstall") assert.equal(await page.getByRole("progressbar").count(), 0);
          if (mode === "install" && ["preparing", "installing", "finalizing"].includes(state)) {
            const bar = page.getByRole("progressbar");
            assert.equal(await bar.getAttribute("value"), state === "preparing" ? "0" : "53");
            assert.equal(
              await bar.evaluate((element) => getComputedStyle(element).animationName),
              "none",
            );
            const row = await page.locator(".progress-row").boundingBox();
            const track = await page.locator(".progress-track").boundingBox();
            const label = await page.locator(".progress-percentage").boundingBox();
            assert.ok(row && track && label && track.x + track.width < label.x);
            assert.ok(label.x + label.width <= row.x + row.width + 1);
          }
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
