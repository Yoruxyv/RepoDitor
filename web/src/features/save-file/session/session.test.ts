import { LosslessNumber } from "lossless-json";
import { describe, expect, it } from "vitest";

import type { LoadedSave, SaveKind } from "@/features/save-file/processing/pipeline";
import {
  createEditSession,
  hasPendingChanges,
  resetEditSession,
} from "@/features/save-file/session/session";
import {
  isSaveNumber,
  parseSaveJson,
  SaveSerializationError,
  type SaveObject,
} from "@/features/save-file/processing/serialization";

const RUN_SOURCE =
  '{"playerNames":{"value":{"111":"Alpha"}},' +
  '"dictionaryOfDictionaries":{"value":{"runStats":{"currency":12}}},' +
  '"unknown":{"large":90071992547409931234567890,"decimal":2.370,"label":"keep"}}';

function loaded(source = RUN_SOURCE, kind: SaveKind = "run"): LoadedSave {
  return { data: parseSaveJson(source), fileName: "REPO_SAVE.es3", kind };
}

function unknown(data: SaveObject): SaveObject {
  return data.unknown as SaveObject;
}

describe("save edit session", () => {
  it("starts clean with independent baseline and working representations", () => {
    const save = loaded();
    const session = createEditSession(save);

    expect(hasPendingChanges(session)).toBe(false);
    expect(session.working).not.toBe(save.data);
    expect(unknown(session.working)).not.toBe(unknown(save.data));

    unknown(session.working).label = "changed";
    expect(unknown(save.data).label).toBe("keep");
    expect(session.baselineSource).toContain('"label": "keep"');
    expect(hasPendingChanges(session)).toBe(true);
  });

  it("becomes clean when a controlled value returns to its baseline", () => {
    const session = createEditSession(loaded());

    unknown(session.working).label = "changed";
    expect(hasPendingChanges(session)).toBe(true);
    unknown(session.working).label = "keep";
    expect(hasPendingChanges(session)).toBe(false);
  });

  it("reconstructs the working state when changes are discarded", () => {
    const session = createEditSession(loaded());
    const previousWorking = session.working;
    unknown(session.working).label = "changed";

    const reset = resetEditSession(session);

    expect(reset.working).not.toBe(previousWorking);
    expect(unknown(reset.working).label).toBe("keep");
    expect(hasPendingChanges(reset)).toBe(false);
  });

  it("preserves unknown fields and lossless numeric lexemes during reconstruction", () => {
    const reset = resetEditSession(createEditSession(loaded()));
    const data = unknown(reset.working);

    expect(isSaveNumber(data.large) && data.large.value).toBe("90071992547409931234567890");
    expect(isSaveNumber(data.decimal) && data.decimal.value).toBe("2.370");
    expect(data.label).toBe("keep");
  });

  it("fails closed when working data cannot be serialized safely", () => {
    const session = createEditSession(loaded());
    const invalidNumber = new LosslessNumber("1");
    invalidNumber.value = "[object Object]";
    unknown(session.working).invalid = invalidNumber;

    expect(() => hasPendingChanges(session)).toThrow(SaveSerializationError);
  });
});
