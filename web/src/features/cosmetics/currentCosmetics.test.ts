import { describe, expect, it } from "vitest";
import {
  approvedOwnedCosmeticIds,
  cosmeticRemovalBlockedReason,
  lockAllCosmetics,
  removeCosmeticOwnership,
  unlockCosmetic,
  unlockRemainingCosmetics,
} from "@/features/cosmetics/cosmetics";
import { getCosmeticPendingEdits } from "@/features/cosmetics/pendingEdits";
import { createEditSession } from "@/features/save-file/session";
import { parseSaveJson, serializeSaveJson } from "@/features/save-file/serialization";
import { loadSaveBytes, reencryptSave } from "@/features/save-file/pipeline";

function meta() {
  return parseSaveJson(
    '{"cosmeticHistory":{"value":[0,999]},"cosmeticUnlocks":{"value":[0,999]},"cosmeticEquipped":{"value":[]},"cosmeticPresets":{"value":[[]]},"colorPresets":{"value":[[1]]},"future":{"large":90071992547409931234567890,"float":1.2300}}',
  );
}

describe("current cosmetic ownership parity", () => {
  it.each(Array.from({ length: 10 }, (_, index) => index + 547))(
    "unlocks and safely removes ID %i with lossless encrypted re-import",
    async (id) => {
      const data = meta();
      const original = serializeSaveJson(data);
      expect(unlockCosmetic(data, id)).toBe(true);
      expect(unlockCosmetic(data, id)).toBe(false);
      const bytes = await reencryptSave({ data, kind: "meta", fileName: "MetaSave.es3" });
      const reopened = await loadSaveBytes(bytes, "MetaSave.es3");
      expect(approvedOwnedCosmeticIds(reopened.data)).toEqual([0, id]);
      expect(removeCosmeticOwnership(reopened.data, id)).toBe(true);
      expect(serializeSaveJson(reopened.data)).toBe(original);
    },
  );

  it("includes every newly approved ID in Unlock All and preserves unknown ownership during removal", () => {
    const data = meta();
    expect(unlockRemainingCosmetics(data)).toBe(true);
    expect(unlockRemainingCosmetics(data)).toBe(false);
    expect(approvedOwnedCosmeticIds(data)).toHaveLength(557);
    expect(lockAllCosmetics(data)).toBe(true);
    expect(approvedOwnedCosmeticIds(data)).toHaveLength(0);
    const expected = meta();
    removeCosmeticOwnership(expected, 0);
    expect(serializeSaveJson(data)).toBe(serializeSaveJson(expected));
    expect(serializeSaveJson(data)).toContain("90071992547409931234567890");
  });

  it.each(["cosmeticEquipped", "cosmeticPresets"])(
    "rejects referenced removal atomically through %s",
    (field) => {
      const data = meta();
      unlockCosmetic(data, 547);
      data[field] = { value: [parseSaveJson('{"id":547}')] };
      const before = serializeSaveJson(data);
      expect(cosmeticRemovalBlockedReason(data, 547)).toBeTruthy();
      expect(() => lockAllCosmetics(data)).toThrow(/Removal/);
      expect(() => removeCosmeticOwnership(data, 547)).toThrow(/Removal/);
      expect(serializeSaveJson(data)).toBe(before);
    },
  );

  it("preserves a missing-reference removal boundary and rejects unapproved IDs before mutation", () => {
    const data = meta();
    delete data.cosmeticEquipped;
    const before = serializeSaveJson(data);
    expect(() => removeCosmeticOwnership(data, 0)).toThrow(/Removal/);
    for (const id of [-1, 557, 999, 1.5, NaN]) expect(() => unlockCosmetic(data, id)).toThrow();
    expect(serializeSaveJson(data)).toBe(before);
  });

  it.each([null, "unknown", false])(
    "rejects unverifiable reference container %s atomically",
    (value) => {
      const data = meta();
      data.cosmeticEquipped = { value };
      const before = serializeSaveJson(data);
      expect(() => removeCosmeticOwnership(data, 0)).toThrow(/references could not be verified/);
      expect(() => lockAllCosmetics(data)).toThrow(/references could not be verified/);
      expect(serializeSaveJson(data)).toBe(before);
    },
  );

  it("reviews history-only changes after locking and restoring the same ownership", () => {
    const data = meta();
    data.cosmeticHistory = { value: [] };
    const session = createEditSession({ data, kind: "meta", fileName: "MetaSave.es3" });
    expect(removeCosmeticOwnership(session.working, 0)).toBe(true);
    expect(unlockCosmetic(session.working, 0)).toBe(true);
    expect(approvedOwnedCosmeticIds(session.working)).toEqual([0]);
    expect(getCosmeticPendingEdits(session)).toEqual([
      {
        id: "cosmetics:history",
        subject: "Cosmetics",
        field: "Cosmetic history",
        before: "Original history",
        after: "Updated history",
      },
    ]);
  });

  it("reviews a replacement even when the total owned count stays equal", () => {
    const session = createEditSession({ data: meta(), kind: "meta", fileName: "MetaSave.es3" });
    removeCosmeticOwnership(session.working, 0);
    unlockCosmetic(session.working, 547);
    expect(getCosmeticPendingEdits(session).map((edit) => edit.id)).toEqual([
      "cosmetics:0",
      "cosmetics:547",
    ]);
  });
});
