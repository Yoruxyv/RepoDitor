import { describe, expect, it } from "vitest";

import { decryptEs3 } from "@/features/save-file/es3";
import { prepareVerifiedExport } from "@/features/save-file/export";
import { loadSaveBytes, type LoadedSave } from "@/features/save-file/pipeline";
import {
  createEditSession,
  hasPendingChanges,
  resetEditSession,
  type EditSession,
} from "@/features/save-file/session";
import { isSaveNumber, parseSaveJson } from "@/features/save-file/serialization";
import {
  DISPLAY_LEVEL_MAX,
  inspectRunSave,
  RunEditError,
  SAVE_INT32_MAX,
  SAVE_INT32_MIN,
  setCurrency,
  setPlayerHealth,
  setPlayerUpgrade,
  setResumeLocation,
  setRunLevel,
} from "@/features/run-save/runSave";

const RUN_SOURCE =
  '{"playerNames":{"value":{"111":"Alpha","222":"Beta"}},' +
  '"dictionaryOfDictionaries":{"value":{' +
  '"runStats":{"currency":12,"level":0,"save level":0},' +
  '"playerHealth":{"111":80},' +
  '"playerUpgradeHealth":{"111":1},' +
  '"playerUpgradePocketcartKeepItems":{"111":4},' +
  '"playerUpgradeStrength":{"111":2},' +
  '"playerUpgradeBroken":7}},' +
  '"unknown":{"decimal":2.370,"large":90071992547409931234567890}}';

function session(source = RUN_SOURCE): EditSession {
  const save: LoadedSave = {
    data: parseSaveJson(source),
    fileName: "REPO_SAVE.es3",
    kind: "run",
  };
  return createEditSession(save);
}

function storedValue(editSession: EditSession, dictionary: string, key: string): unknown {
  const dictionaries = (editSession.working.dictionaryOfDictionaries as Record<string, unknown>)
    .value as Record<string, Record<string, unknown>>;
  return dictionaries[dictionary]?.[key];
}

describe("Run save inspection", () => {
  it("inspects players, current health, existing upgrades, currency, and resume location", () => {
    const state = inspectRunSave(session().working);

    expect(state.players).toEqual([
      { health: 80, id: "111", name: "Alpha" },
      { health: 0, id: "222", name: "Beta" },
    ]);
    expect(state.upgrades.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: "playerUpgradeHealth", label: "Health" },
      { key: "playerUpgradePocketcartKeepItems", label: "Pocketcart Keep Items" },
      { key: "playerUpgradeStrength", label: "Strength" },
    ]);
    expect(state.upgrades[0]?.values.get("111")).toBe(1);
    expect(state.upgrades[2]?.values.get("222")).toBe(0);
    expect(state.currency).toBe(12);
    expect(state.level).toBe(1);
    expect(state.resumeLocation).toBe("normal");
    expect(state.resumeValue).toBe(0);
  });

  it("displays stored level 4 as the one-based run level 5", () => {
    const editSession = session();
    const stored = storedValue(editSession, "runStats", "level");
    if (!isSaveNumber(stored)) {
      throw new Error("Expected a numeric fixture level.");
    }
    stored.value = "4";

    expect(inspectRunSave(editSession.working).level).toBe(5);
  });
});

