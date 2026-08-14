// @vitest-environment node

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildPythonArguments } = require("../../dist-electron/python/client.cjs");

describe("Python asset preparation transport", () => {
  it("keeps the bounded batch request out of process argv", () => {
    expect(buildPythonArguments("assets-prepare", [], true)).toEqual([
      "assets-prepare",
    ]);
    expect(buildPythonArguments("assets-prepare", [], false)).toEqual([
      "-m",
      "repo_save_editor.desktop_api",
      "assets-prepare",
    ]);
    expect(() =>
      buildPythonArguments(
        "assets-prepare",
        ['["playerUpgradeHealth"]'],
        true,
      )
    ).toThrow(/stdin/);
  });

  it("keeps ordinary commands on their existing argv transport", () => {
    expect(buildPythonArguments("upgrades-list", ["save-id"], true)).toEqual([
      "upgrades-list",
      "save-id",
    ]);
  });
});
