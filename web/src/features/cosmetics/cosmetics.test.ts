import { describe, expect, it } from "vitest";

import {
  CosmeticEditError,
  COSMETIC_SNAPSHOT,
  inspectMetaCosmetics,
  KNOWN_COSMETIC_IDS,
  unlockRemainingCosmetics,
} from "@/features/cosmetics/cosmetics";
import snapshot from "@/features/cosmetics/known-cosmetics.v1.json";
import { getCosmeticPendingEdits } from "@/features/cosmetics/pendingEdits";
import type { LoadedSave } from "@/features/save-file/pipeline";
import { createEditSession, resetEditSession } from "@/features/save-file/session";
import {
  isSaveNumber,
  isSaveObject,
  parseSaveJson,
  serializeSaveJson,
  type SaveObject,
} from "@/features/save-file/serialization";

const cosmeticCount = KNOWN_COSMETIC_IDS.length;

function metaSave(
  history = "[27,999]",
  unlocks = history,
  presets = "[[27],[],[999]]",
): SaveObject {
  return parseSaveJson(
    `{"cosmeticHistory":{"value":${history}},` +
      `"cosmeticUnlocks":{"value":${unlocks}},` +
      `"cosmeticPresets":{"value":${presets}},` +
      '"colorPresets":{"value":[[1,2],[]]},' +
      '"future":{"large":90071992547409931234567890}}',
  );
}

function integerLexemes(data: SaveObject, key: string): string[] {
  const entry = data[key];
  if (!isSaveObject(entry) || !Array.isArray(entry.value)) {
    throw new Error(`Expected ${key}.value to be a list.`);
  }
  return entry.value.map((item) => {
    if (!isSaveNumber(item)) {
      throw new Error(`Expected ${key}.value to contain save numbers.`);
    }
    return item.value;
  });
}

function session(data: SaveObject) {
  const loaded: LoadedSave = { data, fileName: "MetaSave.es3", kind: "meta" };
  return createEditSession(loaded);
}

describe("known cosmetic snapshot", () => {
  it("is explicit, versioned, deterministic, and duplicate-free", () => {
    expect(snapshot.snapshotVersion).toBe(1);
    expect(snapshot.gameCompatibility).toMatch(/installed MetaManager cosmeticAssets/iu);
    expect(snapshot.gameCompatibility).toMatch(/verified against UnityPy/iu);
    expect(snapshot.provenance).toBe(
      "docs/research/current-game-compatibility.md#independent-catalog-and-managed-semantics",
    );
    expect(snapshot.evidenceSha256).toMatch(/^[a-f\d]{64}$/u);
    expect(Array.isArray(snapshot.cosmeticIds)).toBe(true);
    expect(snapshot.cosmeticIds).toEqual(KNOWN_COSMETIC_IDS);
    expect(KNOWN_COSMETIC_IDS.length).toBeGreaterThan(0);
    expect(KNOWN_COSMETIC_IDS.every(Number.isSafeInteger)).toBe(true);
    expect([...KNOWN_COSMETIC_IDS].sort((left, right) => left - right)).toEqual(KNOWN_COSMETIC_IDS);
    expect(new Set(KNOWN_COSMETIC_IDS).size).toBe(KNOWN_COSMETIC_IDS.length);
    expect(Object.isFrozen(KNOWN_COSMETIC_IDS)).toBe(true);
    expect(COSMETIC_SNAPSHOT.snapshotVersion).toBe(snapshot.snapshotVersion);
  });
});