describe("Run save mutations", () => {
  it("stages supported edits without changing the immutable baseline", () => {
    const editSession = session();
    const baseline = editSession.baselineSource;

    setPlayerHealth(editSession.working, "111", 95);
    setPlayerUpgrade(editSession.working, "111", "playerUpgradeStrength", 3);
    setCurrency(editSession.working, -20);
    setRunLevel(editSession, 5);
    setResumeLocation(editSession.working, "shop");

    const state = inspectRunSave(editSession.working);
    expect(state.players[0]?.health).toBe(95);
    expect(
      state.upgrades.find(({ key }) => key === "playerUpgradeStrength")?.values.get("111"),
    ).toBe(3);
    expect(state.currency).toBe(-20);
    expect(state.level).toBe(5);
    expect(state.resumeLocation).toBe("shop");
    expect(editSession.baselineSource).toBe(baseline);
    expect(hasPendingChanges(editSession)).toBe(true);
    expect(isSaveNumber(storedValue(editSession, "playerHealth", "111"))).toBe(true);
    expect(isSaveNumber(storedValue(editSession, "runStats", "currency"))).toBe(true);

    const reset = resetEditSession(editSession);
    expect(inspectRunSave(reset.working).players[0]?.health).toBe(80);
    expect(inspectRunSave(reset.working).level).toBe(1);
    expect(hasPendingChanges(reset)).toBe(false);
  });

  it.each([-1, SAVE_INT32_MAX + 1, true, 1.5, "1", null])(
    "rejects an invalid health value without mutation: %j",
    (value) => {
      const editSession = session();
      expect(() => setPlayerHealth(editSession.working, "111", value)).toThrow(RunEditError);
      expect(inspectRunSave(editSession.working).players[0]?.health).toBe(80);
      expect(hasPendingChanges(editSession)).toBe(false);
    },
  );

  it.each([-1, SAVE_INT32_MAX + 1, true, 1.5, "1", null])(
    "rejects an invalid upgrade value without mutation: %j",
    (value) => {
      const editSession = session();
      expect(() =>
        setPlayerUpgrade(editSession.working, "111", "playerUpgradeStrength", value),
      ).toThrow(RunEditError);
      expect(
        inspectRunSave(editSession.working)
          .upgrades.find(({ key }) => key === "playerUpgradeStrength")
          ?.values.get("111"),
      ).toBe(2);
      expect(hasPendingChanges(editSession)).toBe(false);
    },
  );

  it.each([SAVE_INT32_MIN - 1, SAVE_INT32_MAX + 1, true, 1.5, "1", null])(
    "rejects an invalid currency value without mutation: %j",
    (value) => {
      const editSession = session();
      expect(() => setCurrency(editSession.working, value)).toThrow(RunEditError);
      expect(inspectRunSave(editSession.working).currency).toBe(12);
      expect(hasPendingChanges(editSession)).toBe(false);
    },
  );

  it.each([0, DISPLAY_LEVEL_MAX + 1, true, 1.5, "5", null])(
    "rejects an invalid displayed run level without mutation: %j",
    (value) => {
      const editSession = session();
      expect(() => setRunLevel(editSession, value)).toThrow(RunEditError);
      expect(inspectRunSave(editSession.working).level).toBe(1);
      expect(hasPendingChanges(editSession)).toBe(false);
    },
  );

  it("converts inclusive displayed run-level boundaries to stored values", () => {
    const editSession = session();

    setRunLevel(editSession, 1);
    const minimum = storedValue(editSession, "runStats", "level");
    expect(isSaveNumber(minimum) && minimum.value).toBe("0");

    setRunLevel(editSession, DISPLAY_LEVEL_MAX);
    const maximum = storedValue(editSession, "runStats", "level");
    expect(isSaveNumber(maximum) && maximum.value).toBe(String(SAVE_INT32_MAX));
  });

  it("defaults a missing level to 1 and adds the field only on an explicit level edit", () => {
    const editSession = session(RUN_SOURCE.replace(',"level":0', ""));
    const dictionaries = (editSession.working.dictionaryOfDictionaries as Record<string, unknown>)
      .value as Record<string, Record<string, unknown>>;

    expect(inspectRunSave(editSession.working).level).toBe(1);
    setResumeLocation(editSession.working, "shop");
    expect(Object.hasOwn(dictionaries.runStats!, "level")).toBe(false);
    setRunLevel(editSession, 5);
    expect(inspectRunSave(editSession.working).level).toBe(5);
    expect(inspectRunSave(editSession.working).resumeLocation).toBe("shop");
  });

  it("keeps run level and next spawn as independent fields", () => {
    const editSession = session();

    setRunLevel(editSession, 5);
    const storedLevel = storedValue(editSession, "runStats", "level");
    const storedResume = storedValue(editSession, "runStats", "save level");
    expect(isSaveNumber(storedLevel) && storedLevel.value).toBe("4");
    expect(isSaveNumber(storedResume) && storedResume.value).toBe("0");

    setResumeLocation(editSession.working, "shop");
    expect(isSaveNumber(storedLevel) && storedLevel.value).toBe("4");
    const updatedResume = storedValue(editSession, "runStats", "save level");
    expect(isSaveNumber(updatedResume) && updatedResume.value).toBe("1");
  });

  it("rejects unsupported resume values without mutation", () => {
    const editSession = session();

    expect(() => setResumeLocation(editSession.working, "future")).toThrow(RunEditError);
    expect(inspectRunSave(editSession.working).resumeLocation).toBe("normal");
    expect(hasPendingChanges(editSession)).toBe(false);
  });

  it("does not invent absent upgrade dictionaries", () => {
    const editSession = session();

    expect(() => setPlayerUpgrade(editSession.working, "111", "playerUpgradeFuture", 1)).toThrow(
      /not present/iu,
    );
    expect(storedValue(editSession, "playerUpgradeFuture", "111")).toBeUndefined();
    expect(hasPendingChanges(editSession)).toBe(false);
  });

  it("can add a missing player value only inside an existing upgrade dictionary", () => {
    const editSession = session();

    setPlayerUpgrade(editSession.working, "222", "playerUpgradeStrength", 4);

    expect(
      inspectRunSave(editSession.working)
        .upgrades.find(({ key }) => key === "playerUpgradeStrength")
        ?.values.get("222"),
    ).toBe(4);
    expect(isSaveNumber(storedValue(editSession, "playerUpgradeStrength", "222"))).toBe(true);
  });

  it("accepts the proven inclusive integer boundaries", () => {
    const editSession = session();
    setPlayerUpgrade(editSession.working, "111", "playerUpgradeHealth", SAVE_INT32_MAX);

    setPlayerHealth(editSession.working, "111", SAVE_INT32_MAX);
    setPlayerUpgrade(editSession.working, "111", "playerUpgradeStrength", SAVE_INT32_MAX);
    setCurrency(editSession.working, SAVE_INT32_MIN);

    const state = inspectRunSave(editSession.working);
    expect(state.players[0]?.health).toBe(SAVE_INT32_MAX);
    expect(
      state.upgrades.find(({ key }) => key === "playerUpgradeStrength")?.values.get("111"),
    ).toBe(SAVE_INT32_MAX);
    expect(state.currency).toBe(SAVE_INT32_MIN);

    setCurrency(editSession.working, SAVE_INT32_MAX);
    expect(inspectRunSave(editSession.working).currency).toBe(SAVE_INT32_MAX);
  });

  it("rejects malformed existing scalar values before overwriting them", () => {
    const editSession = session();
    const value = storedValue(editSession, "playerUpgradeStrength", "111");
    if (!isSaveNumber(value)) {
      throw new Error("Expected a numeric fixture value.");
    }
    value.value = "2.0";

    expect(() => setPlayerUpgrade(editSession.working, "111", "playerUpgradeStrength", 3)).toThrow(
      /not stored as an integer/iu,
    );
    expect(value.value).toBe("2.0");
  });
});

