/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it } from "vitest";

import { rechargeAllSupportedItems } from "@/features/recharge/recharge";
import { getRunPendingEdits } from "@/features/run-save/pendingEdits";
import {
  RunEditError,
  type ResumeLocation,
  setPlayerHealth,
  setResumeLocation,
  setRunLevel,
} from "@/features/run-save/runSave";
import { encryptEs3 } from "@/features/save-file/es3";
import { prepareVerifiedExport } from "@/features/save-file/export";
import { loadSaveBytes } from "@/features/save-file/pipeline";
import { parseSaveJson, serializeSaveJson } from "@/features/save-file/serialization";
import {
  createEditSession,
  hasPendingChanges,
  type EditSession,
} from "@/features/save-file/session";

interface RunCompatibilityFixture {
  readonly runSave: { dictionaryOfDictionaries: { value: Record<string, unknown> } };
  readonly healthCases: readonly {
    readonly name: string;
    readonly after: unknown;
    readonly accepted: boolean;
    readonly overrides?: Record<string, unknown>;
    readonly remove?: string;
  }[];
  readonly resumeCases: readonly {
    readonly choice: ResumeLocation;
    readonly before: number;
    readonly after: number;
  }[];
  readonly refill: { readonly expectedCharges: Record<string, number> };
}

const fixture = JSON.parse(
  readFileSync(resolve("..", "compatibility", "es3", "run-mutations.json"), "utf8"),
) as RunCompatibilityFixture;

async function openEncrypted(source: unknown): Promise<EditSession> {
  const encrypted = await encryptEs3(new TextEncoder().encode(JSON.stringify(source)));
  return createEditSession(await loadSaveBytes(encrypted, "REPO_SAVE.es3"));
}

async function expectVerifiedExport(session: EditSession, expected: unknown): Promise<void> {
  const output = await prepareVerifiedExport(session);
  const reopened = await loadSaveBytes(
    new Uint8Array(await output.blob.arrayBuffer()),
    output.fileName,
  );
  expect(reopened.data).toEqual(parseSaveJson(JSON.stringify(expected)));
}

it.each(fixture.healthCases)("shared Health case: $name", async (testCase) => {
  const expected = structuredClone(fixture.runSave);
  const fields = expected.dictionaryOfDictionaries.value;
  Object.assign(fields, structuredClone(testCase.overrides ?? {}));
  if (testCase.remove) Reflect.deleteProperty(fields, testCase.remove);
  const session = await openEncrypted(expected);

  if (!testCase.accepted) {
    expect(() => setPlayerHealth(session.working, "111", testCase.after)).toThrow(RunEditError);
    expect(serializeSaveJson(session.working)).toBe(session.baselineSource);
    return;
  }

  setPlayerHealth(session.working, "111", testCase.after);
  fields.playerHealth = {
    ...(fields.playerHealth as Record<string, unknown>),
    "111": testCase.after,
  };
  await expectVerifiedExport(session, expected);
});

it.each([
  ["revert missing Level", undefined, [5, 1], undefined, []],
  ["edit missing Level", undefined, [5], 4, ["run:level"]],
  ["revert stored Level", 4, [7, 5], 4, []],
  ["revert explicitly stored zero", 0, [5, 1], 0, []],
] as const)(
  "reopens the expected encrypted Level field after %s",
  async (_, before, edits, after, pending) => {
    const expected = structuredClone(fixture.runSave);
    const stats = expected.dictionaryOfDictionaries.value.runStats as { level?: number };
    if (before === undefined) Reflect.deleteProperty(stats, "level");
    else stats.level = before;
    const session = await openEncrypted(expected);

    for (const displayed of edits) setRunLevel(session, displayed);
    expect(getRunPendingEdits(session).map(({ id }) => id)).toEqual(pending);
    expect(hasPendingChanges(session)).toBe(pending.length > 0);

    if (after === undefined) Reflect.deleteProperty(stats, "level");
    else stats.level = after;
    await expectVerifiedExport(session, expected);
  },
);

it("keeps Level absent when only Resume Location remains pending", async () => {
  const expected = structuredClone(fixture.runSave);
  const stats = expected.dictionaryOfDictionaries.value.runStats as Record<string, unknown>;
  Reflect.deleteProperty(stats, "level");
  const session = await openEncrypted(expected);

  setResumeLocation(session.working, "shop");
  stats["save level"] = 1;
  await expectVerifiedExport(session, expected);

  setRunLevel(session, 5);
  setRunLevel(session, 1);
  expect(getRunPendingEdits(session).map(({ id }) => id)).toEqual(["run:resume-location"]);
  await expectVerifiedExport(session, expected);
});

it.each(fixture.resumeCases)(
  "preserves unrelated encrypted fields when resuming at $choice",
  async (resume) => {
    const expected = structuredClone(fixture.runSave);
    const fields = expected.dictionaryOfDictionaries.value;
    const stats = fields.runStats as Record<string, unknown>;
    stats["save level"] = resume.before;
    const session = await openEncrypted(expected);

    setPlayerHealth(session.working, "111", 120);
    setResumeLocation(session.working, resume.choice);
    expect(rechargeAllSupportedItems(session.working)).toBe(true);

    (fields.playerHealth as Record<string, unknown>)["111"] = 120;
    stats["save level"] = resume.after;
    fields.itemStatBattery = fixture.refill.expectedCharges;
    await expectVerifiedExport(session, expected);
  },
);
