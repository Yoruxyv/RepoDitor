import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const themeCss = readFileSync(path.join(desktopRoot, "src", "styles", "theme.css"), "utf8");
const mainSource = readFileSync(path.join(desktopRoot, "electron", "main.cts"), "utf8");
const indexHtml = readFileSync(path.join(desktopRoot, "index.html"), "utf8");
const textTokens = ["ink", "secondary", "muted", "accent", "success", "warning", "danger"];
const surfaceTokens = ["app", "surface", "surface-raised"];

function themeBlock(selector) {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]+)}`).exec(themeCss);
  assert.ok(match, `Missing theme block: ${selector}`);
  return match[1];
}

function token(block, name) {
  const match = new RegExp(`--theme-${name}:\\s*(#[0-9a-f]{6})`, "i").exec(block);
  assert.ok(match, `Missing hexadecimal theme token: ${name}`);
  return match[1];
}

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi);
  assert.ok(channels, `Invalid color: ${hex}`);
  const [red, green, blue] = channels.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

for (const selector of [":root", ':root[data-theme="light"]']) {
  const block = themeBlock(selector);

  test(`${selector} normal text meets WCAG AA on application surfaces`, () => {
    for (const foreground of textTokens) {
      for (const background of surfaceTokens) {
        assert.ok(
          contrast(token(block, foreground), token(block, background)) >= 4.5,
          `${foreground} on ${background} is below 4.5:1`,
        );
      }
    }
  });

  test(`${selector} control and focus boundaries remain distinguishable`, () => {
    for (const foreground of ["control-border", "focus"]) {
      for (const background of surfaceTokens) {
        assert.ok(
          contrast(token(block, foreground), token(block, background)) >= 3,
          `${foreground} on ${background} is below 3:1`,
        );
      }
    }
  });
}

test("shared interaction feedback has no hover rotation or scale", () => {
  assert.doesNotMatch(themeCss, /:hover\s*\{[^}]*(?:rotate|scale)/s);
  assert.match(themeCss, /:active\s*\{[^}]*translate3d\(0, 1px, 0\)/s);
});

test("reduced motion removes spatial transforms", () => {
  assert.match(
    themeCss,
    /prefers-reduced-motion:\s*reduce[\s\S]*?\.ui-feedback\s*\{[^}]*transform:\s*none\s*!important/s,
  );
});

test("asset preparation motion is opt-in and reduced-motion safe", () => {
  assert.match(
    themeCss,
    /prefers-reduced-motion:\s*no-preference[\s\S]*?\.asset-preparation-crate\s*\{[^}]*animation:/s,
  );
  assert.match(
    themeCss,
    /prefers-reduced-motion:\s*reduce[\s\S]*?animation-duration:\s*0\.01ms\s*!important/s,
  );
});


test("startup prepaint matches the authoritative dark application surface", () => {
  const startupBackground = token(themeBlock(":root"), "app");
  assert.equal(startupBackground.toLowerCase(), "#0d1110");
  assert.match(mainSource, /backgroundColor:\s*"#0d1110"/);
  assert.match(indexHtml, /background:\s*#0d1110/);
});