describe("Run save export interoperability", () => {
  it("blocks an edited Health value above the final upgrade cap until the draft is corrected", async () => {
    const editSession = session();
    setPlayerHealth(editSession.working, "111", 120);
    setPlayerUpgrade(editSession.working, "111", "playerUpgradeHealth", 0);
    await expect(prepareVerifiedExport(editSession)).rejects.toMatchObject({ maximum: 100 });
    expect(inspectRunSave(editSession.working).players[0]?.health).toBe(120);

    setPlayerHealth(editSession.working, "111", 100);
    await expect(prepareVerifiedExport(editSession)).resolves.toMatchObject({
      fileName: "REPO_SAVE.repoditor.es3",
    });
  });

  it("exports displayed run level 5 as stored level 4 without changing save level", async () => {
    const editSession = session();
    setRunLevel(editSession, 5);

    expect(hasPendingChanges(editSession)).toBe(true);
    const output = await prepareVerifiedExport(editSession);
    const reopened = createEditSession(
      await loadSaveBytes(new Uint8Array(await output.blob.arrayBuffer()), output.fileName),
    );
    const storedLevel = storedValue(reopened, "runStats", "level");
    const storedResume = storedValue(reopened, "runStats", "save level");

    expect(isSaveNumber(storedLevel) && storedLevel.value).toBe("4");
    expect(isSaveNumber(storedResume) && storedResume.value).toBe("0");
    expect(inspectRunSave(reopened.working).level).toBe(5);
  });

  it.each([
    {
      apply: (editSession: EditSession) => setPlayerHealth(editSession.working, "111", 95),
      expected: 95,
      read: (state: ReturnType<typeof inspectRunSave>) => state.players[0]?.health,
      target: "health",
    },
    {
      apply: (editSession: EditSession) =>
        setPlayerUpgrade(editSession.working, "111", "playerUpgradeStrength", 3),
      expected: 3,
      read: (state: ReturnType<typeof inspectRunSave>) =>
        state.upgrades.find(({ key }) => key === "playerUpgradeStrength")?.values.get("111"),
      target: "upgrade",
    },
    {
      apply: (editSession: EditSession) => setCurrency(editSession.working, 50_000),
      expected: 50_000,
      read: (state: ReturnType<typeof inspectRunSave>) => state.currency,
      target: "currency",
    },
    {
      apply: (editSession: EditSession) => setRunLevel(editSession, 5),
      expected: 5,
      read: (state: ReturnType<typeof inspectRunSave>) => state.level,
      target: "run level",
    },
    {
      apply: (editSession: EditSession) => setResumeLocation(editSession.working, "shop"),
      expected: "shop",
      read: (state: ReturnType<typeof inspectRunSave>) => state.resumeLocation,
      target: "resume location",
    },
  ])("exports and reopens a staged $target edit", async ({ apply, expected, read }) => {
    const editSession = session();
    const baseline = editSession.baselineSource;
    apply(editSession);

    const output = await prepareVerifiedExport(editSession);
    const encrypted = new Uint8Array(await output.blob.arrayBuffer());
    const reopened = await loadSaveBytes(encrypted, output.fileName);
    const plaintext = new TextDecoder().decode(await decryptEs3(encrypted));

    expect(read(inspectRunSave(reopened.data))).toBe(expected);
    expect(plaintext).toContain("90071992547409931234567890");
    expect(editSession.baselineSource).toBe(baseline);
  });
});
