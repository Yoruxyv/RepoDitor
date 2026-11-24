import { LosslessNumber } from "lossless-json";
import { describe, expect, it } from "vitest";

import {
  inspectRecharge,
  RECHARGE_CAPABILITY_SNAPSHOT,
  RechargeEditError,
  rechargeAllSupportedItems,
  SUPPORTED_RECHARGEABLE_ITEM_IDENTITIES,
} from "@/features/recharge/recharge";
import { prepareVerifiedExport } from "@/features/save-file/export";
import { loadSaveBytes, type LoadedSave } from "@/features/save-file/pipeline";
import { createEditSession } from "@/features/save-file/session";
import {
  isSaveNumber,
  isSaveObject,
  parseSaveJson,
  serializeSaveJson,
  type SaveObject,
} from "@/features/save-file/serialization";

const ITEMS = {
  "Item Cart Medium/3": 2,
  "Item Drone Battery/4": 3,
  "Item Future Battery/5": 4,
  "Item Gun Tranq/1": 15,
  "Item Gun Tranq Prototype/6": 16,
  "Item Melee Inflatable Hammer/2": 21,
};

const CHARGES = {
  "Item Cart Medium/3": 44,
  "Item Drone Battery/4": 25,
  "Item Future Battery/5": 88,
  "Item Gun Tranq/1": 0,
  "Item Gun Tranq Prototype/6": 10,
  "Item Melee Inflatable Hammer/2": 20,
};

function runSave(
  items: Readonly<Record<string, unknown>> = ITEMS,
  charges: Readonly<Record<string, unknown>> = CHARGES,
): SaveObject {
  return parseSaveJson(
    JSON.stringify({
      dictionaryOfDictionaries: {
        value: {
          futureItemStatBattery: { "Item Gun Tranq/1": 777 },
          item: items,
          itemStatBattery: charges,
          runStats: { currency: 12, level: 0, "save level": 0 },
        },
      },
      playerNames: { value: { "111": "Alpha" } },
      unknown: { future: "preserved" },
    }),
  );
}

function dictionaries(data: SaveObject): SaveObject {
  const entry = data.dictionaryOfDictionaries;
  if (!isSaveObject(entry) || !isSaveObject(entry.value)) {
    throw new Error("Expected Run dictionaries fixture.");
  }
  return entry.value;
}

function chargeEntries(data: SaveObject): SaveObject {
  const charges = dictionaries(data).itemStatBattery;
  if (!isSaveObject(charges)) {
    throw new Error("Expected charge fixture.");
  }
  return charges;
}

describe("recharge capability snapshot", () => {
  it("is deterministic, versioned, explicit, and excludes exceptional battery-like items", () => {
    expect(RECHARGE_CAPABILITY_SNAPSHOT).toMatchObject({
      compatibility: {
        steamAppId: "3241660",
        steamBuildId: "26813769",
        unityVersion: "6000.3.28f1",
      },
      snapshotVersion: 1,
    });
    expect(RECHARGE_CAPABILITY_SNAPSHOT.provenance).toContain("#web-write-compatibility");
    expect(RECHARGE_CAPABILITY_SNAPSHOT.fullChargeRepresentation).toContain("itemStatBattery");
    expect(SUPPORTED_RECHARGEABLE_ITEM_IDENTITIES).toHaveLength(29);
    expect(new Set(SUPPORTED_RECHARGEABLE_ITEM_IDENTITIES).size).toBe(29);
    expect(SUPPORTED_RECHARGEABLE_ITEM_IDENTITIES).toEqual(
      [...SUPPORTED_RECHARGEABLE_ITEM_IDENTITIES].sort((left, right) => left.localeCompare(right)),
    );
    expect(SUPPORTED_RECHARGEABLE_ITEM_IDENTITIES).toContain("Item Gun Tranq");
    expect(SUPPORTED_RECHARGEABLE_ITEM_IDENTITIES).not.toContain("Item Drone Battery");
    expect(SUPPORTED_RECHARGEABLE_ITEM_IDENTITIES).not.toContain("Item Power Crystal");
  });
});

