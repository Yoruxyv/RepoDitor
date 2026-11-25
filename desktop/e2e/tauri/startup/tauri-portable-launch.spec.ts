import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

import {
  createMetaSaveFixture,
  createRunSaveFixture,
  DESKTOP_ROOT,
} from "../../support/fixtures/fixtureEnvironment";
import {
  verifyPackagedProductionAuthority,
  verifyPackagedProductionLaunch,
} from "../../support/harness/tauriHarness";

async function sha256(file: string) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

test("untouched portable production host launches and enforces authority", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const profile = info.outputPath("portable-production");
  await mkdir(profile, { recursive: true });
  const run = await createRunSaveFixture(profile);
  const meta = createMetaSaveFixture(profile);
  const before = await Promise.all([run, meta].map(sha256));
  const executable = path.resolve(
    DESKTOP_ROOT,
    process.env.REPODITOR_PRODUCTION_EXECUTABLE ?? "build/tauri-portable/RepoDitor.exe",
  );
  await verifyPackagedProductionAuthority(executable, profile, {
    expectedAuthority: "read-only",
    runSavePath: run,
    metaSavePath: meta,
  });
  await verifyPackagedProductionLaunch(executable, profile);
  expect(await Promise.all([run, meta].map(sha256))).toEqual(before);
});