describe("MetaSave cosmetic capability", () => {
  it.each([
    ["none", "[]", 0],
    ["partial", "[0,27,999,90071992547409931234567890]", 2],
    ["all", JSON.stringify(KNOWN_COSMETIC_IDS), cosmeticCount],
  ])("counts %s known ownership without counting unknown IDs", (_label, unlocks, owned) => {
    expect(inspectMetaCosmetics(metaSave("[]", unlocks))).toEqual({
      ownedSupportedCount: owned,
      remainingSupportedCount: cosmeticCount - owned,
      totalSupportedCount: cosmeticCount,
    });
  });

  it("rejects wrong, ambiguous, missing, malformed, and merely similar structures", () => {
    const run = parseSaveJson(
      '{"playerNames":{"value":{}},"dictionaryOfDictionaries":{"value":{"runStats":{}}}}',
    );
    const ambiguous = metaSave();
    ambiguous.playerNames = { value: {} };
    ambiguous.dictionaryOfDictionaries = { value: { runStats: {} } };

    expect(() => inspectMetaCosmetics(run)).toThrow(CosmeticEditError);
    expect(() => inspectMetaCosmetics(ambiguous)).toThrow(CosmeticEditError);
    expect(() => inspectMetaCosmetics(parseSaveJson('{"cosmeticHistory":{"value":[]}}'))).toThrow(
      CosmeticEditError,
    );
    expect(() => inspectMetaCosmetics(metaSave("[]", "[{}]"))).toThrow(CosmeticEditError);
    expect(() =>
      inspectMetaCosmetics(
        parseSaveJson(
          '{"nested":{"cosmeticHistory":{"value":[]},"cosmeticUnlocks":{"value":[]},"cosmeticPresets":{"value":[]}}}',
        ),
      ),
    ).toThrow(CosmeticEditError);
  });
});

describe("MetaSave cosmetic mutation", () => {
  it("adds only missing supported IDs while preserving future IDs, fields, and presets", () => {
    const data = metaSave("[27,999]", "[27,999]");
    const presetsBefore = serializeSaveJson({
      colorPresets: data.colorPresets,
      cosmeticPresets: data.cosmeticPresets,
    });
    const futureBefore = serializeSaveJson({ future: data.future });

    expect(unlockRemainingCosmetics(data)).toBe(true);
    const unlocks = integerLexemes(data, "cosmeticUnlocks");
    const history = integerLexemes(data, "cosmeticHistory");
    expect(unlocks.slice(0, 2)).toEqual(["27", "999"]);
    expect(history.slice(0, 2)).toEqual(["27", "999"]);
    expect(unlocks.filter((value) => value === "999")).toHaveLength(1);
    expect(history.filter((value) => value === "999")).toHaveLength(1);
    expect(new Set(unlocks.filter((value) => value !== "999")).size).toBe(cosmeticCount);
    expect(new Set(history.filter((value) => value !== "999")).size).toBe(cosmeticCount);
    expect(inspectMetaCosmetics(data).remainingSupportedCount).toBe(0);
    expect(
      serializeSaveJson({
        colorPresets: data.colorPresets,
        cosmeticPresets: data.cosmeticPresets,
      }),
    ).toBe(presetsBefore);
    expect(serializeSaveJson({ future: data.future })).toBe(futureBefore);

    const afterFirst = serializeSaveJson(data);
    expect(unlockRemainingCosmetics(data)).toBe(false);
    expect(serializeSaveJson(data)).toBe(afterFirst);
  });

  it("does not partially mutate malformed ownership data", () => {
    const data = metaSave("[27]", "[{}]");
    const before = serializeSaveJson(data);
    expect(() => unlockRemainingCosmetics(data)).toThrow(CosmeticEditError);
    expect(serializeSaveJson(data)).toBe(before);
  });
});

describe("MetaSave cosmetic pending edits", () => {
  it("stages one semantic baseline-to-current edit and discard removes it", () => {
    const editSession = session(metaSave("[27,999]"));
    expect(getCosmeticPendingEdits(editSession)).toEqual([]);

    expect(unlockRemainingCosmetics(editSession.working)).toBe(true);
    expect(getCosmeticPendingEdits(editSession)).toEqual([
      {
        after: `${cosmeticCount} unlocked`,
        before: "1 unlocked",
        field: "Supported cosmetics",
        id: "cosmetics:supported-ownership",
        subject: "Cosmetics",
      },
    ]);
    expect(unlockRemainingCosmetics(editSession.working)).toBe(false);
    expect(getCosmeticPendingEdits(editSession)).toHaveLength(1);
    expect(getCosmeticPendingEdits(resetEditSession(editSession))).toEqual([]);
  });

  it("does not stage a no-op when all supported IDs are already owned", () => {
    const editSession = session(
      metaSave(JSON.stringify(KNOWN_COSMETIC_IDS), JSON.stringify(KNOWN_COSMETIC_IDS)),
    );
    expect(unlockRemainingCosmetics(editSession.working)).toBe(false);
    expect(getCosmeticPendingEdits(editSession)).toEqual([]);
  });
});