describe("recharge inspection", () => {
  it("recognizes only exact supported identities and the proven charge container", () => {
    expect(inspectRecharge(runSave())).toEqual({
      needingRechargeCount: 2,
      supportedItemCount: 2,
    });
  });

  it("reports zero, full, depleted, and repeated supported instances", () => {
    expect(inspectRecharge(runSave({}, {}))).toEqual({
      needingRechargeCount: 0,
      supportedItemCount: 0,
    });
    expect(
      inspectRecharge(
        runSave(
          {
            "Item Gun Tranq/1": 15,
            "Item Gun Tranq/2": 15,
            "Item Melee Inflatable Hammer/3": 21,
          },
          {},
        ),
      ),
    ).toEqual({ needingRechargeCount: 0, supportedItemCount: 3 });
    expect(
      inspectRecharge(
        runSave(
          {
            "Item Gun Tranq/1": 15,
            "Item Gun Tranq/2": 15,
            "Item Melee Inflatable Hammer/3": 21,
          },
          { "Item Gun Tranq/2": 0, "Item Melee Inflatable Hammer/3": 20 },
        ),
      ),
    ).toEqual({ needingRechargeCount: 2, supportedItemCount: 3 });
  });

  it("rejects the wrong save kind and missing or malformed inventory ownership", () => {
    const meta = parseSaveJson(
      '{"cosmeticHistory":{"value":[]},"cosmeticUnlocks":{"value":[]},"cosmeticPresets":{"value":[]}}',
    );
    expect(() => inspectRecharge(meta)).toThrow(RechargeEditError);

    const malformedCharge = runSave();
    dictionaries(malformedCharge).itemStatBattery = null;
    expect(() => inspectRecharge(malformedCharge)).toThrow(/itemStatBattery/iu);

    const malformedInventory = runSave();
    dictionaries(malformedInventory).item = [];
    expect(() => inspectRecharge(malformedInventory)).toThrow(/item/iu);

    const malformedItemValue = runSave({ "Item Gun Tranq/1": {} }, {});
    expect(() => inspectRecharge(malformedItemValue)).toThrow(/inventory/iu);
  });

  it.each([
    new LosslessNumber("1.5"),
    new LosslessNumber("1e2"),
    new LosslessNumber("2147483648"),
    new LosslessNumber("-2147483649"),
    "20",
    {},
  ])("fails closed on malformed or out-of-range stored charge: %o", (value) => {
    const data = runSave();
    chargeEntries(data)["Item Gun Tranq/1"] = value;

    expect(() => inspectRecharge(data)).toThrow(RechargeEditError);
    expect(() => rechargeAllSupportedItems(data)).toThrow(RechargeEditError);
  });
});

describe("recharge mutation", () => {
  it("treats an absent battery dictionary as full without creating one", () => {
    const data = runSave();
    Reflect.deleteProperty(dictionaries(data), "itemStatBattery");
    expect(inspectRecharge(data)).toEqual({ needingRechargeCount: 0, supportedItemCount: 2 });
    expect(rechargeAllSupportedItems(data)).toBe(false);
    expect(Object.hasOwn(dictionaries(data), "itemStatBattery")).toBe(false);
  });

  it("removes only supported exact-instance charge leaves and is idempotent", () => {
    const data = runSave();
    const itemOrder = Object.keys(dictionaries(data).item as SaveObject);
    const opaque = parseSaveJson('{"large":90071992547409931234567890,"decimal":2.370}');
    data.opaque = opaque;
    const opaqueSource = serializeSaveJson(opaque);

    expect(rechargeAllSupportedItems(data)).toBe(true);
    expect(Object.keys(dictionaries(data).item as SaveObject)).toEqual(itemOrder);
    const remainingCharge = chargeEntries(data);
    expect(
      Object.fromEntries(
        Object.entries(remainingCharge).map(([key, value]) => [
          key,
          isSaveNumber(value) ? value.value : null,
        ]),
      ),
    ).toEqual({
      "Item Cart Medium/3": "44",
      "Item Drone Battery/4": "25",
      "Item Future Battery/5": "88",
      "Item Gun Tranq Prototype/6": "10",
    });
    expect(serializeSaveJson(opaque)).toBe(opaqueSource);
    expect(inspectRecharge(data)).toEqual({ needingRechargeCount: 0, supportedItemCount: 2 });
    expect(rechargeAllSupportedItems(data)).toBe(false);
  });

  it("does not mutate a clean full/default save", () => {
    const data = runSave({ "Item Gun Tranq/1": 15 }, {});
    const before = serializeSaveJson(data);

    expect(rechargeAllSupportedItems(data)).toBe(false);
    expect(serializeSaveJson(data)).toBe(before);
  });

  it("survives verified export and Web reload without changing unsupported data", async () => {
    const loaded: LoadedSave = {
      data: runSave(),
      fileName: "REPO_SAVE.es3",
      kind: "run",
    };
    const session = createEditSession(loaded);
    expect(rechargeAllSupportedItems(session.working)).toBe(true);

    const exported = await prepareVerifiedExport(session);
    const reopened = await loadSaveBytes(
      new Uint8Array(await exported.blob.arrayBuffer()),
      exported.fileName,
    );

    expect(inspectRecharge(reopened.data)).toEqual({
      needingRechargeCount: 0,
      supportedItemCount: 2,
    });
    expect(Object.keys(chargeEntries(reopened.data))).toEqual([
      "Item Cart Medium/3",
      "Item Drone Battery/4",
      "Item Future Battery/5",
      "Item Gun Tranq Prototype/6",
    ]);
    expect(reopened.data.unknown).toEqual({ future: "preserved" });
  });
});
